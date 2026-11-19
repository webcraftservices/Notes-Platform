/**
 * Phase 15 & Stage A — Centralized Background Job Dispatcher.
 *
 * Routes asynchronous `ProcessingJob` workloads (`DOCUMENT_EXTRACTION`,
 * `EMBEDDING`, `TRANSCRIPTION`, `AI_NOTE_GENERATION`, `GOOGLE_SYNC`) through
 * BullMQ + Redis when TCP Redis is configured and active, while automatically
 * falling back to in-process execution when BullMQ is disabled (such as in
 * hermetic unit tests or local development without Redis).
 *
 * Stage A hardening:
 *   - Cooldown-based recovery if synchronous Queue constructor fails transiently
 *     (replaces permanent latch).
 *   - Explicit producer `IORedis` connection tracking and clean shutdown.
 *   - Safe stale-job replacement flag for crash recovery (`replaceStaleQueueJob`).
 *   - Structured redacted runtime logging (`logRuntimeEvent`).
 *
 * PostgreSQL `ProcessingJob` remains the authoritative application state record.
 */

import { Queue } from "bullmq";
import type IORedis from "ioredis";
import type { JobType } from "@prisma/client";
import {
  createBullMqRedisConnection,
  isBullMqEnabled,
  isDedicatedWorkerMode,
  resolveBullMqRedisConfig,
} from "@/lib/queue/connection";
import { logRuntimeEvent } from "@/lib/queue/logger";

export const PROCESSING_QUEUE_NAME = "zenote-processing-jobs";

export function getProcessingQueueName(
  env: Record<string, string | undefined> = process.env
): string {
  return env.BULLMQ_QUEUE_NAME?.trim() || PROCESSING_QUEUE_NAME;
}

export interface QueuedProcessingJobPayload {
  jobId: string;
  type: JobType;
  enqueuedAt: string;
}

export interface DispatchJobResult {
  jobId: string;
  type: JobType;
  mode: "bullmq" | "in_process";
  queueJobId?: string;
}

const QUEUE_INIT_RETRY_COOLDOWN_MS = 15_000;

let sharedQueue: Queue<QueuedProcessingJobPayload> | null = null;
let sharedQueueConnection: IORedis | null = null;
let lastQueueInitFailureAt: number | null = null;

/**
 * Returns or initializes the shared BullMQ `Queue` instance when TCP Redis is enabled.
 * Retries automatically after `QUEUE_INIT_RETRY_COOLDOWN_MS` if initialization failed previously.
 */
export function getProcessingQueue(): Queue<QueuedProcessingJobPayload> | null {
  if (!isBullMqEnabled()) return null;
  if (sharedQueue) return sharedQueue;
  if (
    lastQueueInitFailureAt !== null &&
    Date.now() - lastQueueInitFailureAt < QUEUE_INIT_RETRY_COOLDOWN_MS
  ) {
    return null;
  }

  let connection: IORedis | null = null;
  try {
    connection = createBullMqRedisConnection({
      lazyConnect: false,
      maxRetriesPerRequest: null,
    });
    connection.on("error", (err) => {
      logRuntimeEvent(
        "error",
        {
          service: "zenote-queue",
          event: "producer_redis_error",
        },
        err
      );
    });
    connection.on("ready", () => {
      lastQueueInitFailureAt = null;
    });

    sharedQueue = new Queue<QueuedProcessingJobPayload>(getProcessingQueueName(), {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2_000,
        },
        removeOnComplete: {
          age: 24 * 3600,
          count: 200,
        },
        removeOnFail: {
          age: 7 * 24 * 3600,
          count: 500,
        },
      },
    });
    sharedQueueConnection = connection;
    lastQueueInitFailureAt = null;
    return sharedQueue;
  } catch (err) {
    lastQueueInitFailureAt = Date.now();
    if (connection) {
      connection.disconnect();
    }
    logRuntimeEvent(
      "error",
      {
        service: "zenote-queue",
        event: "producer_init_failed",
      },
      err
    );
    return null;
  }
}

/**
 * Closes the shared producer queue and its TCP connection cleanly
 * (used during graceful shutdown and tests).
 */
