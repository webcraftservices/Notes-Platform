import { NextResponse } from "next/server";
import type { Material, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/access";
import { getStorageService } from "@/lib/services/storage";
import { LocalStorageService } from "@/lib/services/storage-local";
import { S3StorageService } from "@/lib/services/storage-s3";
import { getStorageUsage } from "@/lib/storage-usage";
import { extractMetadata } from "@/lib/metadata-extraction";
import { queueDocumentExtractionIfNeeded } from "@/lib/document-extraction";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, jsonError, logServerError } from "@/lib/api-response";
import { ActivityAction, createActivityLog } from "@/lib/activity";

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
 * Moves a material UPLOADING → READY (or FAILED) exactly once. The status
 * guard is in the UPDATE itself, so of two overlapping /complete calls
 * (a double submit, or the client retrying after a network timeout) only
 * one wins the transition; `won` tells the caller whether it owns the
 * follow-up side effects (activity log, extraction job), which the loser
 * must NOT repeat.
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
      const stats = await storage.readFileStats(material.storageKey);
      const buffer = await storage.readFile(material.storageKey);
      const metadata = await extractMetadata(material.type, buffer);

      const { material: updated, won } = await settleUpload(material.id, {
        status: "READY",
        sizeBytes: stats.size,
        durationSeconds: metadata.durationSeconds ?? null,
        metadata: metadata.extractionError
          ? { extractionError: metadata.extractionError }
          : { pageCount: metadata.pageCount, width: metadata.width, height: metadata.height },
      });
      if (won) {
        await logMaterialAddedIfGroup(updated, user.id);
        // Fire-and-forget, same execution model as transcription/embedding
        // jobs — no-ops for material types this pipeline doesn't handle
        // (see queueDocumentExtractionIfNeeded). Unlike transcription this
        // isn't gated behind a user action: extraction is local/free.
        void queueDocumentExtractionIfNeeded(updated, user.id);
      }
      return NextResponse.json({ material: updated });
    } catch {
      const { material: updated } = await settleUpload(material.id, { status: "FAILED" });
      return NextResponse.json({ material: updated }, { status: 422 });
    }
  }

  // S3-style backend. The browser PUT the bytes straight to object storage,
  // so this server never saw them. Phase 9.4: confirm the object really
  // exists and learn its real size with one HEAD request (cheap — unlike
  // downloading it back just to extract page count/duration, which this
  // path still deliberately skips; see docs/ARCHITECTURE.md Phase 3 notes).
  // Before this, a material went READY with no verification at all and
  // with `sizeBytes` never set, so S3-backed uploads never counted toward
  // the storage quota and the per-file plan limit was never enforced
  // server-side after the upload.
  if (storage instanceof S3StorageService) {
    let head: { sizeBytes: number } | null;
    try {
      head = await storage.headObject(material.storageKey);
    } catch (err) {
      // Could not check (outage/timeout). The material stays UPLOADING —
      // completing is idempotent, so the client can simply try again.
      logServerError({ route: "materials/[id]/complete", op: "head-object", userId: user.id }, err);
      return jsonError("We couldn't verify your upload right now. Please try again in a moment.", 503, {
        code: "UPLOAD_VERIFY_UNAVAILABLE",
      });
    }

    if (!head) {
      // Nothing was uploaded (yet). Left UPLOADING so a retry of the PUT +
      // complete can still succeed within the URL's validity window.
      return jsonError("We couldn't find the uploaded file. Please upload it again.", 409, {
        code: "UPLOAD_NOT_FOUND",
      });
    }

    const { plan, remainingBytes } = await getStorageUsage(user.id);
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
      // Best-effort: don't leave an unusable (or over-limit) object behind.
      await storage.deleteObject(material.storageKey).catch((err) => {
        console.error("[materials/complete] failed to delete rejected upload", {
          materialId: material.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return jsonError(rejection.message, rejection.status);
    }

    const { material: updated, won } = await settleUpload(material.id, { status: "READY", sizeBytes: head.sizeBytes });
    if (won) {
      await logMaterialAddedIfGroup(updated, user.id);
      // Document extraction always runs as a fire-and-forget background job
      // regardless of storage backend — it never blocks this response.
      void queueDocumentExtractionIfNeeded(updated, user.id);
    }
    return NextResponse.json({ material: updated });
  }

  return jsonError("Storage backend is not recognized.", 500);
}
