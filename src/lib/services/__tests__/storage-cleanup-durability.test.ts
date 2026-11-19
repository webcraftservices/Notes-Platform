import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeOrphanRow {
  id: string;
  storageKey: string;
  route: string;
  op: string;
  materialId: string | null;
  userId: string | null;
  ownerId: string | null;
  reason: string | null;
  error: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date;
  lastAttemptedAt: Date | null;
  claimedAt?: Date | null;
  claimExpiresAt?: Date | null;
  claimedBy?: string | null;
  claimToken?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeMaterialRow {
  id: string;
  ownerId: string;
  storageKey: string | null;
  deletedAt: Date | null;
  status: string;
  type?: string;
  mimeType?: string | null;
  extractedText?: string | null;
  sizeBytes?: number | null;
  externalRef?: unknown;
}

const pgStore = vi.hoisted(() => ({
  orphans: new Map<string, FakeOrphanRow>(),
  materials: [] as FakeMaterialRow[],
  idSeq: 0,
}));

const apiResp = vi.hoisted(() => ({
  logServerError: vi.fn(),
}));
vi.mock("@/lib/api-response", () => apiResp);

const datadog = vi.hoisted(() => ({
  sendDatadogMetric: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/observability/datadog", () => datadog);

const azure = vi.hoisted(() => ({
  sendAzureMonitorMetric: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/observability/azure-monitor", () => azure);

const storageMocks = vi.hoisted(() => ({
  getStorageService: vi.fn(),
}));
vi.mock("@/lib/services/storage", () => storageMocks);

const dbMocks = vi.hoisted(() => {
  const orphanStorageCleanup = {
    findUnique: vi.fn(async ({ where }: { where: { storageKey: string } }) => {
      return pgStore.orphans.get(where.storageKey) ?? null;
    }),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { storageKey: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = pgStore.orphans.get(where.storageKey);
        const now = new Date();
        if (existing) {
          Object.assign(existing, {
            route: (update.route as string) ?? existing.route,
            op: (update.op as string) ?? existing.op,
            materialId:
              update.materialId !== undefined ? (update.materialId as string | null) : existing.materialId,
            userId: update.userId !== undefined ? (update.userId as string | null) : existing.userId,
            ownerId: update.ownerId !== undefined ? (update.ownerId as string | null) : existing.ownerId,
            reason: update.reason !== undefined ? (update.reason as string | null) : existing.reason,
            error: (update.error as string) ?? existing.error,
            status: (update.status as string) ?? existing.status,
            attempts: (update.attempts as number) ?? existing.attempts,
            nextRetryAt: (update.nextRetryAt as Date) ?? existing.nextRetryAt,
            lastAttemptedAt:
              update.lastAttemptedAt !== undefined
                ? (update.lastAttemptedAt as Date | null)
                : existing.lastAttemptedAt,
            ...(update.claimedAt !== undefined ? { claimedAt: update.claimedAt as Date | null } : {}),
            ...(update.claimExpiresAt !== undefined ? { claimExpiresAt: update.claimExpiresAt as Date | null } : {}),
            ...(update.claimedBy !== undefined ? { claimedBy: update.claimedBy as string | null } : {}),
            ...(update.claimToken !== undefined ? { claimToken: update.claimToken as string | null } : {}),
            updatedAt: now,
          });
          return existing;
        }
        pgStore.idSeq += 1;
        const created: FakeOrphanRow = {
          id: `orphan-${pgStore.idSeq}`,
          storageKey: create.storageKey as string,
          route: create.route as string,
          op: create.op as string,
          materialId: (create.materialId as string | null) ?? null,
          userId: (create.userId as string | null) ?? null,
          ownerId: (create.ownerId as string | null) ?? null,
          reason: (create.reason as string | null) ?? null,
          error: create.error as string,
          status: (create.status as string) ?? "PENDING",
          attempts: (create.attempts as number) ?? 1,
          maxAttempts: (create.maxAttempts as number) ?? 10,
          nextRetryAt: (create.nextRetryAt as Date) ?? now,
          lastAttemptedAt: (create.lastAttemptedAt as Date | null) ?? now,
          claimedAt: (create.claimedAt as Date | null) ?? null,
          claimExpiresAt: (create.claimExpiresAt as Date | null) ?? null,
          claimedBy: (create.claimedBy as string | null) ?? null,
          claimToken: (create.claimToken as string | null) ?? null,
          createdAt: now,
          updatedAt: now,
        };
        pgStore.orphans.set(created.storageKey, created);
        return created;
      }
    ),
    findMany: vi.fn(
      async ({
        where,
        take,
      }: {
        where?: {
          status?: string;
          nextRetryAt?: { lte?: Date };
          OR?: Array<{ claimExpiresAt?: null | { lte?: Date } }>;
        };
        take?: number;
      } = {}) => {
        let rows = [...pgStore.orphans.values()];
        if (where?.status) {
          rows = rows.filter((r) => r.status === where.status);
        }
        if (where?.nextRetryAt?.lte) {
          const cutoff = where.nextRetryAt.lte.getTime();
          rows = rows.filter((r) => r.nextRetryAt.getTime() <= cutoff);
        }
        if (where?.OR) {
          rows = rows.filter((r) => {
            return where.OR!.some((cond) => {
              if (cond.claimExpiresAt === null) {
                return !r.claimExpiresAt;
              }
              if (cond.claimExpiresAt?.lte) {
                const limit = cond.claimExpiresAt.lte.getTime();
                return r.claimExpiresAt && r.claimExpiresAt.getTime() <= limit;
              }
              return false;
            });
          });
        }
        rows.sort((a, b) => a.nextRetryAt.getTime() - b.nextRetryAt.getTime());
        return typeof take === "number" ? rows.slice(0, take) : rows;
      }
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where?: {
          storageKey?: string;
          status?: string;
          claimedBy?: string;
          claimToken?: string;
          claimExpiresAt?: { gt?: Date };
          OR?: Array<{ claimExpiresAt?: null | { lte?: Date } }>;
        };
        data: Record<string, unknown>;
      }) => {
        let matched = [...pgStore.orphans.values()];
        if (where?.storageKey) {
          matched = matched.filter((r) => r.storageKey === where.storageKey);
        }
        if (where?.status) {
          matched = matched.filter((r) => r.status === where.status);
        }
        if (where?.claimedBy) {
          matched = matched.filter((r) => r.claimedBy === where.claimedBy);
        }
        if (where?.claimToken) {
          matched = matched.filter((r) => r.claimToken === where.claimToken);
        }
        if (where?.claimExpiresAt?.gt) {
          const limit = where.claimExpiresAt.gt.getTime();
          matched = matched.filter((r) => r.claimExpiresAt && r.claimExpiresAt.getTime() > limit);
        }
        if (where?.OR) {
          matched = matched.filter((r) => {
            return where.OR!.some((cond) => {
              if (cond.claimExpiresAt === null) {
                return !r.claimExpiresAt;
              }
              if (cond.claimExpiresAt?.lte) {
                const limit = cond.claimExpiresAt.lte.getTime();
                return r.claimExpiresAt && r.claimExpiresAt.getTime() <= limit;
              }
              return false;
            });
          });
        }
        const now = new Date();
        for (const row of matched) {
          Object.assign(row, {
            ...(data.claimedAt !== undefined ? { claimedAt: data.claimedAt as Date | null } : {}),
            ...(data.claimExpiresAt !== undefined ? { claimExpiresAt: data.claimExpiresAt as Date | null } : {}),
            ...(data.claimedBy !== undefined ? { claimedBy: data.claimedBy as string | null } : {}),
            ...(data.claimToken !== undefined ? { claimToken: data.claimToken as string | null } : {}),
            ...(data.attempts !== undefined ? { attempts: data.attempts as number } : {}),
            ...(data.maxAttempts !== undefined ? { maxAttempts: data.maxAttempts as number } : {}),
            ...(data.status !== undefined ? { status: data.status as string } : {}),
            ...(data.nextRetryAt !== undefined ? { nextRetryAt: data.nextRetryAt as Date } : {}),
            ...(data.lastAttemptedAt !== undefined ? { lastAttemptedAt: data.lastAttemptedAt as Date | null } : {}),
            ...(data.error !== undefined ? { error: data.error as string } : {}),
            updatedAt: now,
          });
        }
        return { count: matched.length };
      }
    ),
    deleteMany: vi.fn(
      async ({
        where,
      }: {
        where: {
          storageKey?: string;
          claimToken?: string;
          OR?: Array<{ claimToken?: null; claimExpiresAt?: null | { lte?: Date } }>;
        };
      }) => {
        if (where.storageKey) {
          const row = pgStore.orphans.get(where.storageKey);
          if (row) {
            if (where.claimToken && row.claimToken !== where.claimToken) {
              return { count: 0 };
            }
            if (where.OR) {
              const matched = (where.OR as Array<Record<string, unknown>>).some((cond) => {
                if (cond.claimToken === null && !row.claimToken) return true;
                if (Array.isArray(cond.AND)) {
                  const hasNotNull = cond.AND.some((c: Record<string, any>) => c.claimExpiresAt?.not === null);
                  const lteCond = cond.AND.find((c: Record<string, any>) => c.claimExpiresAt?.lte);
                  if (hasNotNull && lteCond && row.claimExpiresAt) {
                    return row.claimExpiresAt.getTime() <= lteCond.claimExpiresAt.lte.getTime();
                  }
                }
                return false;
              });
              if (!matched) return { count: 0 };
            }
            pgStore.orphans.delete(where.storageKey);
            return { count: 1 };
          }
        }
        return { count: 0 };
      }
    ),
    count: vi.fn(async ({ where }: { where?: { status?: string } } = {}) => {
      let rows = [...pgStore.orphans.values()];
      if (where?.status) {
        rows = rows.filter((r) => r.status === where.status);
      }
      return rows.length;
    }),
  };

  const material = {
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: { storageKey?: string; deletedAt?: null; status?: { in?: string[] } };
      }) => {
        const match = pgStore.materials.find((m) => {
          if (where.storageKey && m.storageKey !== where.storageKey) return false;
          if (where.deletedAt === null && m.deletedAt !== null) return false;
          if (where.status?.in && !where.status.in.includes(m.status)) return false;
          return true;
        });
        return match ? { id: match.id } : null;
      }
    ),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };

  const processingJob = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };

  const db = {
    orphanStorageCleanup,
    material,
    processingJob,
    subscription: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
  };
  return db;
});

