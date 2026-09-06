import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import { exchangeCodeForTokens, fetchGoogleUserEmail, GoogleNotConfiguredError } from "@/lib/services/google-oauth";
import { verifyOAuthState } from "@/lib/services/google-oauth-state";
import { saveGoogleConnection } from "@/lib/google-connection";

function getRedirectUri(req: Request): string {
  const base = process.env.NEXTAUTH_URL || new URL(req.url).origin;
  return `${base.replace(/\/$/, "")}/api/integrations/google/callback`;
}

function settingsRedirect(req: Request, params: Record<string, string>): NextResponse {
  const base = process.env.NEXTAUTH_URL || new URL(req.url).origin;
  const url = new URL("/settings", base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return settingsRedirect(req, { google: "error", message: "Sign in first, then reconnect Google Drive." });

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) {
    // The user declined consent on Google's screen, or Google rejected the
    // request — either way this is a normal outcome, not a server error.
    return settingsRedirect(req, { google: "error", message: "Google Drive connection was cancelled." });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !verifyOAuthState(state, user.id)) {
    return settingsRedirect(req, { google: "error", message: "Google Drive connection could not be completed." });
  }

  try {
    const tokens = await exchangeCodeForTokens({ code, redirectUri: getRedirectUri(req) });
    const email = await fetchGoogleUserEmail(tokens.access_token);
    await saveGoogleConnection({
      userId: user.id,
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSeconds: tokens.expires_in,
    });
    return settingsRedirect(req, { google: "connected" });
  } catch (err) {
    const message =
      err instanceof GoogleNotConfiguredError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Google Drive connection could not be completed.";
    return settingsRedirect(req, { google: "error", message });
  }
}
