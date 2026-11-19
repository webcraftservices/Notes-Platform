import { Prisma, type Material, type ProcessingJob } from "@prisma/client";
import { db } from "@/lib/db";
import { sendDatadogMetric } from "@/lib/observability/datadog";
import { sendAzureMonitorMetric } from "@/lib/observability/azure-monitor";
import { getDocumentProcessingService } from "@/lib/services/document-processing";
import {
  MAX_DOCUMENT_EXTRACTION_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
} from "@/lib/services/document-processing-local";
import { queueEmbeddingJob } from "@/lib/ingestion";
import {
  claimJob,
  completeJobWithin,
  createJobIfNoneActive,
  failJob,
  isJobActive,
  notifyJobStatusChange,
  registerJobContext,
} from "@/lib/processing-jobs";
import {
  DOCUMENT_EXTRACTION_TYPES,
  resolveExtractedPages,
  shouldQueueDocumentExtraction,
} from "@/lib/document-extraction-guard";
import { getDocumentExtractionScheduler } from "@/lib/document-extraction-scheduler";

export { MAX_DOCUMENT_EXTRACTION_BYTES, MAX_EXTRACTED_TEXT_CHARS };

// Wire continuous backlog refill: whenever scheduler capacity opens up
// (e.g. an active extraction finishes or a queued waiter is promoted/timed out),
// automatically trigger a recovery pass to discover and enqueue the next persisted jobs.
getDocumentExtractionScheduler().onCapacityAvailable(() => {
  void recoverPersistedDocumentExtractionJobs(10, { source: "internal" });
});

/**
 * Queues a DOCUMENT_EXTRACTION job for a just-uploaded or just-imported
 * PDF/DOCX/PPTX Material and fires it, fire-and-forget — same execution
 * model (and same serverless caveat) as runTranscriptionJob/
 * runEmbeddingJob/runGoogleImportJob. Unlike audio/video transcription,
 * this is never a user-initiated action: extraction is local/free (no
 * paid API call), so there's no cost reason to gate it behind a manual
 * button the way transcription is gated.
 *
 * Safe to call unconditionally from both upload-completion paths: it
 * no-ops (returns null) for material types it doesn't handle, for
 * materials with no stored file yet, for materials that already have
 * extracted text (see shouldQueueDocumentExtraction), and if an
 * extraction job is already queued/running for this material (guards
 * against double-firing if a caller is retried).
 */
export async function queueDocumentExtractionIfNeeded(
  material: { id: string; type: Material["type"]; extractedText: string | null; storageKey: string | null },
  userId: string
): Promise<void> {
  if (!shouldQueueDocumentExtraction(material)) return;

  // Atomic "one active extraction per material" (Phase 9.4 — this used to
  // be a separate findFirst + create, which two overlapping callers, e.g.
  // a retried /complete request, could both pass).
  try {
    const { job, created } = await createJobIfNoneActive({
      userId,
      materialId: material.id,
      type: "DOCUMENT_EXTRACTION",
    });
    if (!created || !job) return;
    const { dispatchProcessingJob } = await import("@/lib/queue/dispatcher");
    void dispatchProcessingJob(job.id, "DOCUMENT_EXTRACTION", {
      inProcessRunner: runDocumentExtractionJob,
    });
    // On subsequent application activity, also attempt to recover any previously stranded queued jobs
    void recoverPersistedDocumentExtractionJobs(10, { source: "independent" });
  } catch (err) {
    // Callers fire this without awaiting it (`void queue...(...)`), so a
    // rejection here would be unhandled. The upload/import that led here
    // has already succeeded; the material stays READY and extraction can
    // be retried by re-completing/re-importing.
    console.error("[document-extraction] could not queue extraction job", {
      materialId: material.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export const DEFAULT_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = 120_000;
export const MIN_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = 5_000;

/**
 * Returns the configured active document extraction timeout in milliseconds.
 * Defaults to 120,000 ms (2 minutes). Bounded to a minimum of 5,000 ms.
 */
export function getDocumentExtractionActiveTimeoutMs(): number {
  const envVal = process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed >= MIN_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS) {
      return parsed;
    }
  }
  return DEFAULT_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS;
}

export class ExtractionActiveTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Document extraction timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = "ExtractionActiveTimeoutError";
  }
}

