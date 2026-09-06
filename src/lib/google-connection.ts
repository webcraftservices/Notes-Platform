import { db } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { refreshGoogleAccessToken, revokeGoogleToken, GOOGLE_DRIVE_SCOPES } from "@/lib/services/google-oauth";

/**
 * A single OAuth grant covers both Drive and Docs scopes (see the
 * ConnectedProvider schema comment), so every Google connection in this app
 * is stored under this one provider value.
 */
const PROVIDER = "GOOGLE_DRIVE" as const;

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google Drive isn't connected. Connect it in Settings to import files.");
    this.name = "GoogleNotConnectedError";
  }
}

/** Connection status for display — never returns token material. */
export async function getGoogleConnectionStatus(userId: string): Promise<{
  connected: boolean;
  email?: string;
  connectedAt?: Date;
  lastSyncedAt?: Date | null;
}> {
  const account = await db.connectedAccount.findFirst({
    where: { userId, provider: PROVIDER, revokedAt: null },
    orderBy: { connectedAt: "desc" },
  });
  if (!account) return { connected: false };
  return {
    connected: true,
    email: account.externalId,
    connectedAt: account.connectedAt,
    lastSyncedAt: account.lastSyncedAt,
  };
}

/** Upserts the connection after a successful OAuth callback. */
export async function saveGoogleConnection(input: {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
  await db.connectedAccount.upsert({
    where: { userId_provider_externalId: { userId: input.userId, provider: PROVIDER, externalId: input.email } },
    create: {
      userId: input.userId,
      provider: PROVIDER,
      externalId: input.email,
      accessToken: encryptSecret(input.accessToken),
      refreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : null,
      expiresAt,
      scopes: GOOGLE_DRIVE_SCOPES,
    },
    update: {
      accessToken: encryptSecret(input.accessToken),
      // Google only returns a refresh_token on the first consent (or when
      // prompt=consent forces re-issuance, which buildGoogleAuthUrl always
      // sets) — don't overwrite a previously stored one with null if this
      // particular response happened not to include it.
      ...(input.refreshToken ? { refreshToken: encryptSecret(input.refreshToken) } : {}),
      expiresAt,
      scopes: GOOGLE_DRIVE_SCOPES,
      revokedAt: null,
    },
  });
}

/**
 * Returns a currently-valid access token, transparently refreshing (and
 * persisting the refreshed token) if the stored one has expired. Throws
 * GoogleNotConnectedError if there's no connection, or the underlying
 * refresh error (already user-readable — see refreshGoogleAccessToken) if
 * the refresh itself fails, e.g. because access was revoked at Google.
 */
export async function getValidGoogleAccessToken(userId: string): Promise<string> {
  const account = await db.connectedAccount.findFirst({
    where: { userId, provider: PROVIDER, revokedAt: null },
    orderBy: { connectedAt: "desc" },
  });
  if (!account) throw new GoogleNotConnectedError();

  const stillValid = account.expiresAt && account.expiresAt.getTime() - Date.now() > 60_000;
  if (stillValid) {
    return decryptSecret(account.accessToken);
  }

  if (!account.refreshToken) {
    throw new Error("Google Drive access has expired or was revoked. Reconnect Google Drive to continue.");
  }

  const refreshed = await refreshGoogleAccessToken(decryptSecret(account.refreshToken));
  await db.connectedAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encryptSecret(refreshed.access_token),
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });
  return refreshed.access_token;
}

/**
 * Disconnects Google Drive for this user. Imported Materials are never
 * touched (spec §8/§18) — only the ConnectedAccount row is marked revoked.
 * The row itself is kept (rather than deleted) so lastSyncedAt/connectedAt
 * history survives, matching the soft-delete pattern used elsewhere
 * (Material.deletedAt, Subject.archivedAt).
 */
export async function disconnectGoogleAccount(userId: string): Promise<void> {
  const account = await db.connectedAccount.findFirst({
    where: { userId, provider: PROVIDER, revokedAt: null },
  });
  if (!account) return;

  await revokeGoogleToken(decryptSecret(account.accessToken));
  await db.connectedAccount.update({
    where: { id: account.id },
    data: { revokedAt: new Date() },
  });
}
