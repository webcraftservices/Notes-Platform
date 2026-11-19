/**
 * Phase 15 (Task 15-03) & Stage B — Real-Time Processing Job Event Bus.
 *
 * Broadcasts safe, redacted `ProcessingJob` lifecycle transitions (`QUEUED`,
 * `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`) to active SSE stream
 * subscribers within the server process, and optionally fans events across
 * multiple `zenote-web` / `zenote-worker` replicas via Redis Pub/Sub when
 * `SSE_REDIS_PUBSUB_ENABLED="true"` (with PostgreSQL `ProcessingJob`
 * polling preserved as the authoritative fallback).
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import type IORedis from "ioredis";
import type { JobStatus, JobType } from "@prisma/client";
import { createBullMqRedisConnection, isBullMqEnabled } from "@/lib/queue/connection";

export interface ProcessingJobStreamEvent {
  /** Monotonic or timestamp-prefixed event ID for SSE `id:` / `Last-Event-ID`. */
  eventId: string;
  jobId: string;
  userId: string;
  materialId: string | null;
  type: JobType;
  status: JobStatus;
  progress: number;
  /** Public, user-safe error summary (never raw provider stack traces or credentials). */
  error: string | null;
  updatedAt: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

const INSTANCE_ID = crypto.randomBytes(4).toString("hex");
let sequenceCounter = 0;

const RECENT_EVENT_CACHE_LIMIT = 500;
const recentEventIds = new Set<string>();

let redisPublisher: IORedis | null = null;
let redisSubscriber: IORedis | null = null;
let subscriberPromise: Promise<boolean> | null = null;
let pubSubGeneration = 0;

const ACTIVE_REDIS_STATUSES = new Set([
  "connecting",
  "connect",
  "ready",
  "reconnecting",
]);

function teardownRedisClient(conn: IORedis | null): void {
  if (!conn) return;
  try {
    conn.removeAllListeners?.();
    if (conn.status !== "end") {
      conn.disconnect();
    }
  } catch {
    // Ignore best-effort teardown
  }
}

export function isRedisPubSubSseEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.SSE_REDIS_PUBSUB_ENABLED === "true" &&
    isBullMqEnabled(env as NodeJS.ProcessEnv)
  );
}

export function getJobEventsRedisChannel(
  env: Record<string, string | undefined> = process.env
): string {
  const queueName = env.BULLMQ_QUEUE_NAME?.trim() || "zenote-processing-jobs";
  return `${queueName}:job-events`;
}

export function createStreamEventId(timestampMs: number = Date.now()): string {
  sequenceCounter = (sequenceCounter + 1) % 1_000_000;
  return `${timestampMs}-${INSTANCE_ID}-${sequenceCounter}`;
}

function recordSeenEventId(eventId: string): boolean {
  if (recentEventIds.has(eventId)) return false;
  if (recentEventIds.size >= RECENT_EVENT_CACHE_LIMIT) {
    const first = recentEventIds.values().next().value;
    if (first !== undefined) {
      recentEventIds.delete(first);
    }
  }
  recentEventIds.add(eventId);
  return true;
}

function emitLocalEvent(payload: ProcessingJobStreamEvent): void {
  emitter.emit("job:update", payload);
  emitter.emit(`job:user:${payload.userId}`, payload);
  emitter.emit(`job:id:${payload.jobId}`, payload);
  if (payload.materialId) {
    emitter.emit(`job:material:${payload.materialId}`, payload);
  }
}

export function publishProcessingJobEventViaRedis(payload: ProcessingJobStreamEvent): void {
  if (!isRedisPubSubSseEnabled()) return;

  try {
    if (
      redisPublisher &&
      (redisPublisher.status === "end" || redisPublisher.status === "close")
    ) {
      teardownRedisClient(redisPublisher);
      redisPublisher = null;
    }

    if (!redisPublisher) {
      redisPublisher = createBullMqRedisConnection({
        lazyConnect: true,
        maxRetriesPerRequest: 2,
      });
      redisPublisher.on("error", () => {
        // Resilient best-effort publish; DB polling guarantees delivery even if Redis blips.
      });
    }
    const channel = getJobEventsRedisChannel();
    void redisPublisher.publish(channel, JSON.stringify(payload)).catch(() => undefined);
  } catch {
    // Non-fatal: PostgreSQL polling remains active as authoritative source.
  }
}

