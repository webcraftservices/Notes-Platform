import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { getSessionUser, getPrimaryWorkspace, NotAuthorizedError } from "@/lib/access";
import { requestUploadSchema } from "@/lib/validation/materials";
import { resolveMaterialScope, ScopeNotFoundError } from "@/lib/materials-scope";
import { resolveMaterialType, guessExtension } from "@/lib/mime";
import { getStorageService } from "@/lib/services/storage";
import { getStorageUsage } from "@/lib/storage-usage";
import { zodError, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, jsonError } from "@/lib/api-response";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = requestUploadSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);
  const { filename, mimeType, sizeBytes, ...scopeInput } = parsed.data;

  // Normalize MIME: strip any parameters (e.g. "audio/webm;codecs=opus")
  const mimeTypeStr = String(mimeType ?? "");
  const baseMimeType = ((mimeTypeStr.split(";")[0] ?? "").trim()).toLowerCase();

  const materialType = resolveMaterialType(baseMimeType);
  if (!materialType) {
    return jsonError(
      "That file type isn't supported yet. Supported: PDF, Word, PowerPoint, text, images, audio, and video.",
      415
    );
  }

  const { plan, remainingBytes } = await getStorageUsage(user.id);
  if (sizeBytes > plan.maxFileSizeBytes) {
    return jsonError(
      `File exceeds your plan's ${Math.round(plan.maxFileSizeBytes / (1024 * 1024))}MB per-file limit.`,
      413
    );
  }
  if (sizeBytes > remainingBytes) {
    return jsonError("This would exceed your plan's storage limit.", 413);
  }

  const workspace = await getPrimaryWorkspace(user.id);

  let scope;
  try {
    scope = await resolveMaterialScope(scopeInput, user.id, workspace.id);
  } catch (err) {
    if (err instanceof ScopeNotFoundError) return NOT_FOUND();
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }

  if (!scope) {
    return jsonError("Couldn't resolve material scope.", 400);
  }

  const materialId = nanoid(21);
  const storageKey = `materials/${user.id}/${materialId}.${guessExtension(baseMimeType)}`;

  const material = await db.material.create({
    data: {
      id: materialId,
      ownerId: user.id,
      workspaceId: scope.workspaceId,
      subjectId: scope.subjectId,
      chapterId: scope.chapterId,
      topicId: scope.topicId,
      type: materialType,
      title: String(filename).replace(/\.[^/.]+$/, "") || String(filename),
      originalFilename: String(filename),
      // Persist the normalized base MIME type (without parameters)
      mimeType: baseMimeType,
      storageKey,
      status: "UPLOADING",
    },
  });

  const storage = getStorageService();
  const { uploadUrl } = await storage.createUploadUrl({
    key: storageKey,
    contentType: baseMimeType,
    maxSizeBytes: plan.maxFileSizeBytes,
  });

  return NextResponse.json({
    materialId: material.id,
    uploadUrl,
    // For the S3 backend the browser needs to PUT with this exact method +
    // header; for the local backend it's the same PUT-with-body contract,
    // so the client doesn't need to branch on provider at all.
    method: "PUT",
    headers: { "Content-Type": baseMimeType },
  });
}