export class ExtractionCancelledError extends Error {
  constructor(reason?: string) {
    super(reason ?? "Document extraction was cancelled.");
    this.name = "ExtractionCancelledError";
  }
}

export type ExtractionErrorClassification = "cancelled" | "timeout" | "failure";

/**
 * Classifies an extraction error taking both the thrown exception and the AbortSignal into account.
 */
export function classifyExtractionError(
  err: unknown,
  signal?: AbortSignal | null
): ExtractionErrorClassification {
  if (err instanceof ExtractionCancelledError) {
    return "cancelled";
  }
  if (err instanceof ExtractionActiveTimeoutError) {
    return "timeout";
  }
  if (signal?.aborted) {
    if (
      signal.reason instanceof ExtractionCancelledError ||
      (signal.reason instanceof Error && signal.reason.name === "ExtractionCancelledError")
    ) {
      return "cancelled";
    }
    if (
      signal.reason instanceof ExtractionActiveTimeoutError ||
      (signal.reason instanceof Error && signal.reason.name === "ExtractionActiveTimeoutError")
    ) {
      return "timeout";
    }
  }
  if (err instanceof Error) {
    if (err.name === "ExtractionCancelledError") {
      return "cancelled";
    }
    if (err.name === "ExtractionActiveTimeoutError") {
      return "timeout";
    }
    if (err.name === "AbortError") {
      if (
        signal?.reason instanceof ExtractionCancelledError ||
        (signal?.reason instanceof Error && signal?.reason.name === "ExtractionCancelledError")
      ) {
        return "cancelled";
      }
      if (
        signal?.reason instanceof ExtractionActiveTimeoutError ||
        (signal?.reason instanceof Error && signal?.reason.name === "ExtractionActiveTimeoutError")
      ) {
        return "timeout";
      }
    }
  }
  return "failure";
}

interface ActiveExtractionContext {
  jobId: string;
  materialId: string;
  abortController: AbortController;
  timeoutTimer: NodeJS.Timeout | null;
  timedOut: boolean;
  cancelled: boolean;
  timeoutRecorded: boolean;
}

const activeExtractionsByJobId = new Map<string, ActiveExtractionContext>();
const activeJobIdByMaterialId = new Map<string, string>();

/**
 * Cancels active in-flight document extraction for the given material, if currently executing.
 */
export function cancelActiveDocumentExtractionForMaterial(materialId: string, reason?: string): boolean {
  const jobId = activeJobIdByMaterialId.get(materialId);
  if (!jobId) return false;
  return cancelActiveDocumentExtraction(jobId, reason);
}

/**
 * Cancels active in-flight document extraction for the given job ID.
 */
export function cancelActiveDocumentExtraction(jobId: string, reason?: string): boolean {
  const ctx = activeExtractionsByJobId.get(jobId);
  if (!ctx) return false;
  ctx.cancelled = true;
  if (ctx.timeoutTimer) {
    clearTimeout(ctx.timeoutTimer);
    ctx.timeoutTimer = null;
  }
  const cancellationError = new ExtractionCancelledError(reason);
  ctx.abortController.abort(cancellationError);
  return true;
}

/**
 * Returns current active extraction registry counts for testing assertions.
 */
export function _getActiveExtractionRegistrySizeForTesting(): { byJobId: number; byMaterialId: number } {
  return {
    byJobId: activeExtractionsByJobId.size,
    byMaterialId: activeJobIdByMaterialId.size,
  };
}

/**
 * Resets active extraction registry and cleans up timers for test isolation.
 */
export function _resetActiveExtractionRegistryForTesting(): void {
  for (const ctx of activeExtractionsByJobId.values()) {
    if (ctx.timeoutTimer) {
      clearTimeout(ctx.timeoutTimer);
    }
  }
  activeExtractionsByJobId.clear();
  activeJobIdByMaterialId.clear();
}

