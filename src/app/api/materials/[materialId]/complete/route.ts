import { NextResponse } from "next/server";
import type { Material, PlanTier, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUser, lockGroupMemberForShare } from "@/lib/access";
import { getStorageService } from "@/lib/services/storage";
import { deleteStorageObjectSafely } from "@/lib/services/storage-cleanup";
import { LocalStorageService } from "@/lib/services/storage-local";
import { S3StorageService } from "@/lib/services/storage-s3";
import { getStorageUsage } from "@/lib/storage-usage";
import { extractMetadata } from "@/lib/metadata-extraction";
import { queueDocumentExtractionIfNeeded } from "@/lib/document-extraction";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, jsonError, logServerError } from "@/lib/api-response";
import { ActivityAction, createActivityLog } from "@/lib/activity";
import { getPlanLimits, type PlanLimits } from "@/lib/plans";

function resolveEffectivePlanTier(
  subscription: { plan?: PlanTier | string | null; status?: string | null } | null | undefined
): PlanTier {
  if (!subscription || subscription.status === "CANCELLED") return "FREE";
  const plan = subscription.plan;
  if (
    plan === "FREE" ||
    plan === "STUDENT" ||
    plan === "PRO" ||
    plan === "TEAM" ||
    plan === "INSTITUTION"
  ) {
    return plan;
  }
  return "FREE";
}

async function verifyMaterialAndScopeActiveInClient(
  client: unknown,
  material: Material,
  userId: string
): Promise<{ ok: true } | { ok: false; status: 403 | 404; message: string }> {
  const raw = client as {
    $queryRaw?: <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
    group?: { findFirst?: (args: unknown) => Promise<{ id: string; deletedAt?: Date | null } | null> };
    groupMember?: { findFirst?: (args: unknown) => Promise<{ id: string } | null> };
    topic?: { findFirst?: (args: unknown) => Promise<{ id: string } | null> };
    chapter?: { findFirst?: (args: unknown) => Promise<{ id: string } | null> };
    subject?: { findFirst?: (args: unknown) => Promise<{ id: string } | null> };
    material?: { findUnique?: (args: unknown) => Promise<{ deletedAt?: Date | null } | null> };
  };

  if (material.groupId) {
    if (typeof raw.$queryRaw === "function") {
      const rows = await raw.$queryRaw<Array<{ id: string; deletedAt: Date | null }>>`
        SELECT id, "deletedAt" FROM "Group" WHERE id = ${material.groupId} FOR SHARE
      `;
      if (!rows[0] || rows[0].deletedAt !== null) {
        return { ok: false, status: 404, message: "Not found" };
      }
    } else if (typeof raw.group?.findFirst === "function") {
      const activeGroup = await raw.group.findFirst({
        where: { id: material.groupId, deletedAt: null },
        select: { id: true, deletedAt: true },
      });
      if (!activeGroup || activeGroup.deletedAt != null) {
        return { ok: false, status: 404, message: "Not found" };
      }
    }

    if (typeof raw.$queryRaw === "function") {
      const member = await lockGroupMemberForShare(
        raw as unknown as Prisma.TransactionClient,
        material.groupId,
        userId
      );
      if (!member) {
        return { ok: false, status: 403, message: "Forbidden" };
      }
    } else if (typeof raw.groupMember?.findFirst === "function") {
      const member = await raw.groupMember.findFirst({
        where: { groupId: material.groupId, userId, group: { deletedAt: null } },
        select: { id: true },
      });
      if (!member) {
        return { ok: false, status: 403, message: "Forbidden" };
      }
    }
  }

  if (material.topicId && typeof raw.topic?.findFirst === "function") {
    const activeTopic = await raw.topic.findFirst({
      where: { id: material.topicId, deletedAt: null },
      select: { id: true },
    });
    if (!activeTopic) return { ok: false, status: 404, message: "Not found" };
  }
  if (material.chapterId && typeof raw.chapter?.findFirst === "function") {
    const activeChapter = await raw.chapter.findFirst({
      where: { id: material.chapterId, deletedAt: null },
      select: { id: true },
    });
    if (!activeChapter) return { ok: false, status: 404, message: "Not found" };
  }
  if (material.subjectId && typeof raw.subject?.findFirst === "function") {
    const activeSubject = await raw.subject.findFirst({
      where: { id: material.subjectId, deletedAt: null },
      select: { id: true },
    });
    if (!activeSubject) return { ok: false, status: 404, message: "Not found" };
  }

  if (typeof raw.material?.findUnique === "function") {
    const current = await raw.material.findUnique({
      where: { id: material.id },
      select: { deletedAt: true },
    });
    if (!current || current.deletedAt != null) {
      return { ok: false, status: 404, message: "Not found" };
    }
  }

  return { ok: true };
}

