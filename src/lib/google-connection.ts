import { db } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { refreshGoogleAccessToken, revokeGoogleToken, GOOGLE_DRIVE_SCOPES } from "@/lib/services/google-oauth";
import { GoogleApiError, GOOGLE_RECONNECT_REQUIRED } from "@/lib/services/google-errors";
import { getGoogleDriveService } from "@/lib/services/google-drive";

/**
 * A single OAuth grant covers both Drive and Docs scopes (see the
 * ConnectedProvider schema comment), so every Google connection in this app
 * is stored under this one provider value.
 */
const PROVIDER = "GOOGLE_DRIVE" as const;

/**
 * Coalesces concurrent access-token refresh operations for the same userId
 * within the process so simultaneous webhook notifications, background jobs,
 * and interactive requests do not race to refresh the same OAuth grant.
 */
const inFlightTokenRefreshes = new Map<string, Promise<string>>();

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google Drive isn't connected. Connect it in Settings to import files.");
    this.name = "GoogleNotConnectedError";
  }
}

export interface GoogleConnectionStatus {
  connected: boolean;
  email?: string;
  connectedAt?: Date;
  lastSyncedAt?: Date | null;
  syncStatus?: string | null;
  lastSyncError?: string | null;
  watchActive?: boolean;
  watchExpiresAt?: Date | null;
}

/** Connection status for display — never returns token material. */
export async function getGoogleConnectionStatus(userId: string): Promise<GoogleConnectionStatus> {
  const account = await db.connectedAccount.findFirst({
    where: { userId, provider: PROVIDER, revokedAt: null },
    orderBy: { connectedAt: "desc" },
  });
  if (!account) return { connected: false };
  const watchActive = Boolean(
    account.watchChannelId &&
      account.watchResourceId &&
      account.watchExpiresAt &&
      account.watchExpiresAt.getTime() > Date.now()
  );
  return {
    connected: true,
    email: account.externalId,
    connectedAt: account.connectedAt,
    lastSyncedAt: account.lastSyncedAt,
    syncStatus: account.syncStatus ?? "IDLE",
    lastSyncError: account.lastSyncError ?? null,
    watchActive,
    watchExpiresAt: account.watchExpiresAt ?? null,
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
      syncStatus: "IDLE",
      lastSyncError: null,
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
      syncStatus: "IDLE",
      lastSyncError: null,
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
  const existingRefresh = inFlightTokenRefreshes.get(userId);
  if (existingRefresh) {
    return existingRefresh;
  }

  const refreshPromise = (async () => {
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
      await db.connectedAccount
        .update({
          where: { id: account.id },
          data: { syncStatus: "RECONNECT_REQUIRED", lastSyncError: GOOGLE_RECONNECT_REQUIRED },
        })
        .catch(() => undefined);
      throw new GoogleApiError(GOOGLE_RECONNECT_REQUIRED, { status: 401, publicMessage: GOOGLE_RECONNECT_REQUIRED });
    }

    try {
      const refreshed = await refreshGoogleAccessToken(decryptSecret(account.refreshToken));
      await db.connectedAccount.update({
        where: { id: account.id },
        data: {
          accessToken: encryptSecret(refreshed.access_token),
          expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
          ...(account.syncStatus === "RECONNECT_REQUIRED"
            ? { syncStatus: "IDLE", lastSyncError: null }
            : {}),
        },
      });
      return refreshed.access_token;
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 400 || err.status === 401)) {
        await db.connectedAccount
          .update({
            where: { id: account.id },
            data: { syncStatus: "RECONNECT_REQUIRED", lastSyncError: GOOGLE_RECONNECT_REQUIRED },
          })
          .catch(() => undefined);
      }
      throw err;
    }
  })();

  inFlightTokenRefreshes.set(userId, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    inFlightTokenRefreshes.delete(userId);
  }
}

/**
 * Disconnects Google Drive for this user. Imported Materials are never
 * touched (spec §8/§18) — only the ConnectedAccount row is marked revoked.
 * Active Drive push notification watch channels are stopped best-effort and
 * cleared so stale webhooks for the disconnected channel are rejected.
 */
export async function disconnectGoogleAccount(userId: string): Promise<void> {
  const account = await db.connectedAccount.findFirst({
    where: { userId, provider: PROVIDER, revokedAt: null },
  });
  if (!account) return;

  const accessToken = (() => {
    try {
      return decryptSecret(account.accessToken);
    } catch {
      return null;
    }
  })();

  if (accessToken && account.watchChannelId && account.watchResourceId) {
    await getGoogleDriveService()
      .stopWatchChannel({
        accessToken,
        channelId: account.watchChannelId,
        resourceId: account.watchResourceId,
      })
      .catch(() => undefined);
  }

  if (accessToken) {
    await revokeGoogleToken(accessToken);
  }

  await db.connectedAccount.update({
    where: { id: account.id },
    data: {
      revokedAt: new Date(),
      watchChannelId: null,
      watchResourceId: null,
      watchTokenHash: null,
      watchExpiresAt: null,
      changesPageToken: null,
      lastWebhookMessageNumber: null,
      syncStatus: null,
      lastSyncError: null,
    },
  });
}