export async function closeProcessingQueue(): Promise<void> {
  if (sharedQueue) {
    const q = sharedQueue;
    sharedQueue = null;
    await q.close().catch(() => undefined);
  }
  if (sharedQueueConnection) {
    const conn = sharedQueueConnection;
    sharedQueueConnection = null;
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
  lastQueueInitFailureAt = null;
}

/**
 * Executes the domain runner for a given `(jobId, type)`.
 * Dynamic imports avoid circular module initialization between `ingestion`,
 * `document-extraction`, `transcription`, `note-generation`, and `google-import`.
 */
export async function executeProcessingJobByType(
  jobId: string,
  type: JobType
): Promise<void> {
  switch (type) {
    case "DOCUMENT_EXTRACTION": {
      const { runDocumentExtractionJob } = await import("@/lib/document-extraction");
      await runDocumentExtractionJob(jobId);
      return;
    }
    case "EMBEDDING": {
      const { runEmbeddingJob } = await import("@/lib/ingestion");
      await runEmbeddingJob(jobId);
      return;
    }
    case "TRANSCRIPTION": {
      const { runTranscriptionJob } = await import("@/lib/transcription");
      await runTranscriptionJob(jobId);
      return;
    }
    case "AI_NOTE_GENERATION": {
      const { runNoteGenerationJob } = await import("@/lib/note-generation");
      await runNoteGenerationJob(jobId);
      return;
    }
    case "GOOGLE_SYNC": {
      const { runGoogleImportJob } = await import("@/lib/google-import");
      await runGoogleImportJob(jobId);
      return;
    }
    default: {
      // Other enum values (FLASHCARD_GENERATION, QUIZ_GENERATION, etc.) are synchronous
      return;
    }
  }
}

/**
 * Dispatches a `ProcessingJob` for background execution.
 *
 * - When BullMQ is enabled AND either a dedicated worker (`BULLMQ_DEDICATED_WORKER=true`)
 *   or embedded worker is running, adds the job to the durable BullMQ Redis queue.
 * - Also starts in-process execution unless `BULLMQ_DEDICATED_WORKER === "true"` or
 *   `options.forceBullMqOnly === true`, ensuring zero-config local/single-process
 *   deployments without a separate worker process still complete jobs immediately
 *   while BullMQ tracks and recovers any interrupted jobs.
 */
export async function dispatchProcessingJob(
  jobId: string,
  type: JobType,
  options: {
    delayMs?: number;
    forceBullMqOnly?: boolean;
    awaitInProcess?: boolean;
    replaceStaleQueueJob?: boolean;
    inProcessRunner?: (jobId: string) => Promise<unknown> | unknown;
  } = {}
): Promise<DispatchJobResult> {
  const runInProcess = (): Promise<void> => {
    if (options.inProcessRunner) {
      return Promise.resolve(options.inProcessRunner(jobId)).then(() => undefined);
    }
    return executeProcessingJobByType(jobId, type);
  };

  const queue = getProcessingQueue();
  const queueJobId = `${type}:${jobId}`;
  const dedicatedWorkerOnly =
    options.forceBullMqOnly === true || isDedicatedWorkerMode();

  if (queue) {
    try {
      if (options.replaceStaleQueueJob) {
        const existingJob = await queue.getJob(queueJobId).catch(() => undefined);
        if (existingJob) {
          const [isDone, isFailed] = await Promise.all([
            existingJob.isCompleted().catch(() => false),
            existingJob.isFailed().catch(() => false),
          ]);
          if (isDone || isFailed) {
            await existingJob.remove().catch(() => undefined);
          }
        }
      }

      await queue.add(
        type,
        {
          jobId,
          type,
          enqueuedAt: new Date().toISOString(),
        },
        {
          jobId: queueJobId,
          ...(options.delayMs ? { delay: options.delayMs } : {}),
        }
      );

      if (!dedicatedWorkerOnly) {
        const execPromise = runInProcess();
        if (options.awaitInProcess) {
          await execPromise;
        } else {
          void execPromise;
        }
      }

      return {
        jobId,
        type,
        mode: "bullmq",
        queueJobId,
      };
    } catch (err) {
      logRuntimeEvent(
        "error",
        {
          service: "zenote-queue",
          event: dedicatedWorkerOnly
            ? "bullmq_enqueue_failed_dedicated"
            : "bullmq_enqueue_failed_fallback",
          jobId,
          queueJobId,
          type,
        },
        err
      );
      if (dedicatedWorkerOnly) {
        // In dedicated-worker mode we still avoid crashing caller HTTP handlers
        // when Postgres ProcessingJob is already safely persisted as QUEUED
        // (reconcileStrandedProcessingJobs will pick it up), unless Redis is down
        // in which case in-process fallback only runs if not forced BullMQ-only.
        if (options.forceBullMqOnly) {
          throw err;
        }
      }
    }
  }

  const execPromise = runInProcess();
  if (options.awaitInProcess) {
    await execPromise;
  } else {
    void execPromise;
  }

  return {
    jobId,
    type,
    mode: "in_process",
  };
}

export function getQueueConfigSummary(): {
  enabled: boolean;
  dedicatedWorkerMode: boolean;
  queueName: string;
  redisSource: string | null;
  redisHost: string | null;
} {
  const resolved = resolveBullMqRedisConfig();
  return {
    enabled: isBullMqEnabled(),
    dedicatedWorkerMode: isDedicatedWorkerMode(),
    queueName: getProcessingQueueName(),
    redisSource: resolved?.source ?? null,
    redisHost: resolved?.host ?? null,
  };
}
