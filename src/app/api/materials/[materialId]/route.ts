import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleMaterial, NotAuthorizedError, getPrimaryWorkspace } from "@/lib/access";
import { updateMaterialSchema } from "@/lib/validation/materials";
import { resolveMaterialScope, ScopeNotFoundError } from "@/lib/materials-scope";
import { getStorageService } from "@/lib/services/storage";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { ActivityAction, createActivityLog } from "@/lib/activity";

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
    let scopeUpdate = {};
    if (movingScope) {
      const workspace = await getPrimaryWorkspace(user.id);
      // Explicit null anywhere in the move payload means "detach entirely"
      // (Unorganized); otherwise resolve whichever id was actually passed.
      const isDetach = subjectId === null && chapterId === null && topicId === null;
      // Detaching must not silently move a Material between owners
      // (Phase 6.4 requirement 10): a group Material stays "Unorganized
      // within its Group" (groupId preserved, workspaceId stays null), a
      // workspace Material stays "Unorganized within the workspace" —
      // exactly the pre-Phase-6.4 behavior, unchanged, when existing.groupId
      // is null.
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

    const material = await db.material.update({
      where: { id: params.materialId },
      data: {
        ...rest,
        ...scopeUpdate,
        ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
      },
    });
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

    // Soft-delete the row immediately (so it disappears from every list
    // right away) and best-effort remove the underlying object from
    // storage. A failed object delete doesn't block the API response —
    // the row is gone either way and the file is orphaned rather than
    // dangerously left "deleted but still downloadable".
    await db.material.update({ where: { id: params.materialId }, data: { deletedAt: new Date() } });

    if (existing.groupId) {
      await createActivityLog(db, {
        groupId: existing.groupId,
        userId: user.id,
        action: ActivityAction.MATERIAL_REMOVED,
        targetType: "material",
        targetId: existing.id,
        metadata: { targetName: existing.title },
      });
    }

    if (existing.storageKey) {
      getStorageService()
        .deleteObject(existing.storageKey)
        .catch((err) => console.error(`Failed to delete storage object ${existing.storageKey}:`, err));
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
