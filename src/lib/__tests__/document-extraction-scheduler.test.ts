import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const datadog = vi.hoisted(() => ({
  sendDatadogMetric: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/observability/datadog", () => datadog);

import {
  DocumentExtractionScheduler,
  ExtractionQueueFullError,
  ExtractionQueueTimeoutError,
  parseConcurrencyLimit,
  parseMaxQueueDepth,
  parseMaxQueueWaitMs,
  DEFAULT_DOCUMENT_EXTRACTION_CONCURRENCY,
  DEFAULT_DOCUMENT_EXTRACTION_MAX_QUEUE_DEPTH,
  DEFAULT_DOCUMENT_EXTRACTION_MAX_QUEUE_WAIT_MS,
} from "@/lib/document-extraction-scheduler";

async function acquireSlot(scheduler: DocumentExtractionScheduler, jobId: string): Promise<() => void> {
  const result = await scheduler.acquire(jobId);
  if (result.status !== "acquired") {
    throw new Error(`Expected status 'acquired' for ${jobId}, but received '${result.status}'`);
  }
  return result.release;
}

describe("DocumentExtractionScheduler (Phase 11.3.3D.1 & 11.3.3D.1B)", () => {
  let scheduler: DocumentExtractionScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    scheduler = new DocumentExtractionScheduler({
      maxConcurrent: 1,
      maxQueueDepth: 5,
      maxQueueWaitMs: 10_000,
    });
  });

  afterEach(() => {
    scheduler.resetForTesting();
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. Configuration & Validation Tests
  // =========================================================================
  describe("Configuration & Environment Parsing", () => {
    it("uses default values when no options or environment variables are provided", () => {
      expect(DEFAULT_DOCUMENT_EXTRACTION_CONCURRENCY).toBe(1);
      expect(DEFAULT_DOCUMENT_EXTRACTION_MAX_QUEUE_DEPTH).toBe(30);
      expect(DEFAULT_DOCUMENT_EXTRACTION_MAX_QUEUE_WAIT_MS).toBe(300_000);

      const defaultSched = new DocumentExtractionScheduler();
      expect(defaultSched.maxConcurrent).toBe(1);
      expect(defaultSched.maxQueueDepth).toBe(30);
      expect(defaultSched.maxQueueWaitMs).toBe(300_000);
      expect(defaultSched.availableCapacity).toBe(31);
    });

    it("parses valid positive integer concurrency limits strictly", () => {
      expect(parseConcurrencyLimit("1")).toBe(1);
      expect(parseConcurrencyLimit("2")).toBe(2);
      expect(parseConcurrencyLimit(" 4 ")).toBe(4);
    });

    it("falls back to default concurrency of 1 for invalid, zero, negative, or non-integer inputs", () => {
      expect(parseConcurrencyLimit(undefined)).toBe(1);
      expect(parseConcurrencyLimit("")).toBe(1);
      expect(parseConcurrencyLimit("0")).toBe(1);
      expect(parseConcurrencyLimit("-3")).toBe(1);
      expect(parseConcurrencyLimit("1.5")).toBe(1);
      expect(parseConcurrencyLimit("abc")).toBe(1);
      expect(parseConcurrencyLimit("NaN")).toBe(1);
      expect(parseConcurrencyLimit("Infinity")).toBe(1);
    });

    it("parses and validates queue depth and queue wait limits", () => {
      expect(parseMaxQueueDepth("10")).toBe(10);
      expect(parseMaxQueueDepth("-5")).toBe(30);
      expect(parseMaxQueueDepth("invalid")).toBe(30);

      expect(parseMaxQueueWaitMs("60000")).toBe(60_000);
      expect(parseMaxQueueWaitMs("500")).toBe(300_000); // under 1000ms minimum -> fallback
      expect(parseMaxQueueWaitMs("not-a-number")).toBe(300_000);
    });
  });

  // =========================================================================
  // 2. Concurrency & Queue Mechanics
  // =========================================================================
  describe("Concurrency & FIFO Queueing", () => {
    it("allows only one active extraction at a time under default configuration", async () => {
      const release1 = await acquireSlot(scheduler, "job-1");
      expect(scheduler.activeCount).toBe(1);
      expect(scheduler.queuedCount).toBe(0);
      expect(scheduler.isActive("job-1")).toBe(true);

      let job2Acquired = false;
      const job2Promise = acquireSlot(scheduler, "job-2").then((rel) => {
        job2Acquired = true;
        return rel;
      });

      // job-2 must be queued and NOT active
      expect(scheduler.activeCount).toBe(1);
      expect(scheduler.queuedCount).toBe(1);
      expect(scheduler.isQueued("job-2")).toBe(true);
      expect(job2Acquired).toBe(false);

      // Releasing job-1 grants the slot to job-2
      release1();
      const release2 = await job2Promise;

      expect(job2Acquired).toBe(true);
      expect(scheduler.activeCount).toBe(1);
      expect(scheduler.queuedCount).toBe(0);
      expect(scheduler.isActive("job-2")).toBe(true);

      release2();
      expect(scheduler.activeCount).toBe(0);
    });

    it("maintains strict FIFO ordering when multiple jobs wait in the queue", async () => {
      const executionOrder: string[] = [];

      const release1 = await acquireSlot(scheduler, "job-1");

      const p2 = acquireSlot(scheduler, "job-2").then((rel) => {
        executionOrder.push("job-2");
        return rel;
      });
      const p3 = acquireSlot(scheduler, "job-3").then((rel) => {
        executionOrder.push("job-3");
        return rel;
      });
      const p4 = acquireSlot(scheduler, "job-4").then((rel) => {
        executionOrder.push("job-4");
        return rel;
      });

      expect(scheduler.queuedCount).toBe(3);

      // Release job-1 -> job-2 acquires
      release1();
      const rel2 = await p2;
      expect(executionOrder).toEqual(["job-2"]);

      // Release job-2 -> job-3 acquires
      rel2();
      const rel3 = await p3;
      expect(executionOrder).toEqual(["job-2", "job-3"]);

      // Release job-3 -> job-4 acquires
      rel3();
      const rel4 = await p4;
      expect(executionOrder).toEqual(["job-2", "job-3", "job-4"]);

      rel4();
      expect(scheduler.activeCount).toBe(0);
      expect(scheduler.queuedCount).toBe(0);
    });

    it("makes slot available immediately after release", async () => {
      const release1 = await acquireSlot(scheduler, "job-1");
      expect(scheduler.activeCount).toBe(1);

      release1();
      expect(scheduler.activeCount).toBe(0);

      // Fresh job acquires immediately without queueing
      const release2 = await acquireSlot(scheduler, "job-2");
      expect(scheduler.activeCount).toBe(1);
      expect(scheduler.queuedCount).toBe(0);

      release2();
      expect(scheduler.activeCount).toBe(0);
    });

    it("enforces exactly-once slot release without double-decrementing activeCount", async () => {
      const release = await acquireSlot(scheduler, "job-1");
      expect(scheduler.activeCount).toBe(1);

      release();
      expect(scheduler.activeCount).toBe(0);

      // Duplicate release calls should be idempotent no-ops
      release();
      release();
      expect(scheduler.activeCount).toBe(0);
    });
  });

  // =========================================================================
  // 3. Duplicate Dispatch Handling (Phase 11.3.3D.1B §3)
  // =========================================================================
  describe("Duplicate Dispatch Handling", () => {
    it("returns { status: 'already_tracked' } when acquiring an already active job", async () => {
      const release1 = await acquireSlot(scheduler, "job-1");
      expect(scheduler.isActive("job-1")).toBe(true);

      const duplicateResult = await scheduler.acquire("job-1");
      expect(duplicateResult).toEqual({ status: "already_tracked" });

      // Does not increment active count or queue count
      expect(scheduler.activeCount).toBe(1);
      expect(scheduler.queuedCount).toBe(0);

      release1();
      expect(scheduler.activeCount).toBe(0);
    });

    it("returns { status: 'already_tracked' } when acquiring an already queued job", async () => {
      const release1 = await acquireSlot(scheduler, "job-1");

      const p2 = scheduler.acquire("job-2");
      expect(scheduler.isQueued("job-2")).toBe(true);

      // Duplicate acquire of queued job must not throw, must return already_tracked
      const duplicateResult = await scheduler.acquire("job-2");
      expect(duplicateResult).toEqual({ status: "already_tracked" });

      // Queue depth remains unchanged
      expect(scheduler.queuedCount).toBe(1);

      release1();
      const res2 = await p2;
      expect(res2.status).toBe("acquired");
      if (res2.status === "acquired") {
        res2.release();
      }
    });
  });

  // =========================================================================
  // 4. Capacity & Tracking APIs (Phase 11.3.3D.1B §2)
  // =========================================================================
  describe("Capacity & Tracking APIs", () => {
    it("getTrackedJobIds reflects all currently active and queued jobs", async () => {
      expect(scheduler.getTrackedJobIds()).toEqual([]);

      const release1 = await acquireSlot(scheduler, "job-active");
      expect(scheduler.getTrackedJobIds()).toEqual(["job-active"]);

      const p2 = scheduler.acquire("job-wait-1");
      const p3 = scheduler.acquire("job-wait-2");
      expect(scheduler.getTrackedJobIds()).toEqual(
        expect.arrayContaining(["job-active", "job-wait-1", "job-wait-2"])
      );
      expect(scheduler.getTrackedJobIds().length).toBe(3);

      release1();
      const res2 = await p2;
      expect(scheduler.getTrackedJobIds()).toEqual(
        expect.arrayContaining(["job-wait-1", "job-wait-2"])
      );
      expect(scheduler.getTrackedJobIds().length).toBe(2);

      if (res2.status === "acquired") res2.release();
      const res3 = await p3;
      if (res3.status === "acquired") res3.release();

      expect(scheduler.getTrackedJobIds()).toEqual([]);
    });

    it("availableCapacity accurately calculates free active + free queue slots and never returns negative", async () => {
      // Config: maxConcurrent: 1, maxQueueDepth: 5 -> total initial = 6
      expect(scheduler.availableCapacity).toBe(6);

      const release1 = await acquireSlot(scheduler, "job-1");
      // 0 free active, 5 free queued -> 5
      expect(scheduler.availableCapacity).toBe(5);

      const p2 = scheduler.acquire("job-2");
      expect(scheduler.availableCapacity).toBe(4);

      const p3 = scheduler.acquire("job-3");
      const p4 = scheduler.acquire("job-4");
      const p5 = scheduler.acquire("job-5");
      const p6 = scheduler.acquire("job-6");
      // 0 free active, 0 free queued -> 0
      expect(scheduler.availableCapacity).toBe(0);

      // Releasing an active slot promotes p2, freeing a queue position -> capacity becomes 1
      release1();
      expect(scheduler.availableCapacity).toBe(1);

      const res2 = await p2;
      if (res2.status === "acquired") res2.release();
      const res3 = await p3;
      if (res3.status === "acquired") res3.release();
      const res4 = await p4;
      if (res4.status === "acquired") res4.release();
      const res5 = await p5;
      if (res5.status === "acquired") res5.release();
      const res6 = await p6;
      if (res6.status === "acquired") res6.release();

      expect(scheduler.availableCapacity).toBe(6);
    });

    it("onCapacityAvailable fires when an active slot is released with no waiters", async () => {
      const listener = vi.fn();
      const unsubscribe = scheduler.onCapacityAvailable(listener);

      const release1 = await acquireSlot(scheduler, "job-1");
      expect(listener).not.toHaveBeenCalled();

      release1();
      // Notification is queued via queueMicrotask
      await Promise.resolve();

      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      const release2 = await acquireSlot(scheduler, "job-2");
      release2();
      await Promise.resolve();

      // Should not be called after unsubscribe
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("onCapacityAvailable fires when an active slot is released and waiter promoted to active", async () => {
      const listener = vi.fn();
      scheduler.onCapacityAvailable(listener);

      const release1 = await acquireSlot(scheduler, "job-1");
      const p2 = scheduler.acquire("job-2");

      release1();
      await Promise.resolve();

      // Waiter promoted -> queue position freed -> listener invoked
      expect(listener).toHaveBeenCalledTimes(1);

      const res2 = await p2;
      if (res2.status === "acquired") res2.release();
    });

    it("onCapacityAvailable fires when a queued waiter times out", async () => {
      const listener = vi.fn();
      scheduler.onCapacityAvailable(listener);

      const release1 = await acquireSlot(scheduler, "job-1");
      const p2 = scheduler.acquire("job-2");

      expect(listener).not.toHaveBeenCalled();

      // Fast-forward past timeout
      vi.advanceTimersByTime(10_001);
      await expect(p2).rejects.toThrow(ExtractionQueueTimeoutError);

      await Promise.resolve();
      // Timeout freed a queue position -> listener invoked
      expect(listener).toHaveBeenCalledTimes(1);

      release1();
    });

    it("isolates throwing capacity listeners so other listeners execute and slot release is uncorrupted", async () => {
      const throwingListener = vi.fn().mockImplementation(() => {
        throw new Error("Simulated listener failure");
      });
      const successfulListener = vi.fn();

      scheduler.onCapacityAvailable(throwingListener);
      scheduler.onCapacityAvailable(successfulListener);

      const release1 = await acquireSlot(scheduler, "job-1");
      expect(scheduler.activeCount).toBe(1);

      // Releasing slot must not throw even if a listener throws in microtask
      expect(() => release1()).not.toThrow();

      // Active count must be decremented synchronously
      expect(scheduler.activeCount).toBe(0);

      // Await the microtask turn
      await Promise.resolve();

      // Throwing listener ran
      expect(throwingListener).toHaveBeenCalledTimes(1);
      // Second listener still ran!
      expect(successfulListener).toHaveBeenCalledTimes(1);

      // Verify scheduler bookkeeping remains consistent
      expect(scheduler.activeCount).toBe(0);
      expect(scheduler.queuedCount).toBe(0);
      expect(scheduler.availableCapacity).toBe(6);

      // Verify scheduler can admit another job afterward
      const release2 = await acquireSlot(scheduler, "job-2");
      expect(scheduler.activeCount).toBe(1);
      expect(scheduler.isActive("job-2")).toBe(true);

      release2();
      expect(scheduler.activeCount).toBe(0);
    });
  });

  // =========================================================================
  // 5. Queue Depth & Timeout Boundaries
  // =========================================================================
  describe("Queue Depth & Timeout Boundaries", () => {
    it("rejects immediately with ExtractionQueueFullError when queue capacity is reached", async () => {
      const customSched = new DocumentExtractionScheduler({ maxConcurrent: 1, maxQueueDepth: 2 });

      const release1 = await acquireSlot(customSched, "job-1");
      const p2 = customSched.acquire("job-2"); // queue: 1
      const p3 = customSched.acquire("job-3"); // queue: 2 (at capacity)

      expect(customSched.queuedCount).toBe(2);

      // 4th job must be rejected immediately
      await expect(customSched.acquire("job-4")).rejects.toThrow(ExtractionQueueFullError);
      await expect(customSched.acquire("job-4")).rejects.toThrow(
        /The document extraction queue is at capacity \(2\/2\)\. Please try again shortly\./
      );

      // Existing queued jobs remain intact
      expect(customSched.queuedCount).toBe(2);

      release1();
      const res2 = await p2;
      if (res2.status === "acquired") res2.release();
      const res3 = await p3;
      if (res3.status === "acquired") res3.release();
    });

    it("rejects waiting jobs with ExtractionQueueTimeoutError after queue wait expires", async () => {
      const release1 = await acquireSlot(scheduler, "job-1");

      const p2 = scheduler.acquire("job-2");
      expect(scheduler.queuedCount).toBe(1);

      // Advance time past 10s wait limit
      vi.advanceTimersByTime(10_001);

      await expect(p2).rejects.toThrow(ExtractionQueueTimeoutError);
      await expect(p2).rejects.toThrow(/Document extraction queue wait timed out after 10s\./);
      expect(scheduler.queuedCount).toBe(0);

      release1();
      expect(scheduler.activeCount).toBe(0);
    });

    it("prevents late acquisition: expired waiter does not acquire a slot upon subsequent release", async () => {
      const release1 = await acquireSlot(scheduler, "job-1");

      let job2Resolved = false;
      let job2Rejected = false;
      const p2 = scheduler.acquire("job-2").then(
        () => {
          job2Resolved = true;
        },
        (err) => {
          job2Rejected = true;
          throw err;
        }
      );

      // Advance timer to trigger expiration
      vi.advanceTimersByTime(10_001);
      await expect(p2).rejects.toThrow(ExtractionQueueTimeoutError);
      expect(job2Rejected).toBe(true);
      expect(job2Resolved).toBe(false);

      // Now enqueue job-3
      let job3Resolved = false;
      const p3 = acquireSlot(scheduler, "job-3").then((rel) => {
        job3Resolved = true;
        return rel;
      });

      // Releasing job-1 must grant slot to job-3, NOT job-2
      release1();
      const release3 = await p3;

      expect(job2Resolved).toBe(false);
      expect(job3Resolved).toBe(true);
      expect(scheduler.activeCount).toBe(1);
      expect(scheduler.isActive("job-3")).toBe(true);

      release3();
      expect(scheduler.activeCount).toBe(0);
    });

    it("clears waiter timeout when slot is granted before expiration", async () => {
      const release1 = await acquireSlot(scheduler, "job-1");
      const p2 = acquireSlot(scheduler, "job-2");

      // Advance time to 5s (half of 10s limit)
      vi.advanceTimersByTime(5_000);

      // Release job-1 so job-2 acquires
      release1();
      const release2 = await p2;
      expect(scheduler.isActive("job-2")).toBe(true);

      // Advance time past the original 10s mark — job-2 must not be cancelled
      vi.advanceTimersByTime(6_000);
      expect(scheduler.isActive("job-2")).toBe(true);

      release2();
      expect(scheduler.activeCount).toBe(0);
    });
  });

  // =========================================================================
  // 6. Observability & Metrics
  // =========================================================================
  describe("Observability Instrumentation", () => {
    it("reports active count, queue count, and queue wait metrics via sendDatadogMetric", async () => {
      const release1 = await acquireSlot(scheduler, "job-1");

      expect(datadog.sendDatadogMetric).toHaveBeenCalledWith("document_extraction.active_count", 1, { type: "gauge" });
      expect(datadog.sendDatadogMetric).toHaveBeenCalledWith("document_extraction.queue_wait_ms", 0, { type: "gauge" });

      const p2 = acquireSlot(scheduler, "job-2");
      expect(datadog.sendDatadogMetric).toHaveBeenCalledWith("document_extraction.queued_count", 1, { type: "gauge" });

      vi.advanceTimersByTime(2_000);
      release1();
      const release2 = await p2;

      expect(datadog.sendDatadogMetric).toHaveBeenCalledWith("document_extraction.queue_wait_ms", 2000, {
        type: "gauge",
      });

      release2();
      expect(datadog.sendDatadogMetric).toHaveBeenCalledWith("document_extraction.active_count", 0, { type: "gauge" });
    });
  });
});
