import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/access";
import { getStorageService } from "@/lib/services/storage";
import { deleteStorageObjectSafely } from "@/lib/services/storage-cleanup";
import { LocalStorageService } from "@/lib/services/storage-local";
import { getStorageUsage } from "@/lib/storage-usage";
import { jsonError, UNAUTHORIZED } from "@/lib/api-response";

/**
 * Only meaningful for the local storage backend — when STORAGE_PROVIDER=s3,
 * uploads go straight from the browser to object storage via a real
 * presigned URL and never touch this route (see storage-s3.ts).
 */
export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const storage = getStorageService();
  if (!(storage instanceof LocalStorageService)) {
    return jsonError("This endpoint only serves the local storage backend.", 400);
  }

  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  if (!key) return jsonError("Missing key.", 400);

  const material = await db.material.findFirst({ where: { storageKey: key, deletedAt: null } });
  if (!material || material.deletedAt != null) return jsonError("Unknown upload target.", 404);
  if (material.ownerId !== user.id) return jsonError("Not authorized.", 403);
  if (material.status !== "UPLOADING") {
    return jsonError("This upload has already been completed or is no longer valid.", 409);
  }

  const dbAny = db as unknown as {
    groupMember?: { findFirst?: (args: unknown) => Promise<{ id: string } | null> };
    topic?: { findFirst?: (args: unknown) => Promise<{ id: string } | null> };
    chapter?: { findFirst?: (args: unknown) => Promise<{ id: string } | null> };
    subject?: { findFirst?: (args: unknown) => Promise<{ id: string } | null> };
    material: {
      updateMany?: (args: unknown) => Promise<{ count: number }>;
      update: (args: unknown) => Promise<unknown>;
    };
  };

  if (material.groupId && typeof dbAny.groupMember?.findFirst === "function") {
    const member = await dbAny.groupMember.findFirst({
      where: { groupId: material.groupId, userId: user.id, group: { deletedAt: null } },
      select: { id: true },
    });
    if (!member) {
      return jsonError("Unknown upload target.", 404);
    }
  }
  if (material.topicId && typeof dbAny.topic?.findFirst === "function") {
    const activeTopic = await dbAny.topic.findFirst({
      where: { id: material.topicId, deletedAt: null },
      select: { id: true },
    });
    if (!activeTopic) return jsonError("Unknown upload target.", 404);
  }
  if (material.chapterId && typeof dbAny.chapter?.findFirst === "function") {
    const activeChapter = await dbAny.chapter.findFirst({
      where: { id: material.chapterId, deletedAt: null },
      select: { id: true },
    });
    if (!activeChapter) return jsonError("Unknown upload target.", 404);
  }
  if (material.subjectId && typeof dbAny.subject?.findFirst === "function") {
    const activeSubject = await dbAny.subject.findFirst({
      where: { id: material.subjectId, deletedAt: null },
      select: { id: true },
    });
    if (!activeSubject) return jsonError("Unknown upload target.", 404);
  }

  const usage = await getStorageUsage(user.id);
  const plan = usage.plan;

  const arrayBuffer = await req.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength === 0) {
    return jsonError("Uploaded file is empty.", 400);
  }
  if (buffer.byteLength > plan.maxFileSizeBytes) {
    return jsonError(
      `File exceeds your plan's ${Math.round(plan.maxFileSizeBytes / (1024 * 1024))}MB limit.`,
      413
    );
  }
  if (buffer.byteLength > usage.remainingBytes) {
    return jsonError("This would exceed your plan's storage limit.", 413);
  }

  await storage.writeFile(key, buffer);

  // Conditionally update only if the material is still active and UPLOADING.
  // If a concurrent deletion or cancellation happened while writing bytes to disk,
  // remove the orphaned file immediately so no dangling object remains.
  if (typeof dbAny.material.updateMany === "function") {
    const { count } = await dbAny.material.updateMany({
      where: { id: material.id, deletedAt: null, status: "UPLOADING" },
      data: { sizeBytes: buffer.byteLength },
    });
    if (count === 0) {
      await deleteStorageObjectSafely(key, {
        route: "storage/upload",
        op: "cleanup-concurrently-deleted-local-upload",
        materialId: material.id,
        userId: user.id,
        storageService: storage,
      });
      return jsonError("Unknown upload target.", 404);
    }
  } else {
    await db.material.update({ where: { id: material.id }, data: { sizeBytes: buffer.byteLength } });
  }

  return NextResponse.json({ success: true, sizeBytes: buffer.byteLength });
}