async function settleUploadAtomicallyWithQuota(
  userId: string,
  material: Material,
  sizeBytes: number,
  data: Prisma.MaterialUpdateManyMutationInput & { status: "READY" },
  fallbackRemainingBytes: number
): Promise<
  | { rejected: true; message: string; status: number }
  | { rejected: false; material: Material; won: boolean }
> {
  const dbWithTx = db as unknown as {
    $transaction?: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  };
  if (typeof dbWithTx.$transaction !== "function") {
    const scopeCheck = await verifyMaterialAndScopeActiveInClient(db, material, userId);
    if (!scopeCheck.ok) {
      await db.material
        .updateMany({ where: { id: material.id, status: "UPLOADING" }, data: { status: "FAILED" } })
        .catch(() => undefined);
      return { rejected: true, message: scopeCheck.message, status: scopeCheck.status };
    }
    if (sizeBytes > fallbackRemainingBytes) {
      return { rejected: true, message: "This would exceed your plan's storage limit.", status: 413 };
    }
    const res = await settleUpload(material.id, data);
    return { rejected: false, ...res };
  }

  return dbWithTx.$transaction(async (tx) => {
    const rawTx = tx as unknown as {
      $executeRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
      subscription?: {
        findUnique?: (args: unknown) => Promise<{ plan?: string | null; status?: string | null } | null>;
      };
      material: {
        aggregate?: (args: unknown) => Promise<{ _sum?: { sizeBytes?: number | null } }>;
        updateMany: (args: unknown) => Promise<{ count: number }>;
        findUniqueOrThrow: (args: unknown) => Promise<Material>;
      };
    };

    const scopeCheck = await verifyMaterialAndScopeActiveInClient(tx, material, userId);
    if (!scopeCheck.ok) {
      await rawTx.material.updateMany({
        where: { id: material.id, status: "UPLOADING" },
        data: { status: "FAILED" },
      });
      return {
        rejected: true as const,
        message: scopeCheck.message,
        status: scopeCheck.status,
      };
    }

    if (typeof rawTx.$executeRaw === "function") {
      await rawTx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`quota:storage:${userId}`}, 0))`;
    }

    if (
      typeof rawTx.subscription?.findUnique === "function" &&
      typeof rawTx.material?.aggregate === "function"
    ) {
      const [subscription, aggregate] = await Promise.all([
        rawTx.subscription.findUnique({ where: { userId } }),
        rawTx.material.aggregate({
          where: {
            ownerId: userId,
            deletedAt: null,
            id: { not: material.id },
          },
          _sum: { sizeBytes: true },
        }),
      ]);
      const plan = getPlanLimits(resolveEffectivePlanTier(subscription));
      const usedBytes = aggregate._sum?.sizeBytes ?? 0;
      if (usedBytes + sizeBytes > plan.storageBytes) {
        await rawTx.material.updateMany({
          where: { id: material.id, status: "UPLOADING" },
          data: { status: "FAILED" },
        });
        return {
          rejected: true as const,
          message: "This would exceed your plan's storage limit.",
          status: 413,
        };
      }
    } else if (sizeBytes > fallbackRemainingBytes) {
      await rawTx.material.updateMany({
        where: { id: material.id, status: "UPLOADING" },
        data: { status: "FAILED" },
      });
      return {
        rejected: true as const,
        message: "This would exceed your plan's storage limit.",
        status: 413,
      };
    }

    const { count } = await rawTx.material.updateMany({
      where: { id: material.id, status: "UPLOADING" },
      data,
    });
    const updated = await rawTx.material.findUniqueOrThrow({ where: { id: material.id } });
    return { rejected: false as const, material: updated, won: count === 1 };
  });
}

/** Logs "material.added" once a group Material actually reaches READY (not on FAILED). */
async function logMaterialAddedIfGroup(
  material: { id: string; groupId: string | null; title: string },
  userId: string,
) {
  if (!material.groupId) return;
  await createActivityLog(db, {
    groupId: material.groupId,
    userId,
    action: ActivityAction.MATERIAL_ADDED,
    targetType: "material",
    targetId: material.id,
    metadata: { targetName: material.title },
  });
}

/**
 * Moves a material UPLOADING → READY (or FAILED) exactly once.
 */
async function settleUpload(
  materialId: string,
  data: Prisma.MaterialUpdateManyMutationInput & { status: "READY" | "FAILED" }
): Promise<{ material: Material; won: boolean }> {
  const { count } = await db.material.updateMany({ where: { id: materialId, status: "UPLOADING" }, data });
  const material = await db.material.findUniqueOrThrow({ where: { id: materialId } });
  return { material, won: count === 1 };
}

export async function POST(_req: Request, { params }: { params: { materialId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const material = await db.material.findUnique({ where: { id: params.materialId } });

  if (!material) return NOT_FOUND();
  if (material.ownerId !== user.id) return FORBIDDEN();
  if (material.deletedAt != null) {
    // Material (or its parent group) was soft-deleted while the presigned upload was in flight.
    // Clean up any orphaned uploaded object and fail closed with 404.
    if (material.status === "UPLOADING") {
      await db.material
        .updateMany({ where: { id: material.id, status: "UPLOADING" }, data: { status: "FAILED" } })
        .catch(() => undefined);
    }
    if (material.storageKey) {
      await deleteStorageObjectSafely(material.storageKey, {
        route: "materials/[materialId]/complete",
        op: "cleanup-deleted-material-upload",
        materialId: material.id,
        userId: user.id,
      });
    }
    return NOT_FOUND();
  }
  if (material.status !== "UPLOADING") {
    // Already completed — return success idempotently rather than erroring,
    // since a flaky network can cause the client to retry this call.
    return NextResponse.json({ material });
  }
  if (!material.storageKey) return jsonError("No upload was started for this material.", 409);

  const storage = getStorageService();

  // The local backend already has the bytes on disk (written by
  // /api/storage/upload), so extraction runs synchronously and for real.
  if (storage instanceof LocalStorageService) {
    try {
      const [stats, usageResult] = await Promise.all([
        storage.readFileStats(material.storageKey),
        getStorageUsage(user.id),
      ]);

      const localRejection =
        stats.size === 0
          ? { message: "The uploaded file is empty.", status: 400 }
          : stats.size > usageResult.plan.maxFileSizeBytes
            ? {
                message: `File exceeds your plan's ${Math.round(
                  usageResult.plan.maxFileSizeBytes / (1024 * 1024)
                )}MB per-file limit.`,
                status: 413,
              }
            : stats.size > usageResult.remainingBytes
              ? { message: "This would exceed your plan's storage limit.", status: 413 }
              : null;

      if (localRejection) {
        await settleUpload(material.id, { status: "FAILED" });
        await deleteStorageObjectSafely(material.storageKey, {
          route: "materials/[materialId]/complete",
          op: "cleanup-local-rejected-upload",
          materialId: material.id,
          userId: user.id,
          storageService: storage,
        });
        return jsonError(localRejection.message, localRejection.status);
      }

      const buffer = await storage.readFile(material.storageKey);
      const metadata = await extractMetadata(material.type, buffer);

      const outcome = await settleUploadAtomicallyWithQuota(
        user.id,
        material,
        stats.size,
        {
          status: "READY",
          sizeBytes: stats.size,
          durationSeconds: metadata.durationSeconds ?? null,
          metadata: metadata.extractionError
            ? { extractionError: metadata.extractionError }
            : { pageCount: metadata.pageCount, width: metadata.width, height: metadata.height },
        },
        usageResult.remainingBytes
      );

      if (outcome.rejected) {
        await deleteStorageObjectSafely(material.storageKey, {
          route: "materials/[materialId]/complete",
          op: "cleanup-local-aborted-upload",
          materialId: material.id,
          userId: user.id,
          storageService: storage,
        });
        if (outcome.status === 404) return NOT_FOUND();
        if (outcome.status === 403) return FORBIDDEN();
        return jsonError(outcome.message, outcome.status);
      }

      const { material: updated, won } = outcome;
      if (won) {
        await logMaterialAddedIfGroup(updated, user.id);
        void queueDocumentExtractionIfNeeded(updated, user.id);
      }
      return NextResponse.json({ material: updated });
    } catch {
      const { material: updated } = await settleUpload(material.id, { status: "FAILED" });
      await deleteStorageObjectSafely(material.storageKey, {
        route: "materials/[materialId]/complete",
        op: "cleanup-local-failed-upload",
        materialId: material.id,
        userId: user.id,
        storageService: storage,
      });
      return NextResponse.json({ material: updated }, { status: 422 });
    }
  }

  // S3-style backend.
  if (storage instanceof S3StorageService) {
    let head: { sizeBytes: number } | null = null;
    let plan: PlanLimits;
    let remainingBytes: number = 0;

    try {
      const [headResult, usageResult] = await Promise.all([
        storage.headObject(material.storageKey),
        getStorageUsage(user.id)
      ]);
      head = headResult;
      plan = usageResult.plan;
      remainingBytes = usageResult.remainingBytes;
    } catch (err) {
      logServerError({ route: "materials/[id]/complete", op: "head-object", userId: user.id }, err);
      return jsonError("We couldn't verify your upload right now. Please try again in a moment.", 503, {
        code: "UPLOAD_VERIFY_UNAVAILABLE",
      });
    }

    if (!head) {
      return jsonError("We couldn't find the uploaded file. Please upload it again.", 409, {
        code: "UPLOAD_NOT_FOUND",
      });
    }

    const rejection =
      head.sizeBytes === 0
        ? { message: "The uploaded file is empty.", status: 400 }
        : head.sizeBytes > plan.maxFileSizeBytes
          ? {
              message: `File exceeds your plan's ${Math.round(plan.maxFileSizeBytes / (1024 * 1024))}MB per-file limit.`,
              status: 413,
            }
          : head.sizeBytes > remainingBytes
            ? { message: "This would exceed your plan's storage limit.", status: 413 }
            : null;

    if (rejection) {
      await settleUpload(material.id, { status: "FAILED" });
      await deleteStorageObjectSafely(material.storageKey, {
        route: "materials/[materialId]/complete",
        op: "cleanup-s3-rejected-upload",
        materialId: material.id,
        userId: user.id,
        storageService: storage,
      });
      return jsonError(rejection.message, rejection.status);
    }

    const outcome = await settleUploadAtomicallyWithQuota(
      user.id,
      material,
      head.sizeBytes,
      { status: "READY", sizeBytes: head.sizeBytes },
      remainingBytes
    );

    if (outcome.rejected) {
      await deleteStorageObjectSafely(material.storageKey, {
        route: "materials/[materialId]/complete",
        op: "cleanup-s3-aborted-upload",
        materialId: material.id,
        userId: user.id,
        storageService: storage,
      });
      if (outcome.status === 404) return NOT_FOUND();
      if (outcome.status === 403) return FORBIDDEN();
      return jsonError(outcome.message, outcome.status);
    }

    const { material: updated, won } = outcome;

    if (won) {
      await logMaterialAddedIfGroup(updated, user.id);
      void queueDocumentExtractionIfNeeded(updated, user.id);
    }

    return NextResponse.json({ material: updated });
  }

  return jsonError("Storage backend is not recognized.", 500);
}
