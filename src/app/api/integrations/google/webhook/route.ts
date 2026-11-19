import { NextResponse } from "next/server";
import { handleGoogleDriveWebhook } from "@/lib/google-drive-sync";
import { jsonError, logServerError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Phase 14 (Task 14-01) — Google Drive Push Notification Webhook Endpoint.
 *
 * Authenticates incoming Google Drive push notifications using Google's
 * `X-Goog-Channel-ID`, `X-Goog-Resource-ID`, `X-Goog-Resource-State`,
 * `X-Goog-Message-Number`, and constant-time HMAC verification of
 * `X-Goog-Channel-Token`.
 */
export async function POST(req: Request) {
  const channelId = req.headers.get("x-goog-channel-id");
  const channelToken = req.headers.get("x-goog-channel-token");
  const resourceId = req.headers.get("x-goog-resource-id");
  const resourceState = req.headers.get("x-goog-resource-state");
  const messageNumber = req.headers.get("x-goog-message-number");
  const channelExpiration = req.headers.get("x-goog-channel-expiration");

  const rateKey = channelId ? `google-webhook:${channelId.slice(0, 64)}` : "google-webhook:anon";
  const { success } = await rateLimit(rateKey, { limit: 120, windowSeconds: 60 });
  if (!success) {
    return jsonError("Too many webhook notifications.", 429);
  }

  try {
    const outcome = await handleGoogleDriveWebhook(
      {
        channelId,
        channelToken,
        resourceId,
        resourceState,
        messageNumber,
        channelExpiration,
      },
      { awaitImportJobs: false }
    );

    if (!outcome.ok) {
      return jsonError(outcome.error, outcome.httpStatus);
    }

    return NextResponse.json(
      {
        ok: true,
        status: outcome.status,
        ...(outcome.summary ? { summary: outcome.summary } : {}),
      },
      { status: 200 }
    );
  } catch (err) {
    logServerError(
      {
        route: "integrations/google/webhook",
        op: "webhook",
      },
      err
    );
    return jsonError("Webhook processing failed.", 500);
  }
}

