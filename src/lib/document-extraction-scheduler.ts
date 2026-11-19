import { sendDatadogMetric } from "@/lib/observability/datadog";

/**
 * Concurrency & queue limits for document extraction.
 *
 * NOTE: The default concurrency of 1 is an intentionally conservative,
 * defensive policy to protect the shared Node.js process heap and event loop
 * from being overwhelmed by multiple concurrent extractions of large documents
 * (e.g. 50 MB PDFs/PPTXs). It is NOT claimed to be empirically benchmarked for
 * all deployment environments.
 *
 * IMPORTANT SCOPE LIMITATION:
 * This semaphore/scheduler is strictly process-local (in-memory per Node.js process).
 * It does NOT coordinate across multiple processes, containers, or serverless instances.
 * In a multi-instance deployment, each process independently enforces its own local limit.
 * Cluster-wide concurrency guarantees would require external distributed infrastructure
 * (e.g., Redis, BullMQ, or Postgres SKIP LOCKED), which is deliberately excluded.
 */
export const DEFAULT_DOCUMENT_EXTRACTION_CONCURRENCY = 1;
export const DEFAULT_DOCUMENT_EXTRACTION_MAX_QUEUE_DEPTH = 30;
export const DEFAULT_DOCUMENT_EXTRACTION_MAX_QUEUE_WAIT_MS = 5 * 60 * 1000; // 5 minutes

export class ExtractionQueueFullError extends Error {
  constructor(message = "Document extraction queue is at capacity. Please try again later.") {
    super(message);
    this.name = "ExtractionQueueFullError";
  }
}

export class ExtractionQueueTimeoutError extends Error {
  constructor(message = "Document extraction queue wait timed out. Please try again later.") {
    super(message);
    this.name = "ExtractionQueueTimeoutError";
  }
}

function parsePositiveInteger(value: string | undefined, defaultValue: number, minValue = 1): number {
  if (!value || value.trim() === "") {
    return defaultValue;
  }
  const parsed = Number(value.trim());
  if (Number.isInteger(parsed) && parsed >= minValue) {
    return parsed;
  }
  return defaultValue;
}

export function parseConcurrencyLimit(envValue: string | undefined): number {
  return parsePositiveInteger(envValue, DEFAULT_DOCUMENT_EXTRACTION_CONCURRENCY, 1);
}

export function parseMaxQueueDepth(envValue: string | undefined): number {
  return parsePositiveInteger(envValue, DEFAULT_DOCUMENT_EXTRACTION_MAX_QUEUE_DEPTH, 1);
}

export function parseMaxQueueWaitMs(envValue: string | undefined): number {
  return parsePositiveInteger(envValue, DEFAULT_DOCUMENT_EXTRACTION_MAX_QUEUE_WAIT_MS, 1000);
}

export type AcquireResult =
  | { status: "acquired"; release: () => void }
  | { status: "already_tracked" };

interface QueueWaiter {
  jobId: string;
  enqueuedAt: number;
  isSettled: () => boolean;
  grant: (releaseFn: () => void) => boolean;
  cancel: (err: Error) => boolean;
}

export class DocumentExtractionScheduler {
  readonly maxConcurrent: number;
  readonly maxQueueDepth: number;
  readonly maxQueueWaitMs: number;

  private _activeCount = 0;
  private queue: QueueWaiter[] = [];
  private queuedJobIds = new Set<string>();
  private activeJobIds = new Set<string>();
  private generation = 0;
  private capacityListeners = new Set<() => void>();
  private notificationScheduled = false;
  private isResetting = false;

