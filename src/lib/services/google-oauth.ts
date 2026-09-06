/** Thrown when Google OAuth client credentials aren't configured. Kept
 * distinct from ServiceNotConfiguredError (interfaces.ts) because that
 * error's message hardcodes a pointer to docs/ai-setup.md, which isn't
 * where Google Drive/Docs setup is documented (docs/google-setup.md). */
export class GoogleNotConfiguredError extends Error {
  constructor(missingEnvVars: string[]) {
    super(
      `Google Drive/Docs integration is not configured. Set the following environment ` +
        `variable(s): ${missingEnvVars.join(", ")}. See docs/google-setup.md for activation steps.`
    );
    this.name = "GoogleNotConfiguredError";
  }
}

/**
 * Real REST integration against Google's OAuth 2.0 endpoints — no
 * `googleapis` SDK dependency, matching the plain-`fetch` style already used
 * by speech-openai.ts and speech-assemblyai.ts rather than adding a large
 * client library for a handful of well-documented HTTP calls.
 *
 * This is a *separate authorization* from NextAuth's Google sign-in
 * provider (see lib/auth.ts) — signing in with Google never implies Drive
 * access (spec §7). It reuses the same OAuth client credentials by default
 * (GOOGLE_DRIVE_CLIENT_ID/SECRET falling back to GOOGLE_CLIENT_ID/SECRET)
 * so most deployments don't need a second Google Cloud OAuth client, but the
 * separate env vars exist so one can be configured later — see
 * docs/google-setup.md.
 */

export const GOOGLE_DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleNotConfiguredError([
      "GOOGLE_DRIVE_CLIENT_ID (or GOOGLE_CLIENT_ID)",
      "GOOGLE_DRIVE_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET)",
    ]);
  }
  return { clientId, clientSecret };
}

export function buildGoogleAuthUrl(input: { redirectUri: string; state: string }): string {
  const { clientId } = getGoogleOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    access_type: "offline",
    // Forces Google to re-issue a refresh_token even for a user who
    // previously granted these scopes — without this, reconnecting after a
    // revoke can silently come back with no refresh_token at all.
    prompt: "consent",
    scope: GOOGLE_DRIVE_SCOPES.join(" "),
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function exchangeCodeForTokens(input: {
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Google access token refresh failed (${res.status}): ${body.slice(0, 300)}. ` +
        `Google Drive access may have been revoked — reconnect it in Settings.`
    );
  }
  return res.json();
}

export async function revokeGoogleToken(token: string): Promise<void> {
  // Best-effort — a failed revoke call shouldn't block disconnecting inside
  // this app (the ConnectedAccount row's revokedAt is the source of truth
  // for whether *this app* will use the token again either way).
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
  }).catch(() => undefined);
}

export async function fetchGoogleUserEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Could not read the connected Google account's email (${res.status}).`);
  const data = (await res.json()) as { email?: string };
  if (!data.email) throw new Error("Google did not return an email for this account.");
  return data.email;
}
