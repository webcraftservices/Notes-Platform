import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import {
  exportOrSyncNoteWithGoogleDocs,
  getNoteGoogleSyncState,
  NoteNotFoundOrForbiddenError,
} from "@/lib/google-note-sync";
import { GoogleNotConnectedError } from "@/lib/google-connection";
import { GoogleDriveNotEnabledError } from "@/lib/google-import";
import { googleFailureResponse } from "@/lib/google-route-errors";
import { noteGoogleSyncRequestSchema } from "@/lib/validation/google";
import { rateLimit } from "@/lib/rate-limit";
import { UNAUTHORIZED, jsonError, zodError } from "@/lib/api-response";

/**
 * Phase 14 (Task 14-03) — Bidirectional Google Docs Note Sync API Route.
 *
 * GET  /api/notes/[noteId]/google-sync — inspects current Google Docs link & sync state
 * POST /api/notes/[noteId]/google-sync — exports Note to Google Docs or synchronizes changes
 */
export async function GET(
  _req: Request,
  { params }: { params: { noteId: string } }
) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const state = await getNoteGoogleSyncState(params.noteId, user.id);
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof NoteNotFoundOrForbiddenError) {
      return jsonError(err.message, err.status);
    }
    return googleFailureResponse(err, {
      route: "notes/[noteId]/google-sync",
      op: "status",
      userId: user.id,
    });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { noteId: string } }
) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success } = await rateLimit(`note-google-sync:${user.id}`, {
    limit: 20,
    windowSeconds: 60,
  });
  if (!success) {
    return jsonError("Too many requests. Slow down and try again.", 429);
  }

  const rawBody = await req.json().catch(() => ({}));
  const parsed = noteGoogleSyncRequestSchema.safeParse(rawBody ?? {});
  if (!parsed.success) return zodError(parsed.error);

  try {
    const result = await exportOrSyncNoteWithGoogleDocs(params.noteId, user.id, {
      direction: parsed.data.direction,
      forceResolution: parsed.data.forceResolution,
    });
    const httpStatus = result.status === "conflict" ? 409 : 200;
    return NextResponse.json(result, { status: httpStatus });
  } catch (err) {
    if (err instanceof NoteNotFoundOrForbiddenError) {
      return jsonError(err.message, err.status);
    }
    if (err instanceof GoogleNotConnectedError) {
      return jsonError(err.message, 409);
    }
    if (err instanceof GoogleDriveNotEnabledError) {
      return jsonError(err.message, 403);
    }
    return googleFailureResponse(err, {
      route: "notes/[noteId]/google-sync",
      op: "sync",
      userId: user.id,
    });
  }
}