vi.mock("@/lib/db", () => ({ db: dbMocks }));
vi.mock("@/lib/google-drive-sync", () => ({
  renewExpiringWatchChannels: vi.fn().mockResolvedValue({ checked: 0, renewed: 0, failed: 0 }),
}));
vi.mock("@/lib/google-connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google-connection")>()),
  getValidGoogleAccessToken: vi.fn().mockResolvedValue("ya29.test"),
}));

const googleDriveMocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  getFileMetadata: vi.fn(),
}));
vi.mock("@/lib/services/google-drive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/google-drive")>()),
  getGoogleDriveService: () => googleDriveMocks,
}));
vi.mock("@/lib/storage-usage", () => ({
  getStorageUsage: vi.fn().mockResolvedValue({
    plan: { maxFileSizeBytes: 50 * 1024 * 1024 },
    remainingBytes: 1024 * 1024 * 1024,
  }),
}));
vi.mock("@/lib/metadata-extraction", () => ({
  extractMetadata: vi.fn().mockResolvedValue({ pageCount: 2 }),
}));
vi.mock("@/lib/document-extraction", () => ({
  queueDocumentExtractionIfNeeded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/activity", () => ({
  createActivityLog: vi.fn().mockResolvedValue(undefined),
  ActivityAction: { MATERIAL_ADDED: "material.added" },
}));