  constructor(options?: {
    maxConcurrent?: number;
    maxQueueDepth?: number;
    maxQueueWaitMs?: number;
  }) {
    this.maxConcurrent =
      options?.maxConcurrent !== undefined && Number.isInteger(options.maxConcurrent) && options.maxConcurrent >= 1
        ? options.maxConcurrent
        : parseConcurrencyLimit(process.env.DOCUMENT_EXTRACTION_CONCURRENCY);

    this.maxQueueDepth =
      options?.maxQueueDepth !== undefined && Number.isInteger(options.maxQueueDepth) && options.maxQueueDepth >= 1
        ? options.maxQueueDepth
        : parseMaxQueueDepth(process.env.DOCUMENT_EXTRACTION_MAX_QUEUE_DEPTH);

    this.maxQueueWaitMs =
      options?.maxQueueWaitMs !== undefined && Number.isInteger(options.maxQueueWaitMs) && options.maxQueueWaitMs >= 1000
        ? options.maxQueueWaitMs
        : parseMaxQueueWaitMs(process.env.DOCUMENT_EXTRACTION_MAX_QUEUE_WAIT_MS);
  }

  get activeCount(): number {
    return this._activeCount;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  /**
   * Available admission capacity in the scheduler.
   * Calculated as free active slots + free waiting queue positions.
   * Guaranteed never to return a negative number.
   */
  get availableCapacity(): number {
    const freeActive = Math.max(0, this.maxConcurrent - this._activeCount);
    const freeQueued = Math.max(0, this.maxQueueDepth - this.queue.length);
    return freeActive + freeQueued;
  }

  /**
   * Returns all job IDs currently known to the scheduler (both active and queued).
   */
  getTrackedJobIds(): string[] {
    return Array.from(new Set([...this.activeJobIds, ...this.queuedJobIds]));
  }

  hasJob(jobId: string): boolean {
    return this.queuedJobIds.has(jobId) || this.activeJobIds.has(jobId);
  }

  isQueued(jobId: string): boolean {
    return this.queuedJobIds.has(jobId);
  }

  isActive(jobId: string): boolean {
    return this.activeJobIds.has(jobId);
  }

  /**
   * Subscribes a listener that will be notified whenever scheduler admission capacity opens up
   * (e.g. an active slot is released, a queued job moves to active freeing a queue position,
   * or a queued job times out/cancels freeing a queue position).
   *
   * Notifications are dispatched asynchronously via queueMicrotask to protect against
   * re-entrancy and avoid running inside locks or tight loops.
   *
   * Returns an unsubscribe function.
   */
  onCapacityAvailable(listener: () => void): () => void {
    this.capacityListeners.add(listener);
    return () => {
      this.capacityListeners.delete(listener);
    };
  }

  private notifyCapacityAvailable(): void {
    if (this.isResetting || this.capacityListeners.size === 0 || this.notificationScheduled) {
      return;
    }
    this.notificationScheduled = true;
    queueMicrotask(() => {
      this.notificationScheduled = false;
      if (this.isResetting) return;
      for (const listener of Array.from(this.capacityListeners)) {
        try {
          listener();
        } catch (err) {
          console.error("[DocumentExtractionScheduler] error in capacity listener", err);
        }
      }
    });
  }

  /**
   * Acquires an execution slot for the given job.
   *
   * Duplicate dispatch safety:
   * If the job is already tracked (either currently active or waiting in queue),
   * returns `{ status: "already_tracked" }` immediately without acquiring an additional slot,
   * without occupying an additional queue slot, and without throwing a generic error.
   *
   * If an active slot is available immediately, marks the job as active and resolves
   * with `{ status: "acquired", release: releaseFn }`.
   *
   * If all active slots are occupied, queues the job in FIFO order.
   * Rejects immediately with ExtractionQueueFullError if maxQueueDepth is exceeded.
   * Rejects with ExtractionQueueTimeoutError if maxQueueWaitMs expires while waiting.
   */
  async acquire(jobId: string): Promise<AcquireResult> {
    if (this.hasJob(jobId)) {
      return { status: "already_tracked" };
    }

    if (this._activeCount < this.maxConcurrent) {
      this._activeCount++;
      this.activeJobIds.add(jobId);

      let released = false;
      const currentGen = this.generation;
      const releaseFn = () => {
        if (released || this.generation !== currentGen) return;
        released = true;
        this.activeJobIds.delete(jobId);
        this._activeCount = Math.max(0, this._activeCount - 1);
        this.processNext();
        this.notifyCapacityAvailable();
      };

      void sendDatadogMetric("document_extraction.active_count", this._activeCount, { type: "gauge" });
      void sendDatadogMetric("document_extraction.queue_wait_ms", 0, { type: "gauge" });
      return { status: "acquired", release: releaseFn };
    }

    if (this.queue.length >= this.maxQueueDepth) {
      void sendDatadogMetric("document_extraction.queue_rejections", 1, { type: "count" });
      throw new ExtractionQueueFullError(
        `The document extraction queue is at capacity (${this.queue.length}/${this.maxQueueDepth}). Please try again shortly.`
      );
    }

    return new Promise<AcquireResult>((resolve, reject) => {
      const enqueuedAt = Date.now();
      let settled = false;
      let timeoutId: NodeJS.Timeout | null = null;

      const waiter: QueueWaiter = {
        jobId,
        enqueuedAt,
        isSettled: () => settled,
        grant: (releaseFn: () => void) => {
          if (settled) return false;
          settled = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          this.queuedJobIds.delete(jobId);
          resolve({ status: "acquired", release: releaseFn });
          return true;
        },
        cancel: (err: Error) => {
          if (settled) return false;
          settled = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          this.queuedJobIds.delete(jobId);
          reject(err);
          return true;
        },
      };

      if (this.maxQueueWaitMs > 0 && Number.isFinite(this.maxQueueWaitMs)) {
        timeoutId = setTimeout(() => {
          const idx = this.queue.indexOf(waiter);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
          void sendDatadogMetric("document_extraction.queue_timeouts", 1, { type: "count" });
          waiter.cancel(
            new ExtractionQueueTimeoutError(
              `Document extraction queue wait timed out after ${Math.round(this.maxQueueWaitMs / 1000)}s.`
            )
          );
          this.notifyCapacityAvailable();
        }, this.maxQueueWaitMs);
      }

      this.queue.push(waiter);
      this.queuedJobIds.add(jobId);
      void sendDatadogMetric("document_extraction.queued_count", this.queue.length, { type: "gauge" });
    });
  }

  private processNext(): void {
    while (this._activeCount < this.maxConcurrent && this.queue.length > 0) {
      const nextWaiter = this.queue.shift();
      if (!nextWaiter) break;
      if (nextWaiter.isSettled()) continue;

      this._activeCount++;
      this.activeJobIds.add(nextWaiter.jobId);

      let released = false;
      const currentGen = this.generation;
      const releaseFn = () => {
        if (released || this.generation !== currentGen) return;
        released = true;
        this.activeJobIds.delete(nextWaiter.jobId);
        this._activeCount = Math.max(0, this._activeCount - 1);
        this.processNext();
        this.notifyCapacityAvailable();
      };

      const granted = nextWaiter.grant(releaseFn);
      if (!granted) {
        this.activeJobIds.delete(nextWaiter.jobId);
        this._activeCount--;
        continue;
      }

      const waitMs = Math.max(0, Date.now() - nextWaiter.enqueuedAt);
      void sendDatadogMetric("document_extraction.queue_wait_ms", waitMs, { type: "gauge" });
    }

    void sendDatadogMetric("document_extraction.active_count", this._activeCount, { type: "gauge" });
    void sendDatadogMetric("document_extraction.queued_count", this.queue.length, { type: "gauge" });
  }

  /**
   * Resets internal scheduler state for isolated deterministic testing.
   */
  resetForTesting(): void {
    this.generation++;
    this.isResetting = true;
    for (const waiter of this.queue) {
      try {
        waiter.cancel(new Error("Scheduler reset for testing."));
      } catch {
        // ignore in test cleanup
      }
    }
    this.queue = [];
    this.queuedJobIds.clear();
    this.activeJobIds.clear();
    this._activeCount = 0;
    this.notificationScheduled = false;
    this.isResetting = false;
  }

  clearCapacityListenersForTesting(): void {
    this.capacityListeners.clear();
  }
}

let defaultScheduler: DocumentExtractionScheduler | null = null;

export function getDocumentExtractionScheduler(): DocumentExtractionScheduler {
  if (!defaultScheduler) {
    defaultScheduler = new DocumentExtractionScheduler();
  }
  return defaultScheduler;
}
