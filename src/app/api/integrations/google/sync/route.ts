import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import {
  ensureDriveWatchChannel,
  syncGoogleDriveChangesForUser,
} from "@/lib/google-drive-sync";
import { GoogleNotConnectedError } from "@/lib/google-connection";
import { GoogleDriveNotEnabledError } from "@/lib/google-import";
import { googleFailureResponse } from "@/lib/google-route-errors";
import { googleDriveSyncRequestSchema } from "@/lib/validation/google";
import { rateLimit } from "@/lib/rate-limit";
import { UNAUTHORIZED, jsonError, zodError } from "@/lib/api-response";

/**
 * Phase 14 (Task 14-01) — Authenticated Incremental Google Drive Sync &
 * Watch-Channel Registration/Renewal Endpoint.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success } = await rateLimit(`google-sync:${user.id}`, {
    limit: 20,
    windowSeconds: 60,
  });
  if (!success) {
    return jsonError("Too many sync requests. Slow down and try again.", 429);
  }

  const rawBody = await req.json().catch(() => ({}));
  const parsed = googleDriveSyncRequestSchema.safeParse(rawBody ?? {});
  if (!parsed.success) return zodError(parsed.error);

  try {
    const summary = await syncGoogleDriveChangesForUser(user.id);
    let watch = null;
    if (parsed.data.registerWatch !== false) {
      watch = await ensureDriveWatchChannel(user.id, {
        forceRenew: parsed.data.forceRenewWatch,
      }).catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      summary,
      watch,
    });
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return jsonError(err.message, 409);
    if (err instanceof GoogleDriveNotEnabledError) return jsonError(err.message, 403);
    return googleFailureResponse(err, {
      route: "integrations/google/sync",
      op: "sync",
      userId: user.id,
    });
  }
}

