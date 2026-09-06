import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import { buildGoogleAuthUrl, GoogleNotConfiguredError } from "@/lib/services/google-oauth";
import { signOAuthState } from "@/lib/services/google-oauth-state";
import { assertGoogleDriveSyncAllowed, GoogleDriveNotEnabledError } from "@/lib/google-import";
import { rateLimit } from "@/lib/rate-limit";
import { UNAUTHORIZED, jsonError } from "@/lib/api-response";

function getRedirectUri(req: Request): string {
  const base = process.env.NEXTAUTH_URL || new URL(req.url).origin;
  return `${base.replace(/\/$/, "")}/api/integrations/google/callback`;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success } = await rateLimit(`google-connect:${user.id}`, { limit: 10, windowSeconds: 60 * 10 });
  if (!success) return jsonError("Too many attempts. Try again in a few minutes.", 429);

  try {
    await assertGoogleDriveSyncAllowed(user.id);
  } catch (err) {
    if (err instanceof GoogleDriveNotEnabledError) return jsonError(err.message, 403);
    throw err;
  }

  try {
    const state = signOAuthState(user.id);
    const url = buildGoogleAuthUrl({ redirectUri: getRedirectUri(req), state });
    return NextResponse.redirect(url);
  } catch (err) {
    if (err instanceof GoogleNotConfiguredError) return jsonError(err.message, 503);
    throw err;
  }
}
