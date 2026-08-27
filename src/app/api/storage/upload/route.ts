import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/access";
import { getStorageService } from "@/lib/services/storage";
import { LocalStorageService } from "@/lib/services/storage-local";
import { getPlanLimits } from "@/lib/plans";
import { jsonError, UNAUTHORIZED } from "@/lib/api-response";

/**
 * Only meaningful for the local storage backend — when STORAGE_PROVIDER=s3,
 * uploads go straight from the browser to object storage via a real
 * presigned URL and never touch this route (see storage-s3.ts).
 *
 * Buffers the request body in memory before writing to disk. That's a
 * known, documented limitation of the local backend (fine for dev/demo,
 * wrong for production-scale uploads) — see the class doc on
 * LocalStorageService for why the S3 backend exists.
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
  if (!material) return jsonError("Unknown upload target.", 404);
  if (material.ownerId !== user.id) return jsonError("Not authorized.", 403);
  if (material.status !== "UPLOADING") {
    return jsonError("This upload has already been completed or is no longer valid.", 409);
  }

  const subscription = await db.subscription.findUnique({ where: { userId: user.id } });
  const plan = getPlanLimits(subscription?.plan ?? "FREE");

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

  await storage.writeFile(key, buffer);

  // Real size, from the bytes actually written — never trust the client's
  // declared Content-Length (spec §87).
  await db.material.update({ where: { id: material.id }, data: { sizeBytes: buffer.byteLength } });

  return NextResponse.json({ success: true, sizeBytes: buffer.byteLength });
}
