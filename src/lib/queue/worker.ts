/**
 * Phase 15 & Stage A — BullMQ Worker Runtime, Scheduled Maintenance Jobs,
 * Distributed Multi-Replica Scheduler Leases, Graceful Shutdown, and Queue Health Telemetry.
 */

import crypto from "crypto";
import os from "os";
import { Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import {
  createBullMqRedisConnection,
  isBullMqEnabled,
  isDedicatedWorkerMode,
  resolveBullMqRedisConfig,
} from "@/lib/queue/connection";
import {
  closeProcessingQueue,
  dispatchProcessingJob,
  executeProcessingJobByType,
  getProcessingQueue,
  getProcessingQueueName,
  type QueuedProcessingJobPayload,
} from "@/lib/queue/dispatcher";
import { logRuntimeEvent } from "@/lib/queue/logger";
import { closeJobEventPubSub } from "@/lib/queue/events";
import { emitOperationalMetric } from "@/lib/observability/telemetry";
import {
  pruneCompletedProcessingJobs,
  reconcileStrandedProcessingJobs,
  runScheduledWatchChannelRenewal,
} from "@/lib/queue/reconciliation";

let activeWorker: Worker<QueuedProcessingJobPayload> | null = null;
let activeWorkerConnection: IORedis | null = null;
let workerStartedAt: Date | null = null;
let lastHeartbeatAt: Date | null = null;
let workerDraining = false;
let reconciliationTimer: ReturnType<typeof setInterval> | null = null;
let watchRenewalTimer: ReturnType<typeof setInterval> | null = null;
let retentionCleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Default interval for stranded-job reconciliation (5 minutes). */
export const DEFAULT_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;

/** Default interval for proactive Google Drive watch-channel renewal (6 hours). */
export const DEFAULT_WATCH_RENEWAL_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Default interval for old completed/failed job pruning (24 hours). */
export const DEFAULT_RETENTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface StartWorkerOptions {
  queueName?: string;
  concurrency?: number;
  enableScheduledMaintenance?: boolean;
  reconciliationIntervalMs?: number;
  watchRenewalIntervalMs?: number;
}

export function getWorkerInstanceId(): string {
  return process.env.WORKER_ID?.trim() || `${os.hostname()}-${process.pid}`;
}

export function isWorkerDraining(): boolean {
  return workerDraining;
}

export function isWorkerRedisReady(): boolean {
  if (!isBullMqEnabled()) return true;
  return Boolean(activeWorkerConnection && activeWorkerConnection.status === "ready");
}

export type SchedulerLeaseFailPolicy = "open" | "closed_when_bullmq";

export interface SchedulerLeaseOptions {
  /**
   * Controls behavior when Redis is unavailable/unreachable:
   *  - `"open"`: Execute locally anyway (appropriate only for DB CAS-guarded idempotent work such as `reconcile`).
   *  - `"closed_when_bullmq"`: Skip tick when `isBullMqEnabled()` is `true` so multi-replica clusters never run
   *    non-atomic external operations (like Google Drive `channels.watch`) uncoordinated; still executes when Redis is disabled.
   */
  failPolicy?: SchedulerLeaseFailPolicy;
  /** Optional explicit Redis client and replica identity (useful for tests & multi-replica simulation). */
  connection?: IORedis | null;
  ownerId?: string;
  renewIntervalMs?: number;
}

export interface SchedulerLeaseResult {
  executed: boolean;
  reason: "lease_acquired" | "ran_without_redis" | "lease_held_by_other" | "skipped_redis_unavailable";
}

const RELEASE_LEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const EXTEND_LEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

async function waitForRedisReady(conn: IORedis | null, timeoutMs: number = 3_000): Promise<void> {
  if (!conn || conn.status === "ready" || conn.status === "end") return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    timer.unref?.();

    const cleanup = () => {
      clearTimeout(timer);
      conn.off("ready", onDone);
      conn.off("end", onDone);
    };
    const onDone = () => {
      cleanup();
      resolve();
    };

    conn.once("ready", onDone);
    conn.once("end", onDone);
  });
}

/**
 * Coordinates periodic maintenance across multiple `zenote-worker` replicas via
 * Redis `SET key token NX PX <ttlMs>`, periodic compare-and-pexpire lease extension
 * during long-running operations, and compare-and-delete Lua release.
 */
