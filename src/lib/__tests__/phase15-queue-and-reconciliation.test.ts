import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn().mockResolvedValue(1),
  material: { findUnique: vi.fn(), update: vi.fn() },
  processingJob: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
  },
  note: { findUnique: vi.fn(), update: vi.fn() },
}));

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  processingJob: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
  material: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  note: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));

const driveSyncMocks = vi.hoisted(() => ({
  renewExpiringWatchChannels: vi.fn(),
}));
vi.mock("@/lib/google-drive-sync", () => driveSyncMocks);

const notesAccess = vi.hoisted(() => ({
  getAccessibleNote: vi.fn().mockResolvedValue({ canWrite: true }),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => notesAccess);

vi.mock("@/lib/google-connection", () => ({
  getValidGoogleAccessToken: vi.fn().mockResolvedValue("ya29.test-token"),
}));
vi.mock("@/lib/google-import", () => ({
  assertGoogleDriveSyncAllowed: vi.fn().mockResolvedValue(undefined),
  runGoogleImportJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/services/google-drive", () => ({
  getGoogleDriveService: () => ({
    getFileSyncMetadata: vi.fn().mockResolvedValue({
      id: "gdoc-crash-1",
      modifiedTime: "2026-11-13T12:00:00.000Z",
      webViewLink: "https://docs.google.com/document/d/gdoc-crash-1/edit",
    }),
  }),
}));

const docsServiceMocks = vi.hoisted(() => ({
  createGoogleDocument: vi.fn(),
  getGoogleDocument: vi.fn(),
  batchUpdateGoogleDocument: vi.fn(),
}));
vi.mock("@/lib/services/google-docs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/google-docs")>();
  return {
    ...actual,
    createGoogleDocument: docsServiceMocks.createGoogleDocument,
    getGoogleDocument: docsServiceMocks.getGoogleDocument,
    batchUpdateGoogleDocument: docsServiceMocks.batchUpdateGoogleDocument,
  };
});

import {
  isBullMqEnabled,
  resolveBullMqRedisConfig,
} from "@/lib/queue/connection";
import { dispatchProcessingJob } from "@/lib/queue/dispatcher";
import {
  pruneCompletedProcessingJobs,
  reconcileStrandedProcessingJobs,
  runScheduledWatchChannelRenewal,
} from "@/lib/queue/reconciliation";
import {
  clearInMemoryNoteSyncRecoveryForTests,
  exportOrSyncNoteWithGoogleDocs,
} from "@/lib/google-note-sync";

