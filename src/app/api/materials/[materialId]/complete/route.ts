import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/access";
import { getStorageService } from "@/lib/services/storage";
import { LocalStorageService } from "@/lib/services/storage-local";
import { extractMetadata } from "@/lib/metadata-extraction";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, jsonError } from "@/lib/api-response";
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
  // The S3 backend received the upload directly from the browser and
  // never gave this server the bytes — downloading the whole object back
  // down just to extract a page count/duration is a real cost this phase
  // chooses not to pay yet, so S3-backed materials go straight to READY
  // without metadata. See docs/ARCHITECTURE.md Phase 3 notes.
  if (storage instanceof LocalStorageService) {
    try {
      const stats = await storage.readFileStats(material.storageKey);
      const buffer = await storage.readFile(material.storageKey);
      const metadata = await extractMetadata(material.type, buffer);

      const updated = await db.material.update({
        where: { id: material.id },
        data: {
          status: "READY",
          sizeBytes: stats.size,
          durationSeconds: metadata.durationSeconds ?? null,
          metadata: metadata.extractionError
            ? { extractionError: metadata.extractionError }
            : { pageCount: metadata.pageCount, width: metadata.width, height: metadata.height },
        },
      });
      await logMaterialAddedIfGroup(updated, user.id);
      return NextResponse.json({ material: updated });
    } catch {
      const updated = await db.material.update({
        where: { id: material.id },
        data: { status: "FAILED" },
      });
      return NextResponse.json({ material: updated }, { status: 422 });
    }
  }

  const updated = await db.material.update({ where: { id: material.id }, data: { status: "READY" } });
  await logMaterialAddedIfGroup(updated, user.id);
  return NextResponse.json({ material: updated });
}
