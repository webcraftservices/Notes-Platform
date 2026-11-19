import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  connectedAccount: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));

vi.mock("@/lib/crypto", () => ({
  encryptSecret: (val: string) => `enc:${val}`,
  decryptSecret: (val: string) => val.replace(/^enc:/, ""),
}));

const oauthMocks = vi.hoisted(() => ({
  refreshGoogleAccessToken: vi.fn(),
  revokeGoogleToken: vi.fn().mockResolvedValue(undefined),
  GOOGLE_DRIVE_SCOPES: ["scope1"],
}));
vi.mock("@/lib/services/google-oauth", () => oauthMocks);

const driveMocks = vi.hoisted(() => ({
  stopWatchChannel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/services/google-drive", () => ({
  getGoogleDriveService: () => driveMocks,
}));

import {
  disconnectGoogleAccount,
  getGoogleConnectionStatus,
  getValidGoogleAccessToken,
} from "../google-connection";
import { GoogleApiError, GOOGLE_RECONNECT_REQUIRED } from "../services/google-errors";

describe("google-connection token refresh concurrency & watch-channel cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.connectedAccount.update.mockResolvedValue({});
  });

  it("coalesces concurrent expired-token refreshes for the same user into a single OAuth refresh request", async () => {
    db.connectedAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      userId: "user-1",
      accessToken: "enc:expired-access",
      refreshToken: "enc:valid-refresh",
      expiresAt: new Date(Date.now() - 10_000),
      syncStatus: "IDLE",
    });

    oauthMocks.refreshGoogleAccessToken.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                access_token: "fresh-access-token",
                expires_in: 3600,
                scope: "scope1",
                token_type: "Bearer",
              }),
            30
          )
        )
    );

    const [t1, t2, t3] = await Promise.all([
      getValidGoogleAccessToken("user-1"),
      getValidGoogleAccessToken("user-1"),
      getValidGoogleAccessToken("user-1"),
    ]);

    expect(t1).toBe("fresh-access-token");
    expect(t2).toBe("fresh-access-token");
    expect(t3).toBe("fresh-access-token");
    expect(oauthMocks.refreshGoogleAccessToken).toHaveBeenCalledTimes(1);
    expect(db.connectedAccount.update).toHaveBeenCalledTimes(1);
  });

  it("marks ConnectedAccount syncStatus as RECONNECT_REQUIRED when refresh fails with 400/401 invalid_grant", async () => {
    db.connectedAccount.findFirst.mockResolvedValue({
      id: "acc-1",
      userId: "user-1",
      accessToken: "enc:expired-access",
      refreshToken: "enc:revoked-refresh",
      expiresAt: new Date(Date.now() - 10_000),
    });

    oauthMocks.refreshGoogleAccessToken.mockRejectedValueOnce(
      new GoogleApiError(GOOGLE_RECONNECT_REQUIRED, {
        status: 400,
        publicMessage: GOOGLE_RECONNECT_REQUIRED,
      })
    );

    await expect(getValidGoogleAccessToken("user-1")).rejects.toMatchObject({
      status: 400,
    });
    expect(db.connectedAccount.update).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: {
        syncStatus: "RECONNECT_REQUIRED",
        lastSyncError: GOOGLE_RECONNECT_REQUIRED,
      },
    });
  });

  it("stops the active watch channel and clears watch/sync metadata on disconnectGoogleAccount", async () => {
    db.connectedAccount.findFirst.mockResolvedValueOnce({
      id: "acc-1",
      userId: "user-1",
      accessToken: "enc:live-token",
      watchChannelId: "watch-chan-1",
      watchResourceId: "watch-res-1",
    });

    await disconnectGoogleAccount("user-1");

    expect(driveMocks.stopWatchChannel).toHaveBeenCalledWith({
      accessToken: "live-token",
      channelId: "watch-chan-1",
      resourceId: "watch-res-1",
    });
    expect(oauthMocks.revokeGoogleToken).toHaveBeenCalledWith("live-token");
    expect(db.connectedAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "acc-1" },
        data: expect.objectContaining({
          watchChannelId: null,
          watchResourceId: null,
          watchTokenHash: null,
          watchExpiresAt: null,
          changesPageToken: null,
          lastWebhookMessageNumber: null,
          syncStatus: null,
          lastSyncError: null,
        }),
      })
    );
  });

  it("exposes watchActive and syncStatus in getGoogleConnectionStatus without exposing tokens", async () => {
    const futureDate = new Date(Date.now() + 3600_000);
    db.connectedAccount.findFirst.mockResolvedValueOnce({
      id: "acc-1",
      userId: "user-1",
      externalId: "user@example.com",
      accessToken: "enc:secret",
      refreshToken: "enc:secret-refresh",
      connectedAt: new Date("2026-11-12T00:00:00.000Z"),
      lastSyncedAt: new Date("2026-11-12T01:00:00.000Z"),
      syncStatus: "IDLE",
      lastSyncError: null,
      watchChannelId: "chan-1",
      watchResourceId: "res-1",
      watchExpiresAt: futureDate,
    });

    const status = await getGoogleConnectionStatus("user-1");
    expect(status).toEqual({
      connected: true,
      email: "user@example.com",
      connectedAt: new Date("2026-11-12T00:00:00.000Z"),
      lastSyncedAt: new Date("2026-11-12T01:00:00.000Z"),
      syncStatus: "IDLE",
      lastSyncError: null,
      watchActive: true,
      watchExpiresAt: futureDate,
    });
    expect(JSON.stringify(status)).not.toContain("secret");
  });
});

