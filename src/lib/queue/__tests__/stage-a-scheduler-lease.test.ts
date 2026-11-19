import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type IORedis from "ioredis";

const db = vi.hoisted(() => ({
  processingJob: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  material: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));

vi.mock("@/lib/google-drive-sync", () => ({
  renewExpiringWatchChannels: vi.fn().mockResolvedValue({ checked: 0, renewed: 0, failed: 0 }),
}));

import { reconcileStrandedProcessingJobs } from "@/lib/queue/reconciliation";
import { withSchedulerLease } from "@/lib/queue/worker";

interface LeaseRecord {
  value: string;
  expiresAt: number;
}

/**
 * In-memory stateful Redis simulator supporting atomic `SET key val PX ms NX`
 * plus the exact compare-and-delete / compare-and-pexpire Lua scripts used by
 * `withSchedulerLease`.
 */
function createFakeRedisStore() {
  const store = new Map<string, LeaseRecord>();
  const evalCalls: Array<{ script: string; key: string; token: string; ttl?: string }> = [];

  const purgeExpired = (key: string) => {
    const entry = store.get(key);
    if (entry && Date.now() >= entry.expiresAt) {
      store.delete(key);
    }
  };

  const makeClient = (status: "ready" | "connecting" = "ready"): IORedis => {
    const client = {
      status,
      async set(key: string, value: string, _px: string, ms: number, _nx: string) {
        purgeExpired(key);
        if (store.has(key)) return null;
        store.set(key, { value, expiresAt: Date.now() + ms });
        return "OK";
      },
      async eval(script: string, _numKeys: number, key: string, token: string, ttl?: string) {
        evalCalls.push({ script, key, token, ttl });
        purgeExpired(key);
        const current = store.get(key);
        if (!current || current.value !== token) return 0;

        if (script.includes("pexpire")) {
          const ttlMs = Number(ttl);
          current.expiresAt = Date.now() + (Number.isFinite(ttlMs) ? ttlMs : 0);
          return 1;
        }
        if (script.includes("del")) {
          store.delete(key);
          return 1;
        }
        return 0;
      },
    };
    return client as unknown as IORedis;
  };

  return { store, evalCalls, makeClient };
}

describe("Stage A — Multi-Replica Scheduler Leases & Reconciler CAS Hardening", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    db.material.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
  });

  describe("withSchedulerLease multi-replica coordination", () => {
    it("guarantees mutual exclusion between two worker replicas sharing Redis and releases cleanly on completion", async () => {
      const redis = createFakeRedisStore();
      const conn1 = redis.makeClient("ready");
      const conn2 = redis.makeClient("ready");

      let releaseReplica1: (() => void) | null = null;
      const replica1Entered = new Promise<void>((resolve) => {
        releaseReplica1 = resolve;
      });
      let signalReplica1Running!: () => void;
      const replica1Running = new Promise<void>((resolve) => {
        signalReplica1Running = resolve;
      });

      const executionLog: string[] = [];

      const p1 = withSchedulerLease(
        "watch-renewal",
        30_000,
        async () => {
          executionLog.push("replica-1:start");
          signalReplica1Running();
          await replica1Entered;
          executionLog.push("replica-1:end");
        },
        { connection: conn1, ownerId: "worker-1", failPolicy: "closed_when_bullmq" }
      );

      await replica1Running;

      // While replica-1 holds the lease, replica-2 must NOT acquire or run fn
      const res2During = await withSchedulerLease(
        "watch-renewal",
        30_000,
        async () => {
          executionLog.push("replica-2:should-not-run");
        },
        { connection: conn2, ownerId: "worker-2", failPolicy: "closed_when_bullmq" }
      );
      expect(res2During).toEqual({ executed: false, reason: "lease_held_by_other" });

      releaseReplica1!();
      const res1 = await p1;
      expect(res1).toEqual({ executed: true, reason: "lease_acquired" });
      expect(redis.store.size).toBe(0);

      // Once replica-1 releases, replica-2 can acquire the next cycle
      const res2After = await withSchedulerLease(
        "watch-renewal",
        30_000,
        async () => {
          executionLog.push("replica-2:acquired-after-release");
        },
        { connection: conn2, ownerId: "worker-2", failPolicy: "closed_when_bullmq" }
      );
      expect(res2After).toEqual({ executed: true, reason: "lease_acquired" });
      expect(executionLog).toEqual([
        "replica-1:start",
        "replica-1:end",
        "replica-2:acquired-after-release",
      ]);
    });

    it("does not delete another replica's key if lease token ownership changed (wrong-token RELEASE_LEASE_LUA)", async () => {
      const redis = createFakeRedisStore();
      const conn1 = redis.makeClient("ready");

      await withSchedulerLease(
        "reconcile",
        10_000,
        async () => {
          // Simulate Redis key being overwritten by a newer lock holder before finally runs
          const [lockKey] = Array.from(redis.store.keys());
          expect(lockKey).toBeDefined();
          redis.store.set(lockKey!, {
            value: "worker-2:newer-token",
            expiresAt: Date.now() + 60_000,
          });
        },
        { connection: conn1, ownerId: "worker-1" }
      );

      // Key owned by worker-2 MUST still exist after worker-1 exits finally{}
      const remaining = Array.from(redis.store.values());
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.value).toBe("worker-2:newer-token");
    });

    it("periodically extends the lease TTL via EXTEND_LEASE_LUA while a long task runs", async () => {
      vi.useFakeTimers();
      const redis = createFakeRedisStore();
      const conn = redis.makeClient("ready");

      let finishTask!: () => void;
      const promise = withSchedulerLease(
        "watch-renewal",
        9_000,
        () =>
          new Promise<void>((resolve) => {
            finishTask = resolve;
          }),
        { connection: conn, ownerId: "worker-1", renewIntervalMs: 1_000 }
      );

      await vi.advanceTimersByTimeAsync(3_500);
      const extendCalls = redis.evalCalls.filter((c) => c.script.includes("pexpire"));
      expect(extendCalls.length).toBeGreaterThanOrEqual(3);

      finishTask();
      const res = await promise;
      expect(res).toEqual({ executed: true, reason: "lease_acquired" });
      expect(redis.store.size).toBe(0);
    });

    it("respects closed_when_bullmq fail policy when Redis is unavailable and BullMQ is enabled", async () => {
      delete process.env.VITEST;
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.REDIS_URL = "redis://127.0.0.1:6379";

      const redis = createFakeRedisStore();
      const notReadyConn = redis.makeClient("connecting");
      let closedRan = false;
      let openRan = false;

      const closedRes = await withSchedulerLease(
        "watch-renewal",
        30_000,
        async () => {
          closedRan = true;
        },
        { connection: notReadyConn, failPolicy: "closed_when_bullmq" }
      );
      expect(closedRes).toEqual({
        executed: false,
        reason: "skipped_redis_unavailable",
      });
      expect(closedRan).toBe(false);

      const openRes = await withSchedulerLease(
        "reconcile",
        30_000,
        async () => {
          openRan = true;
        },
        { connection: notReadyConn, failPolicy: "open" }
      );
      expect(openRes).toEqual({
        executed: true,
        reason: "ran_without_redis",
      });
      expect(openRan).toBe(true);

      // Even if Redis SET throws when ready state flips mid-call, closed_when_bullmq skips safely
      const throwingConn = {
        status: "ready",
        set: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      } as unknown as IORedis;
      const errRes = await withSchedulerLease(
        "retention-cleanup",
        30_000,
        async () => {
          closedRan = true;
        },
        { connection: throwingConn, failPolicy: "closed_when_bullmq" }
      );
      expect(errRes).toEqual({
        executed: false,
        reason: "skipped_redis_unavailable",
      });
      expect(closedRan).toBe(false);

      // When BullMQ is disabled (no REDIS_URL), closed_when_bullmq falls back locally
      delete process.env.REDIS_URL;
      delete process.env.BULLMQ_REDIS_URL;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      let localRan = false;
      const disabledRes = await withSchedulerLease(
        "watch-renewal",
        30_000,
        async () => {
          localRan = true;
        },
        { connection: null, failPolicy: "closed_when_bullmq" }
      );
      expect(disabledRes).toEqual({ executed: true, reason: "ran_without_redis" });
      expect(localRan).toBe(true);
    });
  });

  describe("reconcileStrandedProcessingJobs CAS & retry grace hardening", () => {
    it("prevents double-increment and duplicate re-dispatch when two reconcilers race (CAS count=0 on loser)", async () => {
      const oldDate = new Date(Date.now() - 120_000);
      const jobRow = {
        id: "job-race-1",
        userId: "user-1",
        materialId: "mat-1",
        type: "DOCUMENT_EXTRACTION",
        status: "QUEUED",
        attempts: 0,
        maxAttempts: 3,
        createdAt: oldDate,
        updatedAt: oldDate,
        startedAt: null,
      };

      db.processingJob.findMany.mockResolvedValue([jobRow]);
      db.material.findUnique.mockResolvedValue({ id: "mat-1", deletedAt: null });

      // Simulate shared CAS row state: first updateMany wins (count: 1), second loses (count: 0)
      let currentAttempts = 0;
      db.processingJob.updateMany.mockImplementation(
        async ({ where, data }: { where: { attempts?: number }; data: { attempts?: number } }) => {
          if (where.attempts === currentAttempts) {
            if (typeof data.attempts === "number") {
              currentAttempts = data.attempts;
            }
            return { count: 1 };
          }
          return { count: 0 };
        }
      );

      const dispatches: string[] = [];
      const [s1, s2] = await Promise.all([
        reconcileStrandedProcessingJobs({
          dispatchFn: (id) => {
            dispatches.push(id);
          },
        }),
        reconcileStrandedProcessingJobs({
          dispatchFn: (id) => {
            dispatches.push(id);
          },
        }),
      ]);

      expect(s1.requeuedJobs + s2.requeuedJobs).toBe(1);
      expect(currentAttempts).toBe(1);
      expect(dispatches).toEqual(["job-race-1"]);
      expect(db.processingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-race-1", status: "QUEUED", attempts: 0 },
        })
      );
    });

    it("uses updatedAt grace window for previously recovered QUEUED jobs (attempts > 0)", async () => {
      const createdLongAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentlyRecoveredAt = new Date(Date.now() - 5_000);
      const staleRecoveredAt = new Date(Date.now() - 60_000);

      db.processingJob.findMany.mockResolvedValueOnce([
        {
          id: "job-fresh-grace",
          userId: "u1",
          materialId: "m1",
          type: "EMBEDDING",
          status: "QUEUED",
          attempts: 1,
          maxAttempts: 3,
          createdAt: createdLongAgo,
          updatedAt: recentlyRecoveredAt,
          startedAt: null,
        },
        {
          id: "job-expired-grace",
          userId: "u1",
          materialId: "m2",
          type: "EMBEDDING",
          status: "QUEUED",
          attempts: 1,
          maxAttempts: 3,
          createdAt: createdLongAgo,
          updatedAt: staleRecoveredAt,
          startedAt: null,
        },
      ]);

      db.material.findUnique.mockResolvedValue({ id: "m2", deletedAt: null });
      db.processingJob.updateMany.mockResolvedValueOnce({ count: 1 });

      const dispatches: string[] = [];
      const summary = await reconcileStrandedProcessingJobs({
        queuedStrandedAfterMs: 30_000,
        dispatchFn: (id) => {
          dispatches.push(id);
        },
      });

      expect(summary.requeuedJobIds).toEqual(["job-expired-grace"]);
      expect(dispatches).toEqual(["job-expired-grace"]);
      expect(db.processingJob.updateMany).toHaveBeenCalledTimes(1);
      expect(db.processingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-expired-grace", status: "QUEUED", attempts: 1 },
          data: expect.objectContaining({ attempts: 2 }),
        })
      );
    });
  });
});
