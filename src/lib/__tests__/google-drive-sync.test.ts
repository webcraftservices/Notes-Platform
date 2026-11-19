import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prisma/client", () => ({
  Prisma: {
    DbNull: Symbol("DbNull"),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    join: (rows: unknown[]) => ({ rows }),
  },
}));

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn().mockResolvedValue(1),
  material: { update: vi.fn() },
  processingJob: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
}));

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  connectedAccount: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  material: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  note: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));

const connectionMocks = vi.hoisted(() => ({
  getValidGoogleAccessToken: vi.fn(),
  GoogleNotConnectedError: class GoogleNotConnectedError extends Error {},
}));
vi.mock("@/lib/google-connection", () => connectionMocks);

const importMocks = vi.hoisted(() => ({
  assertGoogleDriveSyncAllowed: vi.fn().mockResolvedValue(undefined),
  runGoogleImportJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/google-import", () => importMocks);

const noteSyncMocks = vi.hoisted(() => ({
  exportOrSyncNoteWithGoogleDocs: vi.fn(),
}));
vi.mock("@/lib/google-note-sync", () => noteSyncMocks);

const jobMocks = vi.hoisted(() => ({
  createJobIfNoneActiveWithin: vi.fn(),
}));
vi.mock("@/lib/processing-jobs", () => jobMocks);

const driveMocks = vi.hoisted(() => ({
  getStartPageToken: vi.fn(),
  listChanges: vi.fn(),
  watchChanges: vi.fn(),
  stopWatchChannel: vi.fn(),
  getFileSyncMetadata: vi.fn(),
}));
vi.mock("@/lib/services/google-drive", () => ({
  getGoogleDriveService: () => driveMocks,
}));

import {
  ensureDriveWatchChannel,
  generateWatchChannelToken,
  handleGoogleDriveWebhook,
  hashWatchChannelToken,
  renewExpiringWatchChannels,
  syncGoogleDriveChangesForUser,
  verifyWatchChannelToken,
} from "../google-drive-sync";
import {
  GoogleApiError,
  GoogleInvalidPageTokenError,
  GOOGLE_RECONNECT_REQUIRED,
  GOOGLE_TEMPORARILY_UNAVAILABLE,
} from "../services/google-errors";

describe("Google Drive Push Webhook & Incremental Changes API Sync (Task 14-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    db.connectedAccount.update.mockResolvedValue({});
    db.material.update.mockResolvedValue({});
    db.note.update.mockResolvedValue({});
    driveMocks.stopWatchChannel.mockResolvedValue(undefined);
    connectionMocks.getValidGoogleAccessToken.mockResolvedValue("ya29.valid-token");
    importMocks.assertGoogleDriveSyncAllowed.mockResolvedValue(undefined);
    importMocks.runGoogleImportJob.mockResolvedValue(undefined);
    jobMocks.createJobIfNoneActiveWithin.mockResolvedValue({
      job: { id: "job-sync-1" },
      created: true,
    });
  });

  describe("Webhook token signing & verification", () => {
    it("verifies valid signed channel tokens in constant time and rejects tampered or forged tokens", () => {
      const rawToken = generateWatchChannelToken("acc-1", "chan-1");
      const tokenHash = hashWatchChannelToken(rawToken);

      expect(verifyWatchChannelToken(rawToken, tokenHash)).toBe(true);
      expect(verifyWatchChannelToken(`${rawToken}-tampered`, tokenHash)).toBe(false);
      expect(verifyWatchChannelToken("", tokenHash)).toBe(false);
      expect(verifyWatchChannelToken(null, tokenHash)).toBe(false);
      expect(verifyWatchChannelToken(rawToken, "short")).toBe(false);
    });

    it("rejects missing headers, unknown channels, mismatched resource IDs, and forged channel tokens", async () => {
      const missingRes = await handleGoogleDriveWebhook({
        channelId: null,
        channelToken: "tok",
        resourceId: "res-1",
        resourceState: "change",
        messageNumber: "1",
      });
      expect(missingRes).toMatchObject({ ok: false, httpStatus: 400 });

      db.connectedAccount.findFirst.mockResolvedValueOnce(null);
      const unknownChannel = await handleGoogleDriveWebhook({
        channelId: "chan-unknown",
        channelToken: "tok",
        resourceId: "res-1",
        resourceState: "change",
        messageNumber: "1",
      });
      expect(unknownChannel).toMatchObject({ ok: false, httpStatus: 404 });

      const rawToken = generateWatchChannelToken("acc-1", "chan-1");
      const tokenHash = hashWatchChannelToken(rawToken);

      db.connectedAccount.findFirst.mockResolvedValueOnce({
        id: "acc-1",
        userId: "user-1",
        watchChannelId: "chan-1",
        watchResourceId: "res-expected",
        watchTokenHash: tokenHash,
        lastWebhookMessageNumber: null,
      });
      const resourceMismatch = await handleGoogleDriveWebhook({
        channelId: "chan-1",
        channelToken: rawToken,
        resourceId: "res-wrong",
        resourceState: "change",
        messageNumber: "1",
      });
      expect(resourceMismatch).toMatchObject({ ok: false, httpStatus: 401 });

      db.connectedAccount.findFirst.mockResolvedValueOnce({
        id: "acc-1",
        userId: "user-1",
        watchChannelId: "chan-1",
        watchResourceId: "res-expected",
        watchTokenHash: tokenHash,
        lastWebhookMessageNumber: null,
      });
      const forgedToken = await handleGoogleDriveWebhook({
        channelId: "chan-1",
        channelToken: "forged-token",
        resourceId: "res-expected",
        resourceState: "change",
        messageNumber: "1",
      });
      expect(forgedToken).toMatchObject({ ok: false, httpStatus: 401 });
    });

    it("acknowledges initial sync handshakes and suppresses duplicate or out-of-order message numbers idempotently", async () => {
      const rawToken = generateWatchChannelToken("acc-1", "chan-1");
      const tokenHash = hashWatchChannelToken(rawToken);

      db.connectedAccount.findFirst.mockResolvedValueOnce({
        id: "acc-1",
        userId: "user-1",
        watchChannelId: "chan-1",
        watchResourceId: "res-1",
        watchTokenHash: tokenHash,
        lastWebhookMessageNumber: null,
      });

      const syncHandshake = await handleGoogleDriveWebhook({
        channelId: "chan-1",
        channelToken: rawToken,
        resourceId: "res-1",
        resourceState: "sync",
        messageNumber: "1",
      });

      expect(syncHandshake).toEqual({
        ok: true,
        httpStatus: 200,
        status: "sync_ack",
      });
      expect(db.connectedAccount.update).toHaveBeenCalledWith({
        where: { id: "acc-1" },
        data: { lastWebhookMessageNumber: 1n },
      });

      // Duplicate message number (10 <= 10) and out-of-order message number (9 <= 10)
      db.connectedAccount.findFirst.mockResolvedValue({
        id: "acc-1",
        userId: "user-1",
        watchChannelId: "chan-1",
        watchResourceId: "res-1",
        watchTokenHash: tokenHash,
        lastWebhookMessageNumber: 10n,
      });

      const duplicate = await handleGoogleDriveWebhook({
        channelId: "chan-1",
        channelToken: rawToken,
        resourceId: "res-1",
        resourceState: "change",
        messageNumber: "10",
      });
      expect(duplicate).toEqual({
        ok: true,
        httpStatus: 200,
        status: "duplicate_ignored",
      });

      const outOfOrder = await handleGoogleDriveWebhook({
        channelId: "chan-1",
        channelToken: rawToken,
        resourceId: "res-1",
        resourceState: "change",
        messageNumber: "8",
      });
      expect(outOfOrder).toEqual({
        ok: true,
        httpStatus: 200,
        status: "duplicate_ignored",
      });
      expect(driveMocks.listChanges).not.toHaveBeenCalled();
    });
  });

  describe("Incremental Changes API synchronization", () => {
    it("deduplicates multiple changes to the same file within a window, updates modified materials in <30s, skips unchanged files, and marks trashed files without deleting user data", async () => {
      const rawToken = generateWatchChannelToken("acc-1", "chan-1");
      const tokenHash = hashWatchChannelToken(rawToken);

      db.connectedAccount.findFirst.mockResolvedValue({
        id: "acc-1",
        userId: "user-1",
        watchChannelId: "chan-1",
        watchResourceId: "res-1",
        watchTokenHash: tokenHash,
        changesPageToken: "page-token-100",
        lastWebhookMessageNumber: 1n,
        watchExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      });

      // Two changes for file-modified in the same window (t1 then t2), one unchanged file, and one trashed file
      driveMocks.listChanges.mockResolvedValueOnce({
        changes: [
          {
            fileId: "file-modified",
            removed: false,
            file: {
              id: "file-modified",
              name: "Draft v1",
              mimeType: "application/vnd.google-apps.document",
              modifiedTime: "2026-11-12T10:00:00.000Z",
            },
          },
          {
            fileId: "file-modified",
            removed: false,
            file: {
              id: "file-modified",
              name: "Draft v2 Final",
              mimeType: "application/vnd.google-apps.document",
              modifiedTime: "2026-11-12T10:05:00.000Z",
              headRevisionId: "rev-2",
            },
          },
          {
            fileId: "file-unchanged",
            removed: false,
            file: {
              id: "file-unchanged",
              name: "Static Spec",
              mimeType: "application/pdf",
              modifiedTime: "2026-11-10T00:00:00.000Z",
            },
          },
          {
            fileId: "file-trashed",
            removed: false,
            file: {
              id: "file-trashed",
              name: "Old Slides",
              mimeType: "application/vnd.google-apps.presentation",
              modifiedTime: "2026-11-12T10:06:00.000Z",
              trashed: true,
            },
          },
        ],
        newStartPageToken: "page-token-101",
      });

      db.material.findMany.mockResolvedValueOnce([
        {
          id: "mat-mod",
          ownerId: "user-1",
          title: "Draft v0",
          status: "READY",
          externalRef: {
            provider: "google_drive",
            fileId: "file-modified",
            modifiedTime: "2026-11-11T00:00:00.000Z",
          },
        },
        {
          id: "mat-same",
          ownerId: "user-1",
          title: "Static Spec",
          status: "READY",
          externalRef: {
            provider: "google_drive",
            fileId: "file-unchanged",
            modifiedTime: "2026-11-10T00:00:00.000Z",
          },
        },
        {
          id: "mat-trash",
          ownerId: "user-1",
          title: "Old Slides",
          status: "READY",
          externalRef: {
            provider: "google_drive",
            fileId: "file-trashed",
            modifiedTime: "2026-11-09T00:00:00.000Z",
          },
        },
      ]);
      db.note.findMany.mockResolvedValueOnce([]);

      const startedAt = performance.now();
      const outcome = await handleGoogleDriveWebhook({
        channelId: "chan-1",
        channelToken: rawToken,
        resourceId: "res-1",
        resourceState: "change",
        messageNumber: "2",
      });
      const elapsedMs = performance.now() - startedAt;

      expect(elapsedMs).toBeLessThan(30_000);
      expect(outcome).toMatchObject({
        ok: true,
        httpStatus: 200,
        status: "processed",
        summary: {
          userId: "user-1",
          changesFetched: 4,
          uniqueFilesChanged: 3,
          materialsUpdated: 1,
          materialsMarkedDeleted: 1,
          materialsSkippedUnchanged: 1,
          pageTokenReset: false,
          newStartPageToken: "page-token-101",
        },
      });

      // Verify the latest change in the window ("Draft v2 Final") was applied once
      expect(tx.material.update).toHaveBeenCalledTimes(1);
      expect(tx.material.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mat-mod" },
          data: expect.objectContaining({
            title: "Draft v2 Final",
            status: "PROCESSING",
          }),
        })
      );
      expect(importMocks.runGoogleImportJob).toHaveBeenCalledTimes(1);
      expect(importMocks.runGoogleImportJob).toHaveBeenCalledWith("job-sync-1");

      // Verify trashed material was marked REMOTE_DELETED in externalRef without deleting the row
      expect(db.material.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mat-trash" },
          data: {
            externalRef: expect.objectContaining({
              fileId: "file-trashed",
              remoteDeleted: true,
              syncStatus: "REMOTE_DELETED",
            }),
          },
        })
      );
    });

    it("recovers from an expired/invalid pageToken (410 Gone) by fetching a new startPageToken and checking only tracked files", async () => {
      db.connectedAccount.findFirst.mockResolvedValue({
        id: "acc-1",
        userId: "user-1",
        changesPageToken: "expired-token",
        watchExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      });

      driveMocks.listChanges.mockRejectedValueOnce(new GoogleInvalidPageTokenError());
      driveMocks.getStartPageToken.mockResolvedValueOnce("fresh-start-token-200");

      // First findMany call inside collectTargetedChangesOnExpiredToken, second inside executeUserDriveSync
      const trackedMaterial = {
        id: "mat-1",
        ownerId: "user-1",
        title: "Tracked Slides",
        status: "READY",
        externalRef: {
          provider: "google_drive",
          fileId: "slides-file-1",
          modifiedTime: "2026-11-01T00:00:00.000Z",
        },
      };
      db.material.findMany.mockResolvedValue([trackedMaterial]);
      db.note.findMany.mockResolvedValue([]);

      driveMocks.getFileSyncMetadata.mockResolvedValueOnce({
        id: "slides-file-1",
        name: "Tracked Slides Updated",
        mimeType: "application/vnd.google-apps.presentation",
        modifiedTime: "2026-11-12T12:00:00.000Z",
        trashed: false,
      });

      const summary = await syncGoogleDriveChangesForUser("user-1");

      expect(summary.pageTokenReset).toBe(true);
      expect(summary.newStartPageToken).toBe("fresh-start-token-200");
      expect(summary.materialsUpdated).toBe(1);
      expect(driveMocks.getFileSyncMetadata).toHaveBeenCalledTimes(1);
      expect(driveMocks.getFileSyncMetadata).toHaveBeenCalledWith({
        accessToken: "ya29.valid-token",
        fileId: "slides-file-1",
      });
    });

    it("retries transient 503 Google Drive errors and marks account RECONNECT_REQUIRED on 401 revoked grant", async () => {
      db.connectedAccount.findFirst.mockResolvedValue({
        id: "acc-1",
        userId: "user-1",
        changesPageToken: "token-1",
      });

      // Transient 503 followed by 200 success
      driveMocks.listChanges
        .mockRejectedValueOnce(
          new GoogleApiError("503 Service Unavailable", {
            status: 503,
            publicMessage: GOOGLE_TEMPORARILY_UNAVAILABLE,
          })
        )
        .mockResolvedValueOnce({
          changes: [],
          newStartPageToken: "token-2",
        });

      const summary = await syncGoogleDriveChangesForUser("user-1");
      expect(summary.newStartPageToken).toBe("token-2");
      expect(driveMocks.listChanges).toHaveBeenCalledTimes(2);

      // Revoked grant (401)
      driveMocks.listChanges.mockRejectedValueOnce(
        new GoogleApiError(GOOGLE_RECONNECT_REQUIRED, {
          status: 401,
          publicMessage: GOOGLE_RECONNECT_REQUIRED,
        })
      );

      await expect(syncGoogleDriveChangesForUser("user-1")).rejects.toMatchObject({
        status: 401,
      });
      expect(db.connectedAccount.update).toHaveBeenCalledWith({
        where: { id: "acc-1" },
        data: {
          syncStatus: "RECONNECT_REQUIRED",
          lastSyncError: GOOGLE_RECONNECT_REQUIRED,
        },
      });
    });

    it("registers and renews expiring watch channels while stopping replaced channels", async () => {
      db.connectedAccount.findFirst.mockResolvedValue({
        id: "acc-1",
        userId: "user-1",
        changesPageToken: "page-1",
        watchChannelId: "old-channel",
        watchResourceId: "old-resource",
        watchTokenHash: "old-hash",
        watchExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // expiring in 1h (< 24h threshold)
      });

      driveMocks.watchChanges.mockResolvedValueOnce({
        id: "new-channel-id",
        resourceId: "new-resource-id",
        expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      driveMocks.stopWatchChannel.mockResolvedValueOnce(undefined);

      const watchRes = await ensureDriveWatchChannel("user-1", {
        webhookAddress: "https://zenote.example.com/api/integrations/google/webhook",
      });

      expect(watchRes.watchRegistered).toBe(true);
      expect(watchRes.channelId).toBe("new-channel-id");
      expect(watchRes.reason).toBe("registered");
      expect(driveMocks.stopWatchChannel).toHaveBeenCalledWith({
        accessToken: "ya29.valid-token",
        channelId: "old-channel",
        resourceId: "old-resource",
      });

      // Batch renewal of expiring channels
      db.connectedAccount.findMany.mockResolvedValueOnce([{ userId: "user-1" }]);
      driveMocks.watchChanges.mockResolvedValueOnce({
        id: "renewed-channel-id",
        resourceId: "renewed-resource-id",
      });
      process.env.GOOGLE_DRIVE_WEBHOOK_URL =
        "https://zenote.example.com/api/integrations/google/webhook";
      const batchRes = await renewExpiringWatchChannels();
      delete process.env.GOOGLE_DRIVE_WEBHOOK_URL;

      expect(batchRes).toEqual({ checked: 1, renewed: 1, failed: 0 });
    });

    it("does not advance lastWebhookMessageNumber or changesPageToken when sync fails, allowing retry of the same message number to succeed", async () => {
      const rawToken = generateWatchChannelToken("acc-retry", "chan-retry");
      const tokenHash = hashWatchChannelToken(rawToken);

      db.connectedAccount.findFirst.mockResolvedValue({
        id: "acc-retry",
        userId: "user-retry",
        watchChannelId: "chan-retry",
        watchResourceId: "res-retry",
        watchTokenHash: tokenHash,
        changesPageToken: "page-token-before",
        lastWebhookMessageNumber: 5n,
        watchExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      });

      // Attempt 1: non-retryable 403 error from Changes API
      driveMocks.listChanges.mockRejectedValueOnce(
        new GoogleApiError("Drive API quota error", {
          status: 403,
          publicMessage: "Drive API quota error",
        })
      );

      await expect(
        handleGoogleDriveWebhook({
          channelId: "chan-retry",
          channelToken: rawToken,
          resourceId: "res-retry",
          resourceState: "change",
          messageNumber: "6",
        })
      ).rejects.toThrow("Drive API quota error");

      // Neither lastWebhookMessageNumber nor changesPageToken was advanced on failure
      expect(db.connectedAccount.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastWebhookMessageNumber: 6n }),
        })
      );
      expect(db.connectedAccount.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ changesPageToken: expect.any(String) }),
        })
      );

      // Attempt 2: Google retries messageNumber "6" -> succeeds and advances both cursors
      driveMocks.listChanges.mockResolvedValueOnce({
        changes: [],
        newStartPageToken: "page-token-after",
      });

      const retryOutcome = await handleGoogleDriveWebhook({
        channelId: "chan-retry",
        channelToken: rawToken,
        resourceId: "res-retry",
        resourceState: "change",
        messageNumber: "6",
      });

      expect(retryOutcome).toMatchObject({
        ok: true,
        httpStatus: 200,
        status: "processed",
        summary: {
          newStartPageToken: "page-token-after",
        },
      });
      expect(db.connectedAccount.update).toHaveBeenCalledWith({
        where: { id: "acc-retry" },
        data: { lastWebhookMessageNumber: 6n },
      });
    });

    it("chains a follow-up sync pass when a second notification arrives while an initial sync is mid-flight", async () => {
      let currentPageToken = "token-pass-1";
      db.connectedAccount.findFirst.mockImplementation(async () => ({
        id: "acc-chain",
        userId: "user-chain",
        changesPageToken: currentPageToken,
      }));
      db.connectedAccount.update.mockImplementation(async ({ data }: { data: { changesPageToken?: string } }) => {
        if (data.changesPageToken) currentPageToken = data.changesPageToken;
        return {};
      });
      db.material.findMany.mockResolvedValue([]);
      db.note.findMany.mockResolvedValue([]);

      let resolveFirstChanges!: (v: unknown) => void;
      const firstChangesPromise = new Promise((resolve) => {
        resolveFirstChanges = resolve;
      });

      driveMocks.listChanges
        .mockImplementationOnce(() => firstChangesPromise)
        .mockResolvedValueOnce({
          changes: [{ fileId: "f-2", removed: false }],
          newStartPageToken: "token-pass-3",
        });

      const call1 = syncGoogleDriveChangesForUser("user-chain");
      // Wait a microtask so call1 is inside listChanges
      await new Promise((r) => setTimeout(r, 10));
      // Second concurrent call arrives while call1 is in flight
      const call2 = syncGoogleDriveChangesForUser("user-chain");

      resolveFirstChanges({
        changes: [{ fileId: "f-1", removed: false }],
        newStartPageToken: "token-pass-2",
      });

      const [res1, res2] = await Promise.all([call1, call2]);
      expect(driveMocks.listChanges).toHaveBeenCalledTimes(2);
      expect(res1.changesFetched).toBe(2);
      expect(res2.newStartPageToken).toBe("token-pass-3");
    });
  });
});