export async function withSchedulerLease(
  taskName: string,
  leaseMs: number,
  fn: () => Promise<void>,
  options: SchedulerLeaseOptions = {}
): Promise<SchedulerLeaseResult> {
  const conn = options.connection !== undefined ? options.connection : activeWorkerConnection;
  const failPolicy = options.failPolicy ?? "open";
  const ownerId = options.ownerId ?? getWorkerInstanceId();

  if (!conn || conn.status !== "ready") {
    if (failPolicy === "closed_when_bullmq" && isBullMqEnabled()) {
      logRuntimeEvent("warn", {
        service: "zenote-worker",
        event: "scheduler_lease_skipped_redis_unavailable",
        workerId: ownerId,
        taskName,
      });
      return { executed: false, reason: "skipped_redis_unavailable" };
    }
    await fn();
    return { executed: true, reason: "ran_without_redis" };
  }

  const lockKey = `${getProcessingQueueName()}:scheduler-lock:${taskName}`;
  const lockToken = `${ownerId}:${crypto.randomUUID()}`;

  let acquired = false;
  try {
    const res = await conn.set(lockKey, lockToken, "PX", leaseMs, "NX");
    acquired = res === "OK";
  } catch (err) {
    if (failPolicy === "closed_when_bullmq" && isBullMqEnabled()) {
      logRuntimeEvent(
        "warn",
        {
          service: "zenote-worker",
          event: "scheduler_lease_skipped_redis_error",
          workerId: ownerId,
          taskName,
        },
        err
      );
      return { executed: false, reason: "skipped_redis_unavailable" };
    }
    await fn();
    return { executed: true, reason: "ran_without_redis" };
  }

  if (!acquired) {
    return { executed: false, reason: "lease_held_by_other" };
  }

  // Renew lease periodically while `fn()` runs so slow operations never overlap on TTL expiry.
  const renewEveryMs =
    options.renewIntervalMs ?? Math.max(1_000, Math.floor(leaseMs / 3));
  const renewTimer = setInterval(() => {
    if (conn.status !== "ready") return;
    void conn
      .eval(EXTEND_LEASE_LUA, 1, lockKey, lockToken, String(leaseMs))
      .catch(() => undefined);
  }, renewEveryMs);
  renewTimer.unref?.();

  try {
    await fn();
    return { executed: true, reason: "lease_acquired" };
  } finally {
    clearInterval(renewTimer);
    if (conn.status === "ready") {
      await conn
        .eval(RELEASE_LEASE_LUA, 1, lockKey, lockToken)
        .catch(() => undefined);
    }
  }
}

/**
 * Starts the durable BullMQ worker and recurring maintenance timers.
 * Idempotent within a single process.
 */
export async function startProcessingWorker(
  options: StartWorkerOptions = {}
): Promise<Worker<QueuedProcessingJobPayload> | null> {
  if (activeWorker) return activeWorker;
  if (!isBullMqEnabled()) return null;

  workerDraining = false;

  const queueName = options.queueName ?? getProcessingQueueName();
  const parsedConcurrency = Number(process.env.BULLMQ_WORKER_CONCURRENCY || 3);
  const concurrency =
    options.concurrency ??
    (Number.isFinite(parsedConcurrency) && parsedConcurrency >= 1
      ? Math.floor(parsedConcurrency)
      : 3);

  const connection = createBullMqRedisConnection({
    maxRetriesPerRequest: null,
  });

  connection.on("error", (err) => {
    logRuntimeEvent(
      "error",
      {
        service: "zenote-worker",
        event: "redis_connection_error",
        workerId: getWorkerInstanceId(),
      },
      err
    );
  });

  connection.on("ready", () => {
    logRuntimeEvent("info", {
      service: "zenote-worker",
      event: "redis_connected",
      workerId: getWorkerInstanceId(),
      queueName,
    });
  });

  const worker = new Worker<QueuedProcessingJobPayload>(
    queueName,
    async (job: Job<QueuedProcessingJobPayload>) => {
      const startedAt = Date.now();
      lastHeartbeatAt = new Date();
      const { jobId, type } = job.data;
      if (!jobId || !type) return;

      logRuntimeEvent("info", {
        service: "zenote-worker",
        event: "job_started",
        workerId: getWorkerInstanceId(),
        jobId,
        queueJobId: job.id ?? null,
        type,
      });

      await executeProcessingJobByType(jobId, type);
      lastHeartbeatAt = new Date();
      const durationMs = Date.now() - startedAt;

      logRuntimeEvent("info", {
        service: "zenote-worker",
        event: "job_finished",
        workerId: getWorkerInstanceId(),
        jobId,
        queueJobId: job.id ?? null,
        type,
        durationMs,
      });

      void emitOperationalMetric("worker.job.completed", 1, {
        type: "count",
        tags: [`job_type:${type}`],
        properties: { jobId, type, workerId: getWorkerInstanceId() },
      });
      void emitOperationalMetric("worker.job.duration_ms", durationMs, {
        type: "gauge",
        tags: [`job_type:${type}`],
        properties: { jobId, type, workerId: getWorkerInstanceId() },
      });
    },
    {
      connection,
      concurrency,
      // Conservation settings for Upstash Redis Free Tier:
      // 60s stalled-job check interval and 30s drain delay minimize idle Redis commands.
      stalledInterval: 60_000,
      drainDelay: 30,
    }
  );

  worker.on("completed", () => {
    lastHeartbeatAt = new Date();
  });

  worker.on("failed", (job, err) => {
    lastHeartbeatAt = new Date();
    const jobType = job?.data?.type ?? "unknown";
    logRuntimeEvent(
      "error",
      {
        service: "zenote-worker",
        event: "job_failed",
        workerId: getWorkerInstanceId(),
        queueJobId: job?.id ?? null,
        jobId: job?.data?.jobId ?? null,
        type: job?.data?.type ?? null,
      },
      err
    );
    void emitOperationalMetric("worker.job.failed", 1, {
      type: "count",
      tags: [`job_type:${jobType}`],
      properties: { jobId: job?.data?.jobId ?? "unknown", type: jobType, workerId: getWorkerInstanceId() },
    });
  });

  activeWorker = worker;
  activeWorkerConnection = connection;
  workerStartedAt = new Date();
  lastHeartbeatAt = new Date();

  if (options.enableScheduledMaintenance !== false) {
    startMaintenanceSchedulers({
      reconciliationIntervalMs: options.reconciliationIntervalMs,
      watchRenewalIntervalMs: options.watchRenewalIntervalMs,
    });
  }

  return worker;
}