export async function ensureJobEventSubscriber(): Promise<boolean> {
  if (!isRedisPubSubSseEnabled()) return false;
  if (redisSubscriber && ACTIVE_REDIS_STATUSES.has(redisSubscriber.status)) {
    return true;
  }
  if (subscriberPromise) return subscriberPromise;

  if (redisSubscriber) {
    teardownRedisClient(redisSubscriber);
    redisSubscriber = null;
  }

  const generation = pubSubGeneration;

  let settled = false;
  let currentPromise: Promise<boolean> | null = null;
  currentPromise = (async () => {
    let sub: IORedis | null = null;
    try {
      sub = createBullMqRedisConnection({
        maxRetriesPerRequest: null,
      });
      const channel = getJobEventsRedisChannel();

      sub.on("message", (incomingChannel, rawMessage) => {
        if (incomingChannel !== channel) return;
        try {
          const parsed = JSON.parse(rawMessage) as ProcessingJobStreamEvent;
          if (!parsed || typeof parsed.eventId !== "string" || typeof parsed.jobId !== "string") {
            return;
          }
          if (!recordSeenEventId(parsed.eventId)) {
            return;
          }
          emitLocalEvent(parsed);
        } catch {
          // Ignore malformed pub/sub messages
        }
      });

      sub.on("error", () => {
        // Handled by reconnect strategy / DB poll fallback
      });

      await sub.subscribe(channel);
      if (generation !== pubSubGeneration) {
        teardownRedisClient(sub);
        return false;
      }

      redisSubscriber = sub;
      return true;
    } catch {
      teardownRedisClient(sub);
      if (redisSubscriber === sub) {
        redisSubscriber = null;
      }
      return false;
    } finally {
      settled = true;
      if (currentPromise && subscriberPromise === currentPromise) {
        subscriberPromise = null;
      }
    }
  })();

  if (!settled) {
    subscriberPromise = currentPromise;
  }

  return currentPromise;
}

export async function closeJobEventPubSub(): Promise<void> {
  pubSubGeneration += 1;
  const pub = redisPublisher;
  const sub = redisSubscriber;
  redisPublisher = null;
  redisSubscriber = null;
  subscriberPromise = null;
  recentEventIds.clear();

  for (const conn of [pub, sub]) {
    if (!conn) continue;
    try {
      if (conn.status !== "end") {
        await Promise.race([
          conn.quit().catch(() => conn.disconnect()),
          new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }
    } finally {
      teardownRedisClient(conn);
    }
  }
}

export function emitProcessingJobEvent(
  input: Omit<ProcessingJobStreamEvent, "eventId" | "updatedAt"> & {
    eventId?: string;
    updatedAt?: string | Date;
  }
): ProcessingJobStreamEvent {
  const updatedAtIso =
    input.updatedAt instanceof Date
      ? input.updatedAt.toISOString()
      : typeof input.updatedAt === "string"
        ? input.updatedAt
        : new Date().toISOString();

  const payload: ProcessingJobStreamEvent = {
    eventId: input.eventId ?? createStreamEventId(),
    jobId: input.jobId,
    userId: input.userId,
    materialId: input.materialId ?? null,
    type: input.type,
    status: input.status,
    progress: Math.max(0, Math.min(100, Math.round(input.progress))),
    error: input.error ?? null,
    updatedAt: updatedAtIso,
  };

  recordSeenEventId(payload.eventId);
  emitLocalEvent(payload);
  publishProcessingJobEventViaRedis(payload);

  return payload;
}

export function subscribeToJobEvents(
  listener: (event: ProcessingJobStreamEvent) => void
): () => void {
  emitter.on("job:update", listener);
  return () => {
    emitter.off("job:update", listener);
  };
}

export function subscribeToSingleJobEvents(
  jobId: string,
  listener: (event: ProcessingJobStreamEvent) => void
): () => void {
  const channel = `job:id:${jobId}`;
  emitter.on(channel, listener);
  return () => {
    emitter.off(channel, listener);
  };
}