describe("Phase 15 — Queue Connection, Dispatcher, and Crash Recovery (LIM-18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.material.findUnique.mockResolvedValue({ id: "mat-1", deletedAt: null });
    tx.processingJob.updateMany.mockResolvedValue({ count: 0 });
    tx.processingJob.findFirst.mockResolvedValue(null);
  });

  describe("Redis TCP configuration resolution", () => {
    it("resolves explicit BULLMQ_REDIS_URL, REDIS_URL, or derives TLS TCP URL from Upstash REST env vars", () => {
      const explicit = resolveBullMqRedisConfig({
        NODE_ENV: "production",
        BULLMQ_REDIS_URL: "rediss://default:secret@redis-host.example.com:6379",
      });
      expect(explicit).toMatchObject({
        source: "BULLMQ_REDIS_URL",
        host: "redis-host.example.com",
        port: 6379,
        tls: true,
      });

      const derived = resolveBullMqRedisConfig({
        NODE_ENV: "production",
        UPSTASH_REDIS_REST_URL: "https://prime-bluejay-312074.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "my-token-123",
      });
      expect(derived).toMatchObject({
        source: "UPSTASH_DERIVED",
        host: "prime-bluejay-312074.upstash.io",
        port: 6379,
        tls: true,
      });

      const disabled = resolveBullMqRedisConfig({
        NODE_ENV: "production",
        UPSTASH_REDIS_REST_URL: "https://prime-bluejay-312074.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "my-token-123",
        BULLMQ_DISABLE_UPSTASH_TCP: "true",
      });
      expect(disabled).toBeNull();
    });

    it("keeps BullMQ TCP disabled by default in hermetic unit tests unless ENABLE_LIVE_BULLMQ_TESTS=true", () => {
      expect(
        isBullMqEnabled({
          NODE_ENV: "test",
          VITEST: "true",
          UPSTASH_REDIS_REST_URL: "https://prime-bluejay-312074.upstash.io",
          UPSTASH_REDIS_REST_TOKEN: "tok",
        })
      ).toBe(false);

      expect(
        isBullMqEnabled({
          NODE_ENV: "test",
          VITEST: "true",
          ENABLE_LIVE_BULLMQ_TESTS: "true",
          UPSTASH_REDIS_REST_URL: "https://prime-bluejay-312074.upstash.io",
          UPSTASH_REDIS_REST_TOKEN: "tok",
        })
      ).toBe(true);
    });
  });

  describe("Stranded ProcessingJob & Google Drive Material Reconciliation (LIM-18 Part 1)", () => {
    it("re-queues stranded QUEUED and stale RUNNING jobs within retry budget and settles exhausted jobs", async () => {
      const oldDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      db.processingJob.findMany.mockResolvedValueOnce([
        {
          id: "job-stranded-queued",
          userId: "u1",
          materialId: "mat-1",
          type: "GOOGLE_SYNC",
          status: "QUEUED",
          attempts: 0,
          maxAttempts: 3,
          createdAt: oldDate,
          startedAt: null,
        },
        {
          id: "job-exhausted-running",
          userId: "u1",
          materialId: "mat-2",
          type: "TRANSCRIPTION",
          status: "RUNNING",
          attempts: 3,
          maxAttempts: 3,
          createdAt: oldDate,
          startedAt: oldDate,
        },
      ]);

      db.material.findUnique
        .mockResolvedValueOnce({ id: "mat-1", deletedAt: null }) // check for job-stranded-queued
        .mockResolvedValueOnce({ id: "mat-2", deletedAt: null }) // check for job-exhausted-running
        .mockResolvedValueOnce({
          id: "mat-2",
          extractedText: "existing text",
          storageKey: null,
          externalRef: { provider: "google_drive", syncStatus: "SYNCING" },
        }); // settleStrandedMaterial for mat-2

      db.processingJob.updateMany
        .mockResolvedValueOnce({ count: 1 }) // requeue job-stranded-queued
        .mockResolvedValueOnce({ count: 1 }); // fail job-exhausted-running

      db.material.updateMany.mockResolvedValueOnce({ count: 1 });
      db.material.findMany.mockResolvedValueOnce([]); // no extra orphan materials

      const dispatched: Array<{ jobId: string; type: string }> = [];
      const summary = await reconcileStrandedProcessingJobs({
        dispatchFn: (jobId, type) => {
          dispatched.push({ jobId, type });
        },
      });

      expect(summary).toEqual({
        scannedJobs: 2,
        requeuedJobs: 1,
        failedExhaustedJobs: 1,
        strandedMaterialsRecovered: 0,
        requeuedJobIds: ["job-stranded-queued"],
        failedJobIds: ["job-exhausted-running"],
      });
      expect(dispatched).toEqual([{ jobId: "job-stranded-queued", type: "GOOGLE_SYNC" }]);

      // Exhausted material with prior content was settled back to READY and syncStatus: ERROR
      expect(db.material.updateMany).toHaveBeenCalledWith({
        where: { id: "mat-2", status: "PROCESSING" },
        data: {
          status: "READY",
          externalRef: { provider: "google_drive", syncStatus: "ERROR" },
        },
      });
    });

    it("detects Google Drive Materials stuck in PROCESSING with no active job and dispatches a recovery GOOGLE_SYNC job", async () => {
      const oldDate = new Date(Date.now() - 5 * 60 * 1000);
      db.processingJob.findMany.mockResolvedValueOnce([]);
      db.material.findMany.mockResolvedValueOnce([
        {
          id: "mat-orphan-drive",
          ownerId: "u1",
          status: "PROCESSING",
          createdAt: oldDate,
          externalRef: {
            provider: "google_drive",
            fileId: "drive-file-99",
            syncStatus: "SYNCING",
          },
        },
      ]);
      db.processingJob.findFirst.mockResolvedValueOnce(null);
      db.processingJob.count.mockResolvedValueOnce(0);
      tx.processingJob.create.mockResolvedValueOnce({
        id: "job-recovered-sync",
        userId: "u1",
        materialId: "mat-orphan-drive",
        type: "GOOGLE_SYNC",
        status: "QUEUED",
      });

      const dispatched: string[] = [];
      const summary = await reconcileStrandedProcessingJobs({
        dispatchFn: (jobId) => {
          dispatched.push(jobId);
        },
      });

      expect(summary.strandedMaterialsRecovered).toBe(1);
      expect(dispatched).toEqual(["job-recovered-sync"]);
    });
  });

  describe("Crash-Safe Google Docs Initial Export across Process Restart (LIM-18 Part 2)", () => {
    it("persists an EXPORTING checkpoint in PostgreSQL immediately after createGoogleDocument so a process crash/restart recovers the same documentId without creating a duplicate Google Doc", async () => {
      let dbPersistedExternalRef: unknown = null;
      const blocks = [
        {
          id: "b-1",
          kind: "OVERVIEW" as const,
          heading: "Overview",
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Crash recovery test" }] }],
          },
          order: 0,
        },
      ];

      db.note.findUnique.mockImplementation(async () => ({
        id: "note-crash-test",
        title: "Process Crash Export Note",
        deletedAt: null,
        externalRef: dbPersistedExternalRef,
        blocks,
      }));

      db.note.update.mockImplementation(async ({ data }: { data: { externalRef?: unknown } }) => {
        dbPersistedExternalRef = data.externalRef;
        return { id: "note-crash-test", externalRef: dbPersistedExternalRef };
      });

      docsServiceMocks.createGoogleDocument.mockResolvedValueOnce({
        documentId: "gdoc-crash-1",
        title: "Process Crash Export Note",
        revisionId: "rev-1",
        body: { content: [{ startIndex: 1, endIndex: 2 }] },
      });

      // Simulate process crash during batchUpdateGoogleDocument on Attempt 1
      docsServiceMocks.batchUpdateGoogleDocument.mockRejectedValueOnce(
        new Error("Simulated process crash during batchUpdate")
      );

      await expect(
        exportOrSyncNoteWithGoogleDocs("note-crash-test", "user-1")
      ).rejects.toThrow("Simulated process crash during batchUpdate");

      // Verify PostgreSQL already received the durable EXPORTING checkpoint with documentId!
      expect(dbPersistedExternalRef).toMatchObject({
        provider: "google_docs",
        documentId: "gdoc-crash-1",
        syncStatus: "EXPORTING",
      });

      // Simulate a FULL Node process restart by wiping all in-memory Maps
      clearInMemoryNoteSyncRecoveryForTests();

      // Attempt 2 in a fresh process: reads `dbPersistedExternalRef` from PostgreSQL
      docsServiceMocks.getGoogleDocument.mockResolvedValue({
        documentId: "gdoc-crash-1",
        title: "Process Crash Export Note",
        revisionId: "rev-2",
        body: { content: [{ startIndex: 1, endIndex: 2 }] },
      });
      docsServiceMocks.batchUpdateGoogleDocument.mockResolvedValueOnce({
        documentId: "gdoc-crash-1",
      });
      tx.note.findUnique.mockImplementation(async () => ({
        id: "note-crash-test",
        externalRef: dbPersistedExternalRef,
      }));
      tx.note.update.mockImplementation(async ({ data }: { data: { externalRef?: unknown } }) => {
        dbPersistedExternalRef = data.externalRef;
        return { id: "note-crash-test", externalRef: dbPersistedExternalRef };
      });

      const recovered = await exportOrSyncNoteWithGoogleDocs("note-crash-test", "user-1");

      expect(recovered.status).toBe("exported");
      expect(recovered.externalRef.documentId).toBe("gdoc-crash-1");
      expect(recovered.externalRef.syncStatus).toBe("SYNCED");
      // Crucial assertion: createGoogleDocument was called ONLY ONCE across both attempts!
      expect(docsServiceMocks.createGoogleDocument).toHaveBeenCalledTimes(1);
    });
  });

  describe("Scheduled Watch-Channel Renewal & Job Pruning (LIM-18 Part 3)", () => {
    it("invokes renewExpiringWatchChannels from the scheduled renewal task and prunes old terminal jobs", async () => {
      driveSyncMocks.renewExpiringWatchChannels.mockResolvedValueOnce({
        checked: 3,
        renewed: 3,
        failed: 0,
      });

      const renewal = await runScheduledWatchChannelRenewal();
      expect(renewal).toEqual({ checked: 3, renewed: 3, failed: 0 });
      expect(driveSyncMocks.renewExpiringWatchChannels).toHaveBeenCalledTimes(1);

      db.processingJob.deleteMany.mockResolvedValueOnce({ count: 14 });
      const pruned = await pruneCompletedProcessingJobs(30);
      expect(pruned).toEqual({ deletedCount: 14 });
    });

    it("dispatches jobs in-process when BullMQ is disabled in unit test mode", async () => {
      const ran: string[] = [];
      const res = await dispatchProcessingJob("job-unit-1", "DOCUMENT_EXTRACTION", {
        awaitInProcess: true,
        inProcessRunner: async (id) => {
          ran.push(id);
        },
      });
      expect(res.mode).toBe("in_process");
      expect(ran).toEqual(["job-unit-1"]);
    });
  });
});