/**
 * Starts periodic background timers for:
 *   1. Stranded `ProcessingJob` & Google Drive `PROCESSING` material reconciliation
 *   2. Proactive Google Drive watch-channel renewal (`LIM-18` Part 3)
 *   3. Completed/failed `ProcessingJob` retention cleanup
 */
export function startMaintenanceSchedulers(
  options: {
    reconciliationIntervalMs?: number;
    watchRenewalIntervalMs?: number;
    retentionCleanupIntervalMs?: number;
    runImmediateReconciliation?: boolean;
  } = {}
): void {
  stopMaintenanceSchedulers();

  const reconcileMs =
    options.reconciliationIntervalMs ?? DEFAULT_RECONCILIATION_INTERVAL_MS;
  const watchMs =
    options.watchRenewalIntervalMs ?? DEFAULT_WATCH_RENEWAL_INTERVAL_MS;
  const retentionMs =
    options.retentionCleanupIntervalMs ?? DEFAULT_RETENTION_CLEANUP_INTERVAL_MS;

  const runReconciliationPass = async (trigger: "startup" | "interval") => {
    if (trigger === "startup" && isBullMqEnabled()) {
      await waitForRedisReady(activeWorkerConnection, 3_000);
    }
    await withSchedulerLease(
      "reconcile",
      60_000,
      async () => {
        const startedAt = Date.now();
        const summary = await reconcileStrandedProcessingJobs({
          dispatchFn: async (jobId, type) => {
            await dispatchProcessingJob(jobId, type, { replaceStaleQueueJob: true });
          },
        });
        if (
          summary.requeuedJobs > 0 ||
          summary.failedExhaustedJobs > 0 ||
          summary.strandedMaterialsRecovered > 0
        ) {
          logRuntimeEvent("info", {
            service: "zenote-worker",
            event: `reconciliation_${trigger}`,
            workerId: getWorkerInstanceId(),
            durationMs: Date.now() - startedAt,
            ...summary,
          });
          void emitOperationalMetric(
            "worker.reconciliation.recovered",
            summary.requeuedJobs + summary.failedExhaustedJobs + summary.strandedMaterialsRecovered,
            {
              type: "count",
              tags: [`trigger:${trigger}`],
              properties: { workerId: getWorkerInstanceId(), ...summary },
            }
          );
        }
      },
      { failPolicy: "open" }
    );
  };

  if (options.runImmediateReconciliation !== false) {
    void runReconciliationPass("startup").catch((err) => {
      logRuntimeEvent(
        "error",
        {
          service: "zenote-worker",
          event: "reconciliation_startup_failed",
          workerId: getWorkerInstanceId(),
        },
        err
      );
    });
  }

  reconciliationTimer = setInterval(() => {
    lastHeartbeatAt = new Date();
    void runReconciliationPass("interval").catch((err) => {
      logRuntimeEvent(
        "error",
        {
          service: "zenote-worker",
          event: "reconciliation_interval_failed",
          workerId: getWorkerInstanceId(),
        },
        err
      );
    });
  }, reconcileMs);
  reconciliationTimer.unref?.();

  watchRenewalTimer = setInterval(() => {
    lastHeartbeatAt = new Date();
    void withSchedulerLease(
      "watch-renewal",
      120_000,
      async () => {
        await runScheduledWatchChannelRenewal();
      },
      { failPolicy: "closed_when_bullmq" }
    ).catch((err) => {
      logRuntimeEvent(
        "error",
        {
          service: "zenote-worker",
          event: "watch_renewal_failed",
          workerId: getWorkerInstanceId(),
        },
        err
      );
    });
  }, watchMs);
  watchRenewalTimer.unref?.();

  retentionCleanupTimer = setInterval(() => {
    void withSchedulerLease(
      "retention-cleanup",
      120_000,
      async () => {
        await pruneCompletedProcessingJobs(30);
      },
      { failPolicy: "closed_when_bullmq" }
    ).catch(() => undefined);
  }, retentionMs);
  retentionCleanupTimer.unref?.();
}