import {
  DEFAULT_CLEANUP_CLAIM_TIMEOUT_MS,
  DEFAULT_MAX_ORPHAN_CLEANUP_ATTEMPTS,
  _resetPendingOrphanStorageCleanupsForTesting,
  claimOrphanStorageCleanup,
  clearOrphanCleanupRecord,
  computeOrphanCleanupNextRetryAt,
  deleteStorageObjectSafely,
  getDurableOrphanStorageCleanups,
  getPendingOrphanStorageCleanups,
  releaseOrphanStorageCleanupClaim,
  renewOrphanStorageCleanupClaim,
  resetExhaustedOrphanStorageCleanup,
  retryPendingOrphanStorageCleanups,
  scheduleDurableOrphanCleanup,
} from "@/lib/services/storage-cleanup";
import { reconcileStrandedProcessingJobs } from "@/lib/queue/reconciliation";
import { LocalStorageService } from "@/lib/services/storage-local";
import { runGoogleImportJob } from "@/lib/google-import";

describe("storage-cleanup durable PostgreSQL recovery & safety guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pgStore.orphans.clear();
    pgStore.materials = [];
    pgStore.idSeq = 0;
    _resetPendingOrphanStorageCleanupsForTesting();
    datadog.sendDatadogMetric.mockResolvedValue(undefined);
    azure.sendAzureMonitorMetric.mockResolvedValue(undefined);
  });

  it("persists failed orphan cleanup in PostgreSQL and recovers cleanly after full web/worker process restart", async () => {
    const deleteObject = vi
      .fn()
      .mockRejectedValueOnce(new Error("R2 outage before restart"))
      .mockResolvedValueOnce(undefined);
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    // Web process fails to delete orphaned object
    const first = await deleteStorageObjectSafely("materials/u-1/m-restart.pdf", {
      route: "/api/materials/[materialId]/complete",
      op: "cleanup-deleted-material-upload",
      materialId: "m-restart",
      userId: "u-1",
      reason: "group deleted",
    });

    expect(first.deleted).toBe(false);
    expect(first.reconciliationRecorded).toBe(true);
    expect(pgStore.orphans.size).toBe(1);
    // In-memory queue does NOT hold duplicated entry when DB persistence succeeded
    expect(getPendingOrphanStorageCleanups()).toHaveLength(0);

    // Simulate full Node web + worker process restart (wipe all in-memory Maps)
    _resetPendingOrphanStorageCleanupsForTesting();

    // Durable DB inspection still finds the pending orphan cleanup
    const persisted = await getDurableOrphanStorageCleanups();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      storageKey: "materials/u-1/m-restart.pdf",
      status: "PENDING",
      attempts: 1,
      persistedInDb: true,
    });

    // Separate worker reconciliation pass after restart automatically drains DB outbox
    await reconcileStrandedProcessingJobs();

    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteObject).toHaveBeenLastCalledWith("materials/u-1/m-restart.pdf");
    expect(pgStore.orphans.size).toBe(0);
    expect(await getDurableOrphanStorageCleanups()).toHaveLength(0);
  });

  it("enforces exponential backoff across repeat failures and transitions to EXHAUSTED at maxAttempts", async () => {
    const deleteObject = vi.fn().mockRejectedValue(new Error("permanent 403/storage failure"));
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    // Initial inline failure -> attempts=1, immediately eligible
    await deleteStorageObjectSafely("materials/u-1/m-backoff.pdf", {
      route: "/api/materials/[materialId]",
      op: "delete-material-object",
      materialId: "m-backoff",
      userId: "u-1",
    });

    let row = pgStore.orphans.get("materials/u-1/m-backoff.pdf")!;
    expect(row.attempts).toBe(1);
    expect(row.status).toBe("PENDING");

    // Verify retry #2 triggers immediately and pushes nextRetryAt into the future (~30s backoff)
    const t0 = new Date(Date.now() + 100);
    const pass2 = await retryPendingOrphanStorageCleanups({ now: t0 });
    expect(pass2).toEqual({ attempted: 1, cleaned: 0, remaining: 1 });
    row = pgStore.orphans.get("materials/u-1/m-backoff.pdf")!;
    expect(row.attempts).toBe(2);
    expect(row.nextRetryAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    // Calling retry immediately before nextRetryAt skips the entry instead of tight-looping
    const skippedTooSoon = await retryPendingOrphanStorageCleanups({ now: new Date() });
    expect(skippedTooSoon).toEqual({ attempted: 0, cleaned: 0, remaining: 1 });

    // Advance time repeatedly until attempts reaches DEFAULT_MAX_ORPHAN_CLEANUP_ATTEMPTS (10)
    let cursorMs = Date.now();
    for (let i = 3; i <= DEFAULT_MAX_ORPHAN_CLEANUP_ATTEMPTS; i += 1) {
      cursorMs = row.nextRetryAt.getTime() + 1_000;
      await retryPendingOrphanStorageCleanups({ now: new Date(cursorMs) });
      row = pgStore.orphans.get("materials/u-1/m-backoff.pdf")!;
      expect(row.attempts).toBe(i);
    }

    expect(row.status).toBe("EXHAUSTED");
    expect(datadog.sendDatadogMetric).toHaveBeenCalledWith(
      "storage.cleanup.exhausted",
      1,
      expect.any(Object)
    );
    expect(azure.sendAzureMonitorMetric).toHaveBeenCalledWith(
      "storage.cleanup.exhausted",
      1,
      expect.any(Object)
    );

    // Subsequent worker passes never re-attempt EXHAUSTED records even far in the future
    const callsBeforeExhaustedPass = deleteObject.mock.calls.length;
    const afterExhausted = await retryPendingOrphanStorageCleanups({
      now: new Date(cursorMs + 24 * 60 * 60 * 1000),
      forceDue: true,
    });
    expect(afterExhausted).toEqual({ attempted: 0, cleaned: 0, remaining: 0 });
    expect(deleteObject.mock.calls.length).toBe(callsBeforeExhaustedPass);

    // Sanity check monotonic backoff helper
    const b1 = computeOrphanCleanupNextRetryAt(1, 1000).getTime();
    const b2 = computeOrphanCleanupNextRetryAt(2, 1000).getTime();
    const b3 = computeOrphanCleanupNextRetryAt(3, 1000).getTime();
    expect(b2 - b1).toBe(30_000);
    expect(b3 - b2).toBe(30_000);
  });

  it("refuses unsafe keys, cross-user ownership mismatches, and active READY/PROCESSING material objects", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    // 1. Unsafe path traversal key
    const traversal = await deleteStorageObjectSafely("materials/../etc/passwd", {
      route: "/api/materials/[materialId]",
      op: "delete",
      userId: "u-1",
    });
    expect(traversal.deleted).toBe(false);
    expect(traversal.skippedReason).toBe("invalid_storage_key");
    expect(traversal.reconciliationRecorded).toBe(false);

    // 2. Ownership mismatch: user u-attacker tries to delete u-victim's storage object
    const mismatch = await deleteStorageObjectSafely("materials/u-victim/secret.pdf", {
      route: "/api/materials/[materialId]",
      op: "delete",
      userId: "u-attacker",
    });
    expect(mismatch.deleted).toBe(false);
    expect(mismatch.skippedReason).toBe("ownership_mismatch");
    expect(deleteObject).not.toHaveBeenCalled();

    // 3. Group admin delete succeeds when explicit ownerId matches materials/<ownerId>/...
    const adminGroupDelete = await deleteStorageObjectSafely("materials/u-member/group-file.pdf", {
      route: "/api/materials/[materialId]/DELETE",
      op: "delete-material-object",
      userId: "u-admin",
      ownerId: "u-member",
    });
    expect(adminGroupDelete.deleted).toBe(true);
    expect(deleteObject).toHaveBeenCalledWith("materials/u-member/group-file.pdf");

    // 4. Active READY Material protects its storageKey even if queued as a stale orphan row
    pgStore.materials.push({
      id: "mat-active-1",
      ownerId: "u-1",
      storageKey: "materials/u-1/mat-active-1.pdf",
      deletedAt: null,
      status: "READY",
    });
    pgStore.orphans.set("materials/u-1/mat-active-1.pdf", {
      id: "stale-row",
      storageKey: "materials/u-1/mat-active-1.pdf",
      route: "lib/google-import",
      op: "stale-cleanup",
      materialId: "mat-active-1",
      userId: "u-1",
      ownerId: "u-1",
      reason: "stale bug",
      error: "err",
      status: "PENDING",
      attempts: 1,
      maxAttempts: 10,
      nextRetryAt: new Date(Date.now() - 1000),
      lastAttemptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    deleteObject.mockClear();
    const retryRes = await retryPendingOrphanStorageCleanups();
    expect(retryRes).toEqual({ attempted: 1, cleaned: 0, remaining: 0 });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(pgStore.orphans.size).toBe(0);
  });

  it("never deletes previousStorageKey on replacement import rollback and durably records staged orphan cleanup if R2 rollback delete fails", async () => {
    const local = Object.create(LocalStorageService.prototype) as InstanceType<typeof LocalStorageService>;
    local.writeFile = vi.fn().mockResolvedValue(undefined);
    local.deleteObject = vi.fn().mockRejectedValue(new Error("transient disk/R2 lock"));
    storageMocks.getStorageService.mockReturnValue(local);

    const prevKey = "materials/user-1/mat-1-prev.pdf";
    const existingMat = {
      id: "mat-1",
      ownerId: "user-1",
      groupId: null,
      workspaceId: "ws-1",
      type: "PDF",
      mimeType: "application/pdf",
      title: "Replaced Doc",
      storageKey: prevKey,
      sizeBytes: 100,
      deletedAt: null,
      status: "READY",
      extractedText: "existing valid text",
      externalRef: { provider: "google_drive", fileId: "drive-1", modifiedTime: "2026-11-10T00:00:00Z" },
    };
    pgStore.materials.push(existingMat);

    dbMocks.subscription.findUnique.mockResolvedValue({ plan: "PRO", status: "ACTIVE" });
    dbMocks.processingJob.findUnique.mockResolvedValue({
      id: "job-imp-1",
      userId: "user-1",
      materialId: "mat-1",
      type: "GOOGLE_SYNC",
      status: "QUEUED",
    });
    // Claim succeeds (1st updateMany), completeJobWithin aborts inside tx (2nd updateMany -> count 0)
    dbMocks.processingJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    dbMocks.material.findUnique.mockResolvedValue(existingMat);
    googleDriveMocks.downloadFile.mockResolvedValue(Buffer.from("%PDF-1.4 new replacement bytes"));

    await runGoogleImportJob("job-imp-1");

    const stagedKey = vi.mocked(local.writeFile).mock.calls[0]![0];
    expect(stagedKey).not.toBe(prevKey);

    // Even when rollback deletion of stagedKey fails, ONLY stagedKey is attempted & persisted in Postgres
    expect(local.deleteObject).toHaveBeenCalledTimes(1);
    expect(local.deleteObject).toHaveBeenCalledWith(stagedKey);
    expect(local.deleteObject).not.toHaveBeenCalledWith(prevKey);

    // Persisted durable record is for stagedKey ONLY; prevKey remains intact and protected
    expect(pgStore.orphans.has(stagedKey)).toBe(true);
    expect(pgStore.orphans.has(prevKey)).toBe(false);

    // After storage recovers & worker restarts, retry deletes ONLY stagedKey and never touches prevKey
    _resetPendingOrphanStorageCleanupsForTesting();
    local.deleteObject = vi.fn().mockResolvedValue(undefined);
    const recovered = await retryPendingOrphanStorageCleanups({ forceDue: true });
    expect(recovered).toEqual({ attempted: 1, cleaned: 1, remaining: 0 });
    expect(local.deleteObject).toHaveBeenCalledWith(stagedKey);
    expect(local.deleteObject).not.toHaveBeenCalledWith(prevKey);
  });

  it("1. surfaces reconciliationRecorded: false and emits failure metrics when DB persistence fails in production", async () => {
    const envRecord = process.env as Record<string, string | undefined>;
    const originalEnv = envRecord.NODE_ENV;
    envRecord.NODE_ENV = "production";

    try {
      const deleteObject = vi.fn().mockRejectedValue(new Error("Storage unavailable"));
      storageMocks.getStorageService.mockReturnValue({ deleteObject });

      // Force DB upsert failure
      dbMocks.orphanStorageCleanup.upsert.mockRejectedValueOnce(new Error("Postgres connection pool exhausted"));

      const res = await deleteStorageObjectSafely("materials/u-prod/file.pdf", {
        route: "/api/materials/cleanup",
        op: "delete-material-object",
        userId: "u-prod",
      });

      expect(res.deleted).toBe(false);
      expect(res.reconciliationRecorded).toBe(false);
      expect(datadog.sendDatadogMetric).toHaveBeenCalledWith(
        "storage.cleanup.db_persistence_failures",
        1,
        expect.objectContaining({ type: "count" })
      );
      expect(azure.sendAzureMonitorMetric).toHaveBeenCalledWith(
        "storage.cleanup.db_persistence_failures",
        1,
        expect.objectContaining({ properties: expect.objectContaining({ op: "delete-material-object" }) })
      );
    } finally {
      envRecord.NODE_ENV = originalEnv;
    }
  });

  it("2. handles two workers claiming the same row atomically: worker 1 succeeds, worker 2 fails", async () => {
    // Schedule a pending cleanup record in DB
    await scheduleDurableOrphanCleanup({
      storageKey: "materials/u-worker/race.pdf",
      route: "/api/test",
      op: "race-test",
      userId: "u-worker",
      error: "initial failure",
    });

    const worker1Claim = await claimOrphanStorageCleanup("materials/u-worker/race.pdf", "worker-1", 60_000);
    const worker2Claim = await claimOrphanStorageCleanup("materials/u-worker/race.pdf", "worker-2", 60_000);

    expect(worker1Claim.claimed).toBe(true);
    expect(worker1Claim.claimToken).toBeTruthy();
    expect(worker2Claim.claimed).toBe(false);
    expect(worker2Claim.claimToken).toBeNull();

    const row = pgStore.orphans.get("materials/u-worker/race.pdf");
    expect(row?.claimedBy).toBe("worker-1");
    expect(row?.claimToken).toBe(worker1Claim.claimToken);
  });

  it("3. allows second worker to recover after first worker crashes and claimExpiresAt lapses", async () => {
    await scheduleDurableOrphanCleanup({
      storageKey: "materials/u-crash/crash.pdf",
      route: "/api/test",
      op: "crash-test",
      userId: "u-crash",
      error: "initial failure",
    });

    // Worker 1 claims with short 100ms TTL and crashes
    const claimed = await claimOrphanStorageCleanup("materials/u-crash/crash.pdf", "worker-dead", 100);
    expect(claimed.claimed).toBe(true);
    expect(claimed.claimToken).toBeTruthy();

    // Worker 2 attempts immediate claim while lease active -> rejected
    const worker2TooSoon = await claimOrphanStorageCleanup("materials/u-crash/crash.pdf", "worker-alive", 60_000);
    expect(worker2TooSoon.claimed).toBe(false);

    // Advance time past lease expiration
    const row = pgStore.orphans.get("materials/u-crash/crash.pdf")!;
    row.claimExpiresAt = new Date(Date.now() - 1000);

    // Worker 2 attempts claim after expiration -> succeeds
    const worker2Recovered = await claimOrphanStorageCleanup("materials/u-crash/crash.pdf", "worker-alive", 60_000);
    expect(worker2Recovered.claimed).toBe(true);
    expect(row.claimedBy).toBe("worker-alive");
    expect(row.claimToken).toBe(worker2Recovered.claimToken);
  });

  it("3b. stale-worker completion protection: Worker A cannot clear or overwrite Worker B's newer claim", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    await scheduleDurableOrphanCleanup({
      storageKey: "materials/u-stale/stale.pdf",
      route: "/api/test",
      op: "stale-worker-test",
      userId: "u-stale",
      error: "initial failure",
    });

    // 1. Worker A claims the row
    const claimA = await claimOrphanStorageCleanup("materials/u-stale/stale.pdf", "worker-A", 100);
    expect(claimA.claimed).toBe(true);
    const tokenA = claimA.claimToken!;

    // 2. Worker A pauses/stalls, lease expires
    const row = pgStore.orphans.get("materials/u-stale/stale.pdf")!;
    row.claimExpiresAt = new Date(Date.now() - 1000);

    // 3. Worker B claims the row (generates new fencing token)
    const claimB = await claimOrphanStorageCleanup("materials/u-stale/stale.pdf", "worker-B", 60_000);
    expect(claimB.claimed).toBe(true);
    const tokenB = claimB.claimToken!;
    expect(tokenB).not.toBe(tokenA);
    expect(row.claimedBy).toBe("worker-B");
    expect(row.claimToken).toBe(tokenB);

    // 4. Stale Worker A resumes and attempts to complete deletion using its old tokenA
    const staleCompletion = await deleteStorageObjectSafely("materials/u-stale/stale.pdf", {
      route: "/api/test",
      op: "stale-complete",
      userId: "u-stale",
      claimToken: tokenA,
      workerId: "worker-A",
      storageService: { deleteObject },
    });
    expect(staleCompletion.deleted).toBe(true);

    // CRITICAL INVARIANT: Worker B's row was NOT cleared from the database!
    expect(pgStore.orphans.has("materials/u-stale/stale.pdf")).toBe(true);
    const postA = pgStore.orphans.get("materials/u-stale/stale.pdf")!;
    expect(postA.claimedBy).toBe("worker-B");
    expect(postA.claimToken).toBe(tokenB);

    // 5. Worker B finishes and clears with its valid tokenB
    const validCompletion = await deleteStorageObjectSafely("materials/u-stale/stale.pdf", {
      route: "/api/test",
      op: "valid-complete",
      userId: "u-stale",
      claimToken: tokenB,
      workerId: "worker-B",
      storageService: { deleteObject },
    });
    expect(validCompletion.deleted).toBe(true);
    // Now the row is cleanly cleared
    expect(pgStore.orphans.has("materials/u-stale/stale.pdf")).toBe(false);
  });

  it("3c. stale-worker release protection: Worker A cannot release or corrupt Worker B's active claim", async () => {
    await scheduleDurableOrphanCleanup({
      storageKey: "materials/u-stale-release/file.pdf",
      route: "/api/test",
      op: "stale-release-test",
      userId: "u-stale-release",
      error: "initial failure",
    });

    // 1. Worker A claims the row
    const claimA = await claimOrphanStorageCleanup("materials/u-stale-release/file.pdf", "worker-A", 100);
    const tokenA = claimA.claimToken!;

    // 2. Lease expires
    const row = pgStore.orphans.get("materials/u-stale-release/file.pdf")!;
    row.claimExpiresAt = new Date(Date.now() - 1000);

    // 3. Worker B claims the row
    const claimB = await claimOrphanStorageCleanup("materials/u-stale-release/file.pdf", "worker-B", 60_000);
    const tokenB = claimB.claimToken!;

    // 4. Stale Worker A attempts release with incrementAttempts: true
    const releaseRes = await releaseOrphanStorageCleanupClaim(
      "materials/u-stale-release/file.pdf",
      "worker-A",
      { claimToken: tokenA, incrementAttempts: true, error: "stale failure" }
    );
    expect(releaseRes).toBe(false);

    // CRITICAL: Worker B's claim remains active, attempts NOT incremented by stale worker
    expect(row.claimedBy).toBe("worker-B");
    expect(row.claimToken).toBe(tokenB);
    expect(row.attempts).toBe(1); // not incremented to 2
  });

  it("3d. lease renewal mechanics: renewOrphanStorageCleanupClaim extends active claim, rejects expired/invalid tokens", async () => {
    await scheduleDurableOrphanCleanup({
      storageKey: "materials/u-renew/file.pdf",
      route: "/api/test",
      op: "renew-test",
      userId: "u-renew",
      error: "initial failure",
    });

    const claim = await claimOrphanStorageCleanup("materials/u-renew/file.pdf", "worker-1", 5_000);
    expect(claim.claimed).toBe(true);
    const token = claim.claimToken!;

    // Renew with valid token while lease active -> succeeds
    const renewed = await renewOrphanStorageCleanupClaim("materials/u-renew/file.pdf", "worker-1", token, 60_000);
    expect(renewed).toBe(true);

    const row = pgStore.orphans.get("materials/u-renew/file.pdf")!;
    expect(row.claimExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 30_000);

    // Renew with wrong token -> rejected
    const wrongTokenRenew = await renewOrphanStorageCleanupClaim(
      "materials/u-renew/file.pdf",
      "worker-1",
      "bogus-token",
      60_000
    );
    expect(wrongTokenRenew).toBe(false);

    // Renew with wrong worker -> rejected
    const wrongWorkerRenew = await renewOrphanStorageCleanupClaim(
      "materials/u-renew/file.pdf",
      "worker-imposter",
      token,
      60_000
    );
    expect(wrongWorkerRenew).toBe(false);

    // Expire lease
    row.claimExpiresAt = new Date(Date.now() - 1000);

    // Renew after lease expired -> rejected
    const expiredRenew = await renewOrphanStorageCleanupClaim("materials/u-renew/file.pdf", "worker-1", token, 60_000);
    expect(expiredRenew).toBe(false);
  });

  it("3e. strict fail-closed token validation: empty/whitespace claimToken or workerId is rejected by clear, renew, and release", async () => {
    const key = "materials/u-failclose/file.pdf";
    await scheduleDurableOrphanCleanup({
      storageKey: key,
      route: "/api/test",
      op: "failclose-test",
      userId: "u-failclose",
      error: "initial failure",
    });

    const claim = await claimOrphanStorageCleanup(key, "worker-real", 10_000);
    expect(claim.claimed).toBe(true);
    const token = claim.claimToken!;

    // Empty or whitespace claimToken fails closed on clear
    expect(await clearOrphanCleanupRecord(key, "")).toBe(false);
    expect(await clearOrphanCleanupRecord(key, "   ")).toBe(false);

    // Empty or whitespace identifiers fail closed on renew
    expect(await renewOrphanStorageCleanupClaim(key, "", token)).toBe(false);
    expect(await renewOrphanStorageCleanupClaim(key, "worker-real", "")).toBe(false);
    expect(await renewOrphanStorageCleanupClaim(key, "   ", "   ")).toBe(false);

    // Empty or whitespace identifiers fail closed on release
    expect(await releaseOrphanStorageCleanupClaim(key, "", { claimToken: token })).toBe(false);
    expect(await releaseOrphanStorageCleanupClaim(key, "worker-real", { claimToken: "" })).toBe(false);
    expect(await releaseOrphanStorageCleanupClaim(key, "worker-real", { claimToken: "   " })).toBe(false);

    // Ensure the record was NOT touched or corrupted by the invalid calls
    const row = pgStore.orphans.get(key)!;
    expect(row.claimedBy).toBe("worker-real");
    expect(row.claimToken).toBe(token);
    expect(row.attempts).toBe(1);
  });

  it("3f. unauthenticated inline caller cannot delete an actively claimed outbox row", async () => {
    const key = "materials/u-act-claim/file.pdf";
    await scheduleDurableOrphanCleanup({
      storageKey: key,
      route: "/api/test",
      op: "active-claim-test",
      userId: "u-act-claim",
      error: "initial failure",
    });

    const claim = await claimOrphanStorageCleanup(key, "worker-active", 60_000);
    expect(claim.claimed).toBe(true);

    // Inline caller calling clearOrphanCleanupRecord without a token
    const unauthClear = await clearOrphanCleanupRecord(key);
    expect(unauthClear).toBe(false);

    // Row is still safely preserved in outbox
    expect(pgStore.orphans.has(key)).toBe(true);
    const row = pgStore.orphans.get(key)!;
    expect(row.claimedBy).toBe("worker-active");

    // But calling with the correct claimToken successfully clears it
    const authClear = await clearOrphanCleanupRecord(key, claim.claimToken!);
    expect(authClear).toBe(true);
    expect(pgStore.orphans.has(key)).toBe(false);
  });

  it("3g. lease renewal heartbeat keeps lease active during prolonged cleanup", async () => {
    const key = "materials/u-heartbeat/long-delete.pdf";
    await scheduleDurableOrphanCleanup({
      storageKey: key,
      route: "/api/test",
      op: "heartbeat-test",
      userId: "u-heartbeat",
      error: "initial failure",
    });

    // Mock storage deleteObject that takes 1200ms
    // Set claimDurationMs = 1000ms so that without a heartbeat, the lease would expire!
    const deleteObject = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });

    const res = await retryPendingOrphanStorageCleanups({
      forceDue: true,
      workerId: "heartbeat-worker",
      claimDurationMs: 1000,
      storageService: { deleteObject },
    });

    expect(res.attempted).toBe(1);
    expect(res.cleaned).toBe(1);
    expect(deleteObject).toHaveBeenCalledWith(key);
    expect(pgStore.orphans.has(key)).toBe(false);
  });

  it("3h. malformed/indefinite claim protection: row with populated claimToken and claimExpiresAt: null CANNOT be cleared by an inline caller without a token", async () => {
    const key = "materials/u-indefinite/file.pdf";
    await scheduleDurableOrphanCleanup({
      storageKey: key,
      route: "/api/test",
      op: "indefinite-claim-test",
      userId: "u-indefinite",
      error: "initial failure",
    });

    const row = pgStore.orphans.get(key)!;
    // Simulate a malformed or indefinite claim where a claimToken is populated but claimExpiresAt is null
    row.claimToken = "indefinite-token-xyz";
    row.claimedBy = "worker-indefinite";
    row.claimExpiresAt = null;

    // Inline caller calling clearOrphanCleanupRecord without a token must FAIL closed
    const unauthClear = await clearOrphanCleanupRecord(key);
    expect(unauthClear).toBe(false);

    // Row is still preserved in outbox
    expect(pgStore.orphans.has(key)).toBe(true);
    expect(row.claimToken).toBe("indefinite-token-xyz");

    // Clear with proper claim token succeeds
    const authClear = await clearOrphanCleanupRecord(key, "indefinite-token-xyz");
    expect(authClear).toBe(true);
    expect(pgStore.orphans.has(key)).toBe(false);
  });

  it("3i. completion aborted when lease is lost before or after storage deletion", async () => {
    const key = "materials/u-leaseloss/file.pdf";
    const deleteObject = vi.fn().mockResolvedValue(undefined);

    // Case A: lease is reported lost before storage deletion
    const beforeRes = await deleteStorageObjectSafely(key, {
      route: "/api/test",
      op: "leaseloss-test",
      userId: "u-leaseloss",
      claimToken: "token-lost-early",
      workerId: "worker-lost",
      isLeaseActive: () => false,
      storageService: { deleteObject },
    });
    expect(beforeRes.deleted).toBe(false);
    expect(beforeRes.skippedReason).toBe("lease_lost");
    expect(deleteObject).not.toHaveBeenCalled();

    // Case B: lease is active at start but becomes inactive after storage deletion
    let active = true;
    const deleteObjectLater = vi.fn().mockImplementation(async () => {
      active = false; // lease lost during storage call
    });
    const afterRes = await deleteStorageObjectSafely(key, {
      route: "/api/test",
      op: "leaseloss-test",
      userId: "u-leaseloss",
      claimToken: "token-lost-late",
      workerId: "worker-lost",
      isLeaseActive: () => active,
      storageService: { deleteObject: deleteObjectLater },
    });
    expect(afterRes.deleted).toBe(true);
    expect(afterRes.outboxCleared).toBe(false);
    expect(afterRes.skippedReason).toBe("lease_lost");
  });

  it("4. automatically picks up expired claims during retryPendingOrphanStorageCleanups pass", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    await scheduleDurableOrphanCleanup({
      storageKey: "materials/u-expired/expired.pdf",
      route: "/api/test",
      op: "expired-test",
      userId: "u-expired",
      error: "initial failure",
    });

    // Simulate abandoned claim that expired 10 minutes ago
    const row = pgStore.orphans.get("materials/u-expired/expired.pdf")!;
    row.claimedAt = new Date(Date.now() - 15 * 60 * 1000);
    row.claimExpiresAt = new Date(Date.now() - 10 * 60 * 1000);
    row.claimedBy = "dead-worker";

    const res = await retryPendingOrphanStorageCleanups({ forceDue: true, workerId: "recovery-worker" });
    expect(res.cleaned).toBe(1);
    expect(deleteObject).toHaveBeenCalledWith("materials/u-expired/expired.pdf");
    expect(pgStore.orphans.size).toBe(0);
  });

  it("5. safely cleans up on next pass if storage delete succeeded but subsequent DB delete failed (idempotency)", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    await scheduleDurableOrphanCleanup({
      storageKey: "materials/u-idemp/idemp.pdf",
      route: "/api/test",
      op: "idemp-test",
      userId: "u-idemp",
      error: "initial failure",
    });

    // Pass 1: deleteMany throws after successful storage deletion
    dbMocks.orphanStorageCleanup.deleteMany.mockRejectedValueOnce(new Error("DB lock timeout"));

    const pass1 = await retryPendingOrphanStorageCleanups({ forceDue: true });
    // In pass 1, deleteObject was called, but row was not cleared from DB
    expect(deleteObject).toHaveBeenCalledWith("materials/u-idemp/idemp.pdf");

    // Pass 2: on subsequent pass, deleteObject succeeds again without error and DB deletion succeeds
    const pass2 = await retryPendingOrphanStorageCleanups({ forceDue: true });
    expect(pass2.cleaned).toBe(1);
    expect(pgStore.orphans.size).toBe(0);
  });

  it("6. repeatedly deleting an already-deleted key succeeds cleanly (idempotence)", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    const first = await deleteStorageObjectSafely("materials/u-repeat/file.pdf", {
      route: "/api/materials",
      op: "delete-test",
      userId: "u-repeat",
    });
    const second = await deleteStorageObjectSafely("materials/u-repeat/file.pdf", {
      route: "/api/materials",
      op: "delete-test",
      userId: "u-repeat",
    });

    expect(first.deleted).toBe(true);
    expect(second.deleted).toBe(true);
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it("7. active material reference protection: refuses deletion if material is READY or PROCESSING", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    pgStore.materials.push({
      id: "mat-protected-active",
      ownerId: "u-protect",
      storageKey: "materials/u-protect/active.pdf",
      deletedAt: null,
      status: "PROCESSING",
    });

    const res = await deleteStorageObjectSafely("materials/u-protect/active.pdf", {
      route: "/api/materials",
      op: "delete-test",
      userId: "u-protect",
    });

    expect(res.deleted).toBe(false);
    expect(res.skippedReason).toBe("active_material_protected");
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("8. transitions to EXHAUSTED after max attempts, and operational reset allows retry", async () => {
    const deleteObject = vi.fn().mockRejectedValue(new Error("Storage unavailable"));
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    await scheduleDurableOrphanCleanup({
      storageKey: "materials/u-exhaust/file.pdf",
      route: "/api/test",
      op: "exhaust-test",
      userId: "u-exhaust",
      error: "permanent error",
      maxAttempts: 3,
    });

    const row = pgStore.orphans.get("materials/u-exhaust/file.pdf")!;
    row.maxAttempts = 3;

    // Retry 1 (attempts becomes 2)
    await retryPendingOrphanStorageCleanups({ forceDue: true });
    expect(row.attempts).toBe(2);
    expect(row.status).toBe("PENDING");

    // Retry 2 (attempts becomes 3 >= maxAttempts -> EXHAUSTED)
    await retryPendingOrphanStorageCleanups({ forceDue: true });
    expect(row.attempts).toBe(3);
    expect(row.status).toBe("EXHAUSTED");

    // Operational reset: operator un-sticks the record after fixing storage credentials
    const resetSuccess = await resetExhaustedOrphanStorageCleanup("materials/u-exhaust/file.pdf");
    expect(resetSuccess).toBe(true);
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(0);
    expect(row.claimedBy).toBeNull();

    // Now storage is back online
    deleteObject.mockResolvedValueOnce(undefined);
    const retryAfterReset = await retryPendingOrphanStorageCleanups({ forceDue: true });
    expect(retryAfterReset.cleaned).toBe(1);
    expect(pgStore.orphans.size).toBe(0);
  });

  it("9. storage reference invariant: active material check permits deletion only after soft-delete", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    const key = "materials/u-inv/doc-unique-123.pdf";
    const material: FakeMaterialRow = {
      id: "mat-invariant",
      ownerId: "u-inv",
      storageKey: key,
      deletedAt: null,
      status: "READY",
    };
    pgStore.materials.push(material);

    // 1. While active (status: READY, deletedAt: null) -> refused!
    const activeAttempt = await deleteStorageObjectSafely(key, {
      route: "/api/materials",
      op: "invariant-test",
      userId: "u-inv",
    });
    expect(activeAttempt.deleted).toBe(false);
    expect(activeAttempt.skippedReason).toBe("active_material_protected");
    expect(deleteObject).not.toHaveBeenCalled();

    // 2. Soft-delete the material (deletedAt set)
    material.deletedAt = new Date();

    // 3. Now deletion succeeds!
    const deletedAttempt = await deleteStorageObjectSafely(key, {
      route: "/api/materials",
      op: "invariant-test",
      userId: "u-inv",
    });
    expect(deletedAttempt.deleted).toBe(true);
    expect(deleteObject).toHaveBeenCalledWith(key);
  });

  it("10. replacement rollback preserves pre-existing storage key and only cleans up orphan candidate", async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue({ deleteObject });

    const previousKey = "materials/u-rep/orig-file.pdf";
    const newReplacementKey = "materials/u-rep/new-file.pdf";

    // Pre-existing material pointing to previousKey
    const material: FakeMaterialRow = {
      id: "mat-replace",
      ownerId: "u-rep",
      storageKey: previousKey,
      deletedAt: null,
      status: "READY",
    };
    pgStore.materials.push(material);

    // Simulate replacement transaction failure:
    // Only newReplacementKey should be passed to deleteStorageObjectSafely
    const rollbackCleanup = await deleteStorageObjectSafely(newReplacementKey, {
      route: "/api/integrations/google/import",
      op: "rollback-new-file",
      userId: "u-rep",
    });
    expect(rollbackCleanup.deleted).toBe(true);
    expect(deleteObject).toHaveBeenCalledWith(newReplacementKey);
    expect(deleteObject).not.toHaveBeenCalledWith(previousKey);

    // Verify pre-existing material still retains previousKey and is READY
    expect(material.storageKey).toBe(previousKey);
    expect(material.status).toBe("READY");

    // Attempting to delete previousKey while material is active would be rejected
    const prevAttempt = await deleteStorageObjectSafely(previousKey, {
      route: "/api/integrations/google/import",
      op: "erroneous-prev-delete",
      userId: "u-rep",
    });
    expect(prevAttempt.deleted).toBe(false);
    expect(prevAttempt.skippedReason).toBe("active_material_protected");
  });
});
