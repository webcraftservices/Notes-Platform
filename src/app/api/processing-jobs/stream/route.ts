/**
 * Phase 15 (Task 15-03) — Real-Time Processing Job Updates via Server-Sent Events (SSE).
 *
 * Endpoint: `GET /api/processing-jobs/stream`
 * Optional query params:
 *   - `jobId`: Stream updates for a single accessible `ProcessingJob`
 *   - `materialId`: Stream updates for all jobs attached to an accessible `Material`
 *
 * Security & Multi-Tenant Isolation:
 *   - Requires authenticated session (`getSessionUser()`).
 *   - Validates job / material ownership or group RBAC via `getAccessibleProcessingJob`
 *     and `getAccessibleMaterial` before opening the stream and before forwarding
 *     any cross-user group job event.
 *   - Never emits provider credentials, tokens, raw prompts, or stack traces.
 */

import { db } from "@/lib/db";
import {
  getAccessibleMaterial,
  getAccessibleProcessingJob,
  getSessionUser,
  NotAuthorizedError,
} from "@/lib/access";
import { FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from "@/lib/api-response";
import {
  createStreamEventId,
  ensureJobEventSubscriber,
  subscribeToJobEvents,
  type ProcessingJobStreamEvent,
} from "@/lib/queue/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_INTERVAL_MS = 15_000;
const DB_POLL_SYNC_INTERVAL_MS = 2_500;

function isTerminalStatus(status: string): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

function sanitizePublicJobPayload(job: {
  id: string;
  userId: string;
  materialId: string | null;
  type: string;
  status: string;
  progress: number;
  error: string | null;
  updatedAt?: Date;
  completedAt?: Date | null;
  createdAt?: Date;
}) {
  return {
    id: job.id,
    jobId: job.id,
    materialId: job.materialId ?? null,
    type: job.type,
    status: job.status,
    progress: job.progress ?? 0,
    error: job.error ?? null,
    updatedAt: (job.updatedAt ?? job.completedAt ?? job.createdAt ?? new Date()).toISOString(),
  };
}

export async function handleProcessingJobsStream(
  req: Request,
  overrideJobId?: string
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const url = new URL(req.url);
  const jobId = overrideJobId?.trim() || url.searchParams.get("jobId")?.trim() || null;
  const materialId = url.searchParams.get("materialId")?.trim() || null;
  const lastEventId =
    req.headers.get("Last-Event-ID")?.trim() ||
    url.searchParams.get("lastEventId")?.trim() ||
    null;

  // 1. Strict upfront authorization check for explicit `jobId`, `materialId`,
  //    or derived material scope (`initialJob.materialId` on jobId-only streams)
  let initialJob: Awaited<ReturnType<typeof getAccessibleProcessingJob>> | null = null;
  if (jobId) {
    try {
      initialJob = await getAccessibleProcessingJob(jobId, user.id);
      if (!initialJob) return NOT_FOUND();
    } catch (err) {
      if (err instanceof NotAuthorizedError) return FORBIDDEN();
      throw err;
    }
  }

  const effectiveMaterialId = materialId ?? initialJob?.materialId ?? null;

  if (effectiveMaterialId) {
    try {
      const mat = await getAccessibleMaterial(effectiveMaterialId, user.id);
      if (!mat) return NOT_FOUND();
    } catch (err) {
      if (err instanceof NotAuthorizedError) return FORBIDDEN();
      throw err;
    }
  }

  // Enforce composite scope consistency when both `jobId` and `materialId` are requested
  if (initialJob && materialId && initialJob.materialId !== materialId) {
    return NOT_FOUND();
  }

  const encoder = new TextEncoder();
  let closed = false;
  let cleanupStream: (() => void) | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const closeSafe = () => {
    if (closed) return;
    closed = true;
    if (cleanupStream) {
      const fn = cleanupStream;
      cleanupStream = null;
      fn();
    }
    try {
      controllerRef?.close();
    } catch {
      // Stream already closed by consumer
    }
  };

  type MaterialAuthCheckStatus = "valid" | "revoked" | "transient_error";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      const lastEmittedSignatureByJobId = new Map<string, string>();
      let materialAuthCheckInFlight: Promise<MaterialAuthCheckStatus> | null = null;

      // Coalesce concurrent authorization checks around the policy-neutral status so
      // a fail-open periodic DB poll and fail-closed bus listener never leak policies.
      const checkMaterialAccessStatus = async (): Promise<MaterialAuthCheckStatus> => {
        if (!effectiveMaterialId) return "valid";
        if (closed) return "revoked";
        if (materialAuthCheckInFlight) return materialAuthCheckInFlight;

        let settled = false;
        let currentCheck: Promise<MaterialAuthCheckStatus> | null = null;
        currentCheck = (async (): Promise<MaterialAuthCheckStatus> => {
          try {
            const mat = await getAccessibleMaterial(effectiveMaterialId, user.id);
            return mat ? "valid" : "revoked";
          } catch (err) {
            if (err instanceof NotAuthorizedError) {
              return "revoked";
            }
            return "transient_error";
          } finally {
            settled = true;
            if (currentCheck && materialAuthCheckInFlight === currentCheck) {
              materialAuthCheckInFlight = null;
            }
          }
        })();

        if (!settled) {
          materialAuthCheckInFlight = currentCheck;
        }
        return currentCheck;
      };

      const verifyMaterialAccessStillValid = async (
        failOnTransientError: boolean
      ): Promise<boolean> => {
        const status = await checkMaterialAccessStatus();
        if (status === "revoked") {
          closeSafe();
          return false;
        }
        if (status === "transient_error") {
          return !failOnTransientError;
        }
        return !closed;
      };

      const checkMaterialAccessVerifiedForSync = async (): Promise<boolean> => {
        const status = await checkMaterialAccessStatus();
        if (status === "revoked") {
          closeSafe();
          return false;
        }
        // Keep stream open on transient DB errors, but do NOT poll or emit jobs
        // until access is positively re-verified (fail closed on that tick).
        if (status === "transient_error") {
          return false;
        }
        return !closed;
      };

      const sendRaw = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closeSafe();
        }
      };

      const sendJobEvent = (
        payload: ReturnType<typeof sanitizePublicJobPayload>,
        eventId: string = createStreamEventId()
      ) => {
        if (closed) return;
        const sig = `${payload.status}:${payload.progress}:${payload.error ?? ""}`;
        if (lastEmittedSignatureByJobId.get(payload.id) === sig) {
          return;
        }
        lastEmittedSignatureByJobId.set(payload.id, sig);
        sendRaw(
          `id: ${eventId}\nevent: job-status\ndata: ${JSON.stringify({ job: payload })}\n\n`
        );
      };

      if (closed || req.signal?.aborted) {
        closeSafe();
        return;
      }

      // Emit connection ready comment (and acknowledge Last-Event-ID when reconnecting)
      sendRaw(
        `: connected${lastEventId ? ` resume=${lastEventId.replace(/[\r\n]/g, "")}` : ""}\n\n`
      );

      // Emit initial snapshot
      if (initialJob) {
        const sanitized = sanitizePublicJobPayload(initialJob);
        sendJobEvent(sanitized);
        if (isTerminalStatus(initialJob.status)) {
          closeSafe();
          return;
        }
      } else if (materialId) {
        const materialJobs = await db.processingJob
          .findMany({
            where: { materialId },
            orderBy: { createdAt: "desc" },
            take: 5,
          })
          .catch(() => []);
        if (closed || req.signal?.aborted) {
          closeSafe();
          return;
        }
        for (const j of materialJobs) {
          sendJobEvent(sanitizePublicJobPayload(j));
        }
      } else {
        const activeUserJobs = await db.processingJob
          .findMany({
            where: {
              userId: user.id,
              status: { in: ["QUEUED", "RUNNING"] },
            },
            orderBy: { createdAt: "desc" },
            take: 10,
          })
          .catch(() => []);
        if (closed || req.signal?.aborted) {
          closeSafe();
          return;
        }
        for (const j of activeUserJobs) {
          sendJobEvent(sanitizePublicJobPayload(j));
        }
      }

      if (closed || req.signal?.aborted) {
        closeSafe();
        return;
      }

      // Enable cross-replica Redis Pub/Sub bridge when configured (no-op otherwise)
      void ensureJobEventSubscriber().catch(() => {});

      // Subscribe to in-process event bus
      const unsubscribeBus = subscribeToJobEvents(async (ev: ProcessingJobStreamEvent) => {
        if (closed) return;
        if (jobId && (ev.jobId !== jobId || ev.userId !== user.id)) return;
        if (effectiveMaterialId && ev.materialId !== effectiveMaterialId) return;

        if (!jobId && !materialId && ev.userId !== user.id) {
          return;
        }

        // Any event on a material-backed stream (same-user or cross-user) requires
        // live fail-closed re-verification of current material access.
        if (effectiveMaterialId) {
          const allowed = await verifyMaterialAccessStillValid(true);
          if (!allowed || closed) return;
        }

        sendJobEvent(
          {
            id: ev.jobId,
            jobId: ev.jobId,
            materialId: ev.materialId,
            type: ev.type,
            status: ev.status,
            progress: ev.progress,
            error: ev.error,
            updatedAt: ev.updatedAt,
          },
          ev.eventId
        );

        if (jobId && isTerminalStatus(ev.status)) {
          closeSafe();
        }
      });

      // Cross-process DB state sync (catches updates committed by a standalone worker process)
      let dbPollInFlight = false;
      const dbSyncTimer = setInterval(async () => {
        if (closed || dbPollInFlight) return;
        dbPollInFlight = true;
        try {
          if (jobId) {
            if (effectiveMaterialId) {
              const verified = await checkMaterialAccessVerifiedForSync();
              if (!verified || closed) return;
            }
            const fresh = await db.processingJob.findUnique({ where: { id: jobId } });
            if (
              !fresh ||
              fresh.userId !== user.id ||
              (effectiveMaterialId && fresh.materialId !== effectiveMaterialId)
            ) {
              closeSafe();
              return;
            }
            sendJobEvent(sanitizePublicJobPayload(fresh));
            if (isTerminalStatus(fresh.status)) {
              closeSafe();
            }
          } else if (materialId) {
            const verified = await checkMaterialAccessVerifiedForSync();
            if (!verified || closed) return;
            const recent = await db.processingJob.findMany({
              where: { materialId },
              orderBy: { createdAt: "desc" },
              take: 5,
            });
            for (const j of recent) {
              sendJobEvent(sanitizePublicJobPayload(j));
            }
          } else {
            const recentUserJobs = await db.processingJob.findMany({
              where: { userId: user.id },
              orderBy: { updatedAt: "desc" },
              take: 10,
            });
            for (const j of recentUserJobs) {
              sendJobEvent(sanitizePublicJobPayload(j));
            }
          }
        } catch {
          // Transient DB poll error inside stream; keep stream open for next tick
        } finally {
          dbPollInFlight = false;
        }
      }, DB_POLL_SYNC_INTERVAL_MS);

      const heartbeatTimer = setInterval(() => {
        sendRaw(`: ping ${Date.now()}\n\n`);
      }, HEARTBEAT_INTERVAL_MS);

      const onAbort = () => {
        closeSafe();
      };
      req.signal?.addEventListener("abort", onAbort, { once: true });

      cleanupStream = () => {
        unsubscribeBus();
        clearInterval(dbSyncTimer);
        clearInterval(heartbeatTimer);
        req.signal?.removeEventListener("abort", onAbort);
      };

      if (closed || req.signal?.aborted) {
        closeSafe();
      }
    },
    cancel() {
      closeSafe();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(req: Request): Promise<Response> {
  return handleProcessingJobsStream(req);
}