export function stopMaintenanceSchedulers(): void {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  }
  if (watchRenewalTimer) {
    clearInterval(watchRenewalTimer);
    watchRenewalTimer = null;
  }
  if (retentionCleanupTimer) {
    clearInterval(retentionCleanupTimer);
    retentionCleanupTimer = null;
  }
}

/**
 * Gracefully stops the active BullMQ worker, maintenance timers, worker Redis socket,
 * and shared producer queue.
 */
export async function stopProcessingWorker(): Promise<void> {
  workerDraining = true;
  stopMaintenanceSchedulers();

  if (activeWorker) {
    const w = activeWorker;
    activeWorker = null;
    workerStartedAt = null;
    await w.close().catch(() => undefined);
  }

  if (activeWorkerConnection) {
    const conn = activeWorkerConnection;
    activeWorkerConnection = null;
    try {
      if (conn.status !== "end") {
        await Promise.race([
          conn.quit().catch(() => conn.disconnect()),
          new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
        ]);
      }
    } finally {
      if (conn.status !== "end") {
        conn.disconnect();
      }
    }
  }

  await closeProcessingQueue();
  await closeJobEventPubSub();
}

export interface QueueHealthStatus {
  configured: boolean;
  mode: "bullmq" | "in_process";
  workerMode: "dedicated" | "embedded";
  queueName: string;
  redisSource: string | null;
  workerActive: boolean;
  draining: boolean;
  workerStartedAt: string | null;
  lastHeartbeatAt: string | null;
  counts?: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  error?: string;
}

/**
 * Reports safe, credential-free queue and worker health telemetry for `/api/health`.
 */
export async function checkQueueHealth(): Promise<QueueHealthStatus> {
  const resolved = resolveBullMqRedisConfig();
  const enabled = isBullMqEnabled();
  const workerMode = isDedicatedWorkerMode() ? "dedicated" : "embedded";

  if (!resolved || !enabled) {
    return {
      configured: Boolean(resolved),
      mode: "in_process",
      workerMode,
      queueName: getProcessingQueueName(),
      redisSource: resolved?.source ?? null,
      workerActive: Boolean(activeWorker),
      draining: workerDraining,
      workerStartedAt: workerStartedAt?.toISOString() ?? null,
      lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
    };
  }

  try {
    const queue = getProcessingQueue();
    if (!queue) {
      return {
        configured: true,
        mode: "in_process",
        workerMode,
        queueName: getProcessingQueueName(),
        redisSource: resolved.source,
        workerActive: Boolean(activeWorker),
        draining: workerDraining,
        workerStartedAt: workerStartedAt?.toISOString() ?? null,
        lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
      };
    }

    const counts = await Promise.race([
      queue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Queue health check timed out")), 1500)
      ),
    ]);

    return {
      configured: true,
      mode: "bullmq",
      workerMode,
      queueName: getProcessingQueueName(),
      redisSource: resolved.source,
      workerActive: Boolean(activeWorker),
      draining: workerDraining,
      workerStartedAt: workerStartedAt?.toISOString() ?? null,
      lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      },
    };
  } catch (err) {
    return {
      configured: true,
      mode: "in_process",
      workerMode,
      queueName: getProcessingQueueName(),
      redisSource: resolved.source,
      workerActive: Boolean(activeWorker),
      draining: workerDraining,
      workerStartedAt: workerStartedAt?.toISOString() ?? null,
      lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