/**
 * Safely settles a job that failed during scheduler admission (queue full or queue wait timeout).
 *
 * CRITICAL RACE PROTECTION (Phase 11.3.3D.1B.2):
 * An invocation that fails before acquiring a scheduler slot was only ever QUEUED.
 * It must NEVER update a job that has already transitioned to RUNNING, CANCELLED,
 * SUCCEEDED, or FAILED.
 *
 * If a concurrent recovery pass discovered this job and a competing runner claimed it
 * into RUNNING before this timeout update executes, the strict predicate `status: "QUEUED"`
 * ensures this update touches 0 rows and does NOT clobber the active runner.
 */
async function failQueuedDocumentExtractionJob(jobId: string, err: unknown): Promise<void> {
  const fallbackMessage = "Document extraction failed because the queue was full or timed out.";
  const raw = err instanceof Error && err.message ? err.message : fallbackMessage;
  const message = raw.length > 1000 ? `${raw.slice(0, 1000)}…` : raw;

  let updatedCount = 0;
  try {
    const result = await db.processingJob.updateMany({
      where: {
        id: jobId,
        type: "DOCUMENT_EXTRACTION",
        status: "QUEUED",
      },
      data: {
        status: "FAILED",
        error: message,
        completedAt: new Date(),
      },
    });
    updatedCount = result.count;
  } catch (writeErr) {
    console.error("[document-extraction] could not record queue failure", {
      jobId,
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
    return;
  }

  // Phase 11.3.3D.1B.4: Gate failure metric strictly on a verified state transition.
  // When updatedCount === 0, the job was already claimed into RUNNING by a competing
  // runner or cancelled; emitting a failure metric would be a false positive.
  if (updatedCount > 0) {
    notifyJobStatusChange?.({
      jobId,
      type: "DOCUMENT_EXTRACTION",
      status: "FAILED",
      error: message,
    });
    void sendDatadogMetric("processing_job.failures", 1, {
      type: "count",
      tags: ["job_type:DOCUMENT_EXTRACTION"],
    });
    void sendAzureMonitorMetric("processing_job.failures", 1, {
      properties: { jobType: "DOCUMENT_EXTRACTION" },
    });
  }
}

/**
 * Safely settles a claimed RUNNING job that failed during active extraction.
 *
 * Atomically targets `status: "RUNNING"` to prevent overwriting `CANCELLED`
 * (e.g. from material or group deletion) and avoids emitting false failure metrics.
 */
async function failRunningDocumentExtractionJob(
  jobId: string,
  err: unknown,
  fallbackMessage: string
): Promise<void> {
  const raw = err instanceof Error && err.message ? err.message : fallbackMessage;
  const message = raw.length > 1000 ? `${raw.slice(0, 1000)}…` : raw;

  let updatedCount = 0;
  try {
    const result = await db.processingJob.updateMany({
      where: {
        id: jobId,
        type: "DOCUMENT_EXTRACTION",
        status: "RUNNING",
      },
      data: {
        status: "FAILED",
        error: message,
        completedAt: new Date(),
      },
    });
    updatedCount = result.count;
  } catch (writeErr) {
    console.error("[document-extraction] could not record extraction failure", {
      jobId,
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
    return;
  }

  if (updatedCount > 0) {
    notifyJobStatusChange?.({
      jobId,
      type: "DOCUMENT_EXTRACTION",
      status: "FAILED",
      error: message,
    });
    void sendDatadogMetric("processing_job.failures", 1, {
      type: "count",
      tags: ["job_type:DOCUMENT_EXTRACTION"],
    });
    void sendAzureMonitorMetric("processing_job.failures", 1, {
      properties: { jobType: "DOCUMENT_EXTRACTION" },
    });
  }
}

/**
 * Runs a single DOCUMENT_EXTRACTION job end to end:
 * 1. Wait for a process-local scheduler slot (FIFO order, bounded concurrency and queue depth).
 *    If the job is already tracked (active or waiting), exits immediately with no side effects.
 * 2. On acquiring a slot, atomically claim the database job (QUEUED → RUNNING).
 * 3. Registers in active extraction registry and arms active execution timeout.
 * 4. Real PDF/DOCX/PPTX text extraction (DocumentProcessingService) with cooperative cancellation signal.
 * 5. Save Material.extractedText (+ Material.extractedPages when the extractor
 *    returned page-level text — PDF pages, PPTX slides) → SUCCEEDED (+ kick
 *    off EMBEDDING), or FAILED with a real error message.
 * 6. Releases the scheduler slot in a finally block on every exit path after underlying
 *    storage and parser operations have settled.
 */
export async function runDocumentExtractionJob(jobId: string): Promise<void> {
  let releaseSlot: (() => void) | null = null;
  let job: ProcessingJob | null = null;
  let activeContext: ActiveExtractionContext | null = null;
  const activeTimeoutMs = getDocumentExtractionActiveTimeoutMs();

  try {
    // Step 1: Wait for a scheduler slot before touching job claim status
    try {
      const acquireResult = await getDocumentExtractionScheduler().acquire(jobId);
      if (acquireResult.status === "already_tracked") {
        // Safe duplicate dispatch:
        // An active or queued runner is already handling this job.
        // Exit immediately without claiming, failing, or releasing the slot.
        return;
      }
      releaseSlot = acquireResult.release;
    } catch (queueErr) {
      // Queue-full or queue-wait timeout error:
      // Settle the QUEUED job into a terminal failure state without changing material state.
      await failQueuedDocumentExtractionJob(jobId, queueErr);
      return;
    }

    // Step 2: After obtaining the slot, attempt atomic claimJob(jobId)
    job = await db.processingJob.findUnique({ where: { id: jobId } });
    if (!job || job.type !== "DOCUMENT_EXTRACTION" || !job.materialId) return;
    registerJobContext?.(job);
    const activeJobUserId = job.userId;
    const activeJobMaterialId = job.materialId;
    if (!(await claimJob(jobId))) return;

    // Step 3: Register in active extraction registry and arm execution timeout
    const abortController = new AbortController();
    activeContext = {
      jobId,
      materialId: job.materialId,
      abortController,
      timeoutTimer: null,
      timedOut: false,
      cancelled: false,
      timeoutRecorded: false,
    };
    activeExtractionsByJobId.set(jobId, activeContext);
    activeJobIdByMaterialId.set(job.materialId, jobId);

    const currentContext = activeContext;
    currentContext.timeoutTimer = setTimeout(async () => {
      currentContext.timedOut = true;
      currentContext.timeoutTimer = null;
      const timeoutErr = new ExtractionActiveTimeoutError(activeTimeoutMs);
      abortController.abort(timeoutErr);

      try {
        currentContext.timeoutRecorded = true;
        const result = await db.processingJob.updateMany({
          where: {
            id: jobId,
            type: "DOCUMENT_EXTRACTION",
            status: "RUNNING",
          },
          data: {
            status: "FAILED",
            error: timeoutErr.message,
            completedAt: new Date(),
          },
        });
        if (result.count > 0) {
          notifyJobStatusChange?.({
            jobId,
            userId: activeJobUserId,
            materialId: activeJobMaterialId,
            type: "DOCUMENT_EXTRACTION",
            status: "FAILED",
            error: timeoutErr.message,
          });
          void sendDatadogMetric("processing_job.failures", 1, {
            type: "count",
            tags: ["job_type:DOCUMENT_EXTRACTION"],
          });
          void sendAzureMonitorMetric("processing_job.failures", 1, {
            properties: { jobType: "DOCUMENT_EXTRACTION" },
          });
        }
      } catch (err) {
        currentContext.timeoutRecorded = false;
        console.error("[document-extraction] failed to record active timeout transition", {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, activeTimeoutMs);

    if (typeof currentContext.timeoutTimer.unref === "function") {
      currentContext.timeoutTimer.unref();
    }

    // Step 4: Verify material status before beginning extraction
    const material = await db.material.findUnique({ where: { id: job.materialId } });
    if (!material || material.deletedAt) {
      return;
    }
    if (!material.storageKey) {
      throw new Error("Material or its stored file could not be found.");
    }
    if (!DOCUMENT_EXTRACTION_TYPES.has(material.type)) {
      throw new Error(`DOCUMENT_EXTRACTION does not support material type ${material.type}.`);
    }

    if (typeof material.sizeBytes === "number" && material.sizeBytes > MAX_DOCUMENT_EXTRACTION_BYTES) {
      throw new Error(
        `This document exceeds the maximum supported file size for text extraction (${Math.round(
          material.sizeBytes / (1024 * 1024)
        )} MB; limit is ${Math.round(MAX_DOCUMENT_EXTRACTION_BYTES / (1024 * 1024))} MB). The original file remains available for viewing and download.`
      );
    }

    abortController.signal.throwIfAborted();

    const documentProcessing = getDocumentProcessingService();
    const result = await documentProcessing.extractText({
      storageKey: material.storageKey,
      mimeType: material.mimeType ?? "",
      signal: abortController.signal,
    });

    abortController.signal.throwIfAborted();
    if (currentContext.cancelled) return;
    if (currentContext.timedOut) {
      throw new ExtractionActiveTimeoutError(activeTimeoutMs);
    }

    const text = result.text.trim();
    if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
      throw new Error(
        `This document exceeds the maximum supported text length for extraction (${text.length.toLocaleString(
          "en-US"
        )} characters; limit is ${MAX_EXTRACTED_TEXT_CHARS.toLocaleString(
          "en-US"
        )} characters). The original file remains available for viewing and download.`
      );
    }
    const pages = resolveExtractedPages(result);

    if (!(await isJobActive(jobId, material.id))) return;
    if (currentContext.cancelled || currentContext.timedOut || abortController.signal.aborted) {
      return;
    }

    let completed = false;
    await db.$transaction(async (tx) => {
      if (!(await completeJobWithin(tx, jobId, material.id))) return;
      completed = true;

      await tx.material.update({
        where: { id: material.id, deletedAt: null },
        data: {
          extractedText: text.length > 0 ? text : null,
          extractedPages: pages ? (pages as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
    });

    if (text.length > 0 && completed) {
      await queueEmbeddingJob(job.userId, material.id);
    }
  } catch (err) {
    const classification = classifyExtractionError(err, activeContext?.abortController.signal);
    if (classification === "cancelled") {
      return;
    }
    if (classification === "timeout") {
      if (!activeContext?.timeoutRecorded) {
        await failRunningDocumentExtractionJob(
          jobId,
          err,
          `Document extraction timed out after ${Math.round(activeTimeoutMs / 1000)} seconds.`
        );
      }
      return;
    }
    await failRunningDocumentExtractionJob(
      jobId,
      err,
      "Document extraction failed for an unknown reason."
    );
  } finally {
    if (activeContext?.timeoutTimer) {
      clearTimeout(activeContext.timeoutTimer);
      activeContext.timeoutTimer = null;
    }
    activeExtractionsByJobId.delete(jobId);
    if (job?.materialId && activeJobIdByMaterialId.get(job.materialId) === jobId) {
      activeJobIdByMaterialId.delete(job.materialId);
    }
    if (releaseSlot) {
      releaseSlot();
      releaseSlot = null;
    }
  }
}

export const RECOVERY_INITIAL_RETRY_DELAY_MS = 2000;
export const RECOVERY_MAX_RETRIES = 5;
export const RECOVERY_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000] as const;

export type RecoveryTriggerSource = "independent" | "retry" | "internal";

export interface RecoveryOptions {
  source?: RecoveryTriggerSource;
}

let inFlightRecoveryPromise: Promise<number> | null = null;
let hasPendingRefillRequest = false;
let pendingIndependentTrigger = false;
let recoveryRetryTimeout: NodeJS.Timeout | null = null;
let consecutiveRecoveryFailures = 0;

/**
 * Discovers and dispatches persisted QUEUED document extraction jobs that are
 * not currently tracked in the local process scheduler.
 *
 * Age Threshold Explanation (Phase 11.3.3D.1B §1):
 * The 15-minute stale threshold (`staleAfterMs("DOCUMENT_EXTRACTION")`) applies
 * EXCLUSIVELY to RUNNING jobs (jobs actively claimed by a worker process that may
 * have crashed, OOM'd, or hung mid-extraction).
 * Unstarted QUEUED jobs represent legitimate pending user requests. During high-backlog
 * periods, prolonged process restarts, or extended cold periods, QUEUED jobs can wait
 * for minutes or hours without becoming invalid. Applying an age cutoff to QUEUED jobs
 * would permanently abandon valid user uploads and corrupt ingestion. Therefore,
 * the recovery query filters strictly by status = "QUEUED" without any age restriction.
 *
 * Concurrency, Coalescing, and Backlog Refill (Phase 11.3.3D.1B §4):
 * - Calls are serialized via `inFlightRecoveryPromise`. Overlapping calls coalesce into
 *   a single running query pass plus a follow-up pass if `hasPendingRefillRequest` is set.
 * - Queries are capped by available scheduler capacity (`Math.min(limit, scheduler.availableCapacity)`).
 * - If `availableCapacity <= 0`, returns immediately without querying the database.
 * - Excludes currently tracked job IDs via `id: { notIn: trackedJobIds }` to prevent
 *   head-of-line blocking when earlier queued jobs are already awaiting execution.
 * - Orders oldest-first (`createdAt: "asc"`) to maintain global FIFO processing order.
 *
 * Three-Way Trigger Classification & State Isolation (Phase 11.3.3D.1B.6):
 * - "independent": Genuine application-level recovery requests (startup hook, new document
 *   upload, Google Drive import, explicit app requests). Cancels pending backoff timers,
 *   resets the retry failure budget, and attempts immediate recovery.
 * - "retry": Automatic exponential-backoff timer callbacks. Preserves the failure counter and
 *   continues the existing bounded backoff sequence.
 * - "internal": Scheduler-driven capacity notifications and coalesced refill follow-ups.
 *   Does NOT cancel pending backoff timers, does NOT reset consecutiveRecoveryFailures, does NOT
 *   query the failing database while a retry timer is pending, and does NOT set pendingIndependentTrigger
 *   during in-flight coalescing.
 */
export async function recoverPersistedDocumentExtractionJobs(
  limit = 10,
  options?: RecoveryOptions
): Promise<number> {
  const source: RecoveryTriggerSource = options?.source ?? "independent";

  // 1. If a recovery pass is already executing, coalesce the request:
  if (inFlightRecoveryPromise) {
    hasPendingRefillRequest = true;
    // Only genuine independent triggers preserve the intent to start a fresh cycle on failure
    if (source === "independent") {
      pendingIndependentTrigger = true;
    }
    return inFlightRecoveryPromise;
  }

  // 2. Internal triggers (scheduler capacity notifications, internal follow-ups):
  // When no recovery is in flight, if a retry timer is pending or the retry budget
  // was exhausted, internal triggers must not cancel timers, must not reset failure
  // counters, and must not execute queries.
  if (source === "internal") {
    if (recoveryRetryTimeout !== null || consecutiveRecoveryFailures > RECOVERY_MAX_RETRIES) {
      return 0;
    }
  }

  // 3. Independent triggers cancel any pending backoff timer and reset the failure budget:
  if (source === "independent") {
    if (recoveryRetryTimeout) {
      clearTimeout(recoveryRetryTimeout);
      recoveryRetryTimeout = null;
    }
    consecutiveRecoveryFailures = 0;
  }

  inFlightRecoveryPromise = (async () => {
    let totalDispatched = 0;
    let querySucceeded = false;

    try {
      do {
        hasPendingRefillRequest = false;

        const scheduler = getDocumentExtractionScheduler();
        const availableCapacity = scheduler.availableCapacity;
        if (availableCapacity <= 0) {
          querySucceeded = true;
          break;
        }

        const batchLimit = Math.min(limit, availableCapacity);
        const trackedIds = scheduler.getTrackedJobIds();

        if (typeof db.processingJob?.findMany !== "function") {
          querySucceeded = true;
          break;
        }

        const pendingJobs = await db.processingJob.findMany({
          where: {
            type: "DOCUMENT_EXTRACTION",
            status: "QUEUED",
            ...(trackedIds.length > 0 ? { id: { notIn: trackedIds } } : {}),
          },
          orderBy: { createdAt: "asc" },
          take: batchLimit,
          select: { id: true },
        });

        // Query succeeded: reset failure budget and clear any scheduled retry timer
        querySucceeded = true;
        consecutiveRecoveryFailures = 0;
        if (recoveryRetryTimeout) {
          clearTimeout(recoveryRetryTimeout);
          recoveryRetryTimeout = null;
        }

        if (pendingJobs.length === 0) {
          break;
        }

        let batchDispatched = 0;
        for (const job of pendingJobs) {
          if (!scheduler.hasJob(job.id)) {
            void runDocumentExtractionJob(job.id);
            batchDispatched++;
          }
        }

        totalDispatched += batchDispatched;

        if (batchDispatched === 0) {
          break;
        }
      } while (hasPendingRefillRequest);

      return totalDispatched;
    } catch (err) {
      console.error("[document-extraction] could not recover persisted queued jobs", {
        error: err instanceof Error ? err.message : String(err),
      });

      // If a genuine independent trigger arrived while in flight, honor its intent
      // by resetting consecutiveRecoveryFailures so this failure becomes attempt 1
      if (pendingIndependentTrigger) {
        consecutiveRecoveryFailures = 0;
        pendingIndependentTrigger = false;
      }

      consecutiveRecoveryFailures++;
      if (consecutiveRecoveryFailures <= RECOVERY_MAX_RETRIES && !recoveryRetryTimeout) {
        const delay = RECOVERY_RETRY_DELAYS_MS[consecutiveRecoveryFailures - 1];
        recoveryRetryTimeout = setTimeout(() => {
          recoveryRetryTimeout = null;
          void recoverPersistedDocumentExtractionJobs(limit, { source: "retry" });
        }, delay);

        if (typeof recoveryRetryTimeout.unref === "function") {
          recoveryRetryTimeout.unref();
        }
      }

      return totalDispatched;
    } finally {
      // Only execute internal follow-up if query succeeded and a refill was requested
      if (querySucceeded && hasPendingRefillRequest) {
        hasPendingRefillRequest = false;
        queueMicrotask(() => {
          void recoverPersistedDocumentExtractionJobs(limit, { source: "internal" });
        });
      }
    }
  })().finally(() => {
    inFlightRecoveryPromise = null;
    // Phase 11.3.3D.1B.6 Part D: Guarantee pendingIndependentTrigger is consumed or cleared
    // at the recovery execution boundary so it cannot leak as stale state into subsequent passes.
    pendingIndependentTrigger = false;
  });

  return inFlightRecoveryPromise;
}

/**
 * Resets recovery serialization and retry state for test isolation.
 */
export function _resetRecoveryStateForTesting(): void {
  inFlightRecoveryPromise = null;
  hasPendingRefillRequest = false;
  pendingIndependentTrigger = false;
  consecutiveRecoveryFailures = 0;
  if (recoveryRetryTimeout) {
    clearTimeout(recoveryRetryTimeout);
    recoveryRetryTimeout = null;
  }
  _resetActiveExtractionRegistryForTesting();
}

/**
 * Returns current retry state for test assertions.
 */
export function _getRecoveryRetryStateForTesting(): {
  consecutiveFailures: number;
  isTimerScheduled: boolean;
  hasPendingRefillRequest: boolean;
  pendingIndependentTrigger: boolean;
} {
  return {
    consecutiveFailures: consecutiveRecoveryFailures,
    isTimerScheduled: recoveryRetryTimeout !== null,
    hasPendingRefillRequest,
    pendingIndependentTrigger,
  };
}
