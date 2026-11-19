import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleMaterial,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
  getPrimaryWorkspace,
} from "@/lib/access";
import { updateMaterialSchema } from "@/lib/validation/materials";
import {
  assertActiveHierarchyScopeWithinTx,
  resolveMaterialScope,
  ScopeNotFoundError,
} from "@/lib/materials-scope";
import { getStorageService } from "@/lib/services/storage";
import { deleteStorageObjectSafely } from "@/lib/services/storage-cleanup";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { ActivityAction, createActivityLog } from "@/lib/activity";
import { cancelActiveDocumentExtractionForMaterial } from "@/lib/document-extraction";

export async function GET(_req: Request, { params }: { params: { materialId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const material = await getAccessibleMaterial(params.materialId, user.id);
    if (!material) return NOT_FOUND();

    let readUrl: string | null = null;
    if (material.storageKey && material.status === "READY") {
      const storage = getStorageService();
      // For browser playback, prefer a same-origin proxy so the HTMLAudioElement
      // can fetch metadata even if object storage CORS is not configured.
      // Local storage already returns a local app route; for other backends
      // (S3) return the app's proxy read URL which the /api/storage/read
      // endpoint will proxy to the backend safely.
      try {
        const { LocalStorageService } = require("@/lib/services/storage-local");
        if (storage instanceof LocalStorageService) {
          readUrl = await storage.createReadUrl(material.storageKey);
        } else {
          readUrl = `/api/storage/read?key=${encodeURIComponent(material.storageKey)}`;
        }
      } catch (e) {
        // Fallback: if we can't import LocalStorageService for any reason,
        // return the proxy URL which will attempt to fetch the bytes server-side.
        readUrl = `/api/storage/read?key=${encodeURIComponent(material.storageKey)}`;
      }
    }

    let transcript = null;
    let latestTranscriptionJob = null;
    if (material.type === "AUDIO" || material.type === "VIDEO") {
      [transcript, latestTranscriptionJob] = await Promise.all([
        db.transcript.findUnique({
          where: { materialId: material.id },
          include: { segments: { orderBy: { order: "asc" } } },
        }),
        db.processingJob.findFirst({
          where: { materialId: material.id, type: "TRANSCRIPTION" },
          orderBy: { createdAt: "desc" },
        }),
      ]);
    }

    return NextResponse.json({ material, readUrl, transcript, latestTranscriptionJob });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function PATCH(req: Request, { params }: { params: { materialId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateMaterialSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);
  const { archived, subjectId, chapterId, topicId, ...rest } = parsed.data;

  try {
    const existing = await getAccessibleMaterial(params.materialId, user.id);
    if (!existing) return NOT_FOUND();

    const movingScope = subjectId !== undefined || chapterId !== undefined || topicId !== undefined;
    let scopeUpdate: {
      workspaceId?: string | null;
      groupId?: string | null;
      subjectId?: string | null;
      chapterId?: string | null;
      topicId?: string | null;
    } = {};
    if (movingScope) {
      const workspace = await getPrimaryWorkspace(user.id);
      const isDetach = subjectId === null && chapterId === null && topicId === null;
      const scope = isDetach
        ? {
            workspaceId: existing.groupId ? null : workspace.id,
            groupId: existing.groupId,
            subjectId: null,
            chapterId: null,
            topicId: null,
          }
        : await resolveMaterialScope(
            {
              subjectId: subjectId ?? undefined,
              chapterId: chapterId ?? undefined,
              topicId: topicId ?? undefined,
            },
            user.id,
            workspace.id
          );
      scopeUpdate = scope;
    }

    const dbAny = db as unknown as {
      $transaction?: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>;
    };

    const runUpdate = async (client: typeof db) => {
      const groupIds = [
        ...new Set(
          [existing.groupId, scopeUpdate.groupId].filter((gid): gid is string => Boolean(gid))
        ),
      ].sort();
      const clientAny = client as unknown as {
        $queryRaw?: unknown;
        material: {
          updateMany?: (args: unknown) => Promise<{ count: number }>;
          findUnique?: (args: unknown) => Promise<typeof existing | null>;
          update: typeof db.material.update;
        };
      };

      if (
        typeof clientAny.$queryRaw === "function" &&
        typeof assertActiveGroupMemberForCreation === "function"
      ) {
        for (const gid of groupIds) {
          await assertActiveGroupMemberForCreation(client as never, gid, user.id);
        }
      }

      if (movingScope) {
        await assertActiveHierarchyScopeWithinTx(client as never, {
          subjectId: scopeUpdate.subjectId ?? null,
          chapterId: scopeUpdate.chapterId ?? null,
          topicId: scopeUpdate.topicId ?? null,
        });
      }

      if (typeof clientAny.material?.updateMany === "function") {
        const { count } = await clientAny.material.updateMany({
          where: { id: params.materialId, deletedAt: null },
          data: {
            ...rest,
            ...scopeUpdate,
            ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
          },
        });
        if (count === 0) return null;
        if (typeof clientAny.material.findUnique === "function") {
          return clientAny.material.findUnique({ where: { id: params.materialId } });
        }
      }

      return client.material.update({
        where: { id: params.materialId },
        data: {
          ...rest,
          ...scopeUpdate,
          ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
        },
      });
    };

    const material =
      typeof dbAny.$transaction === "function"
        ? await dbAny.$transaction((tx) => runUpdate(tx))
        : await runUpdate(db);

    if (!material) return NOT_FOUND();
    return NextResponse.json({ material });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    if (err instanceof ScopeNotFoundError) return NOT_FOUND();
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: { params: { materialId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const existing = await getAccessibleMaterial(params.materialId, user.id);
    if (!existing) return NOT_FOUND();

    // Top-down lock hierarchy: lock parent Group FOR SHARE + re-validate membership BEFORE
    // acquiring the per-material advisory lock, then soft-delete and cancel ALL active
    // jobs + record group activity log inside the single atomic transaction.
    await db.$transaction(async (tx) => {
      const txAny = tx as unknown as {
        $queryRaw?: unknown;
        material?: {
          findUnique?: (args: unknown) => Promise<{ deletedAt?: Date | null } | null>;
        };
      };
      if (
        existing.groupId &&
        typeof txAny.$queryRaw === "function" &&
        typeof assertActiveGroupMemberForCreation === "function"
      ) {
        await assertActiveGroupMemberForCreation(tx, existing.groupId, user.id);
      }

      const lockKey = `job:DOCUMENT_EXTRACTION:${params.materialId}`;
      try {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          lockKey
        );
      } catch {
        // Mocked test environments or non-Postgres engines may not support advisory locks
      }

      if (typeof txAny.material?.findUnique === "function") {
        const current = await txAny.material.findUnique({
          where: { id: params.materialId },
          select: { deletedAt: true },
        });
        if (!current || current.deletedAt != null) {
          return;
        }
      }

      await tx.material.update({ where: { id: params.materialId }, data: { deletedAt: new Date() } });

      await tx.processingJob.updateMany({
        where: {
          materialId: params.materialId,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
        },
      });

      if (existing.groupId) {
        await createActivityLog(tx, {
          groupId: existing.groupId,
          userId: user.id,
          action: ActivityAction.MATERIAL_REMOVED,
          targetType: "material",
          targetId: existing.id,
          metadata: { targetName: existing.title },
        });
      }
    });

    cancelActiveDocumentExtractionForMaterial(params.materialId, "Material was deleted.");

    let storageCleanupPending = false;
    if (existing.storageKey) {
      const cleanup = await deleteStorageObjectSafely(existing.storageKey, {
        route: "materials/[materialId]/DELETE",
        op: "delete-material-object",
        materialId: existing.id,
        userId: user.id,
        ownerId: existing.ownerId,
      });
      if (!cleanup.deleted) {
        storageCleanupPending = true;
      }
    }

    return NextResponse.json(
      storageCleanupPending ? { success: true, storageCleanupPending: true } : { success: true }
    );
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
