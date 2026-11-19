import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveExtractedPages, shouldQueueDocumentExtraction } from "@/lib/document-extraction-guard";

const tx = vi.hoisted(() => ({
  processingJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  material: { update: vi.fn().mockResolvedValue({ id: "mat-1" }) },
}));
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  processingJob: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  material: { findUnique: vi.fn() },
}));
const datadog = vi.hoisted(() => ({
  sendDatadogMetric: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/observability/datadog", () => datadog);

const queue = vi.hoisted(() => ({ queueEmbeddingJob: vi.fn() }));
vi.mock("@/lib/ingestion", () => queue);

const docProc = vi.hoisted(() => ({ extractText: vi.fn() }));
vi.mock("@/lib/services/document-processing", () => ({
  getDocumentProcessingService: () => docProc,
}));

import {
  runDocumentExtractionJob,
  recoverPersistedDocumentExtractionJobs,
  _resetRecoveryStateForTesting,
  _getRecoveryRetryStateForTesting,
  RECOVERY_INITIAL_RETRY_DELAY_MS,
  RECOVERY_MAX_RETRIES,
  RECOVERY_RETRY_DELAYS_MS,
  MAX_DOCUMENT_EXTRACTION_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
  DEFAULT_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS,
  MIN_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS,
  getDocumentExtractionActiveTimeoutMs,
  ExtractionActiveTimeoutError,
  ExtractionCancelledError,
  classifyExtractionError,
  cancelActiveDocumentExtractionForMaterial,
  cancelActiveDocumentExtraction,
  _getActiveExtractionRegistrySizeForTesting,
  _resetActiveExtractionRegistryForTesting,
} from "@/lib/document-extraction";
import {
  getDocumentExtractionScheduler,
  ExtractionQueueFullError,
  ExtractionQueueTimeoutError,
} from "@/lib/document-extraction-scheduler";

/**
 * shouldQueueDocumentExtraction is the pure, DB-free decision function
 * both trigger sites (upload complete route, Google import job) defer
 * to via document-extraction.ts — see document-extraction-guard.ts for
 * why it lives in its own module (imports nothing but a Prisma *type*,
 * never the Prisma client itself) and is directly testable without a
 * database connection, matching this project's convention for pure-
 * function extraction (e.g. canManageInvitation, parseRangeHeader).
 */
describe("shouldQueueDocumentExtraction", () => {
  it("queues extraction for a fresh PDF with no extracted text yet", () => {
    expect(
      shouldQueueDocumentExtraction({ type: "PDF", extractedText: null, storageKey: "materials/u/m.pdf" })
    ).toBe(true);
  });

  it("queues extraction for a fresh DOCX and PPTX with no extracted text yet", () => {
    expect(
      shouldQueueDocumentExtraction({ type: "DOCX", extractedText: null, storageKey: "materials/u/m.docx" })
    ).toBe(true);
    expect(
      shouldQueueDocumentExtraction({ type: "PPTX", extractedText: null, storageKey: "materials/u/m.pptx" })
    ).toBe(true);
  });

  it("does not queue extraction for material types this pipeline doesn't handle", () => {
    for (const type of ["AUDIO", "VIDEO", "IMAGE", "TEXT", "GOOGLE_DOC", "GOOGLE_DRIVE_FILE", "LINK"] as const) {
      expect(
        shouldQueueDocumentExtraction({ type, extractedText: null, storageKey: "materials/u/m.bin" })
      ).toBe(false);
    }
  });

  it("is idempotent: skips a PDF that already has non-empty extracted text", () => {
    expect(
      shouldQueueDocumentExtraction({
        type: "PDF",
        extractedText: "Some previously extracted text.",
        storageKey: "materials/u/m.pdf",
      })
    ).toBe(false);
  });

  it("treats whitespace-only extractedText as 'not yet extracted' and queues it", () => {
    expect(
      shouldQueueDocumentExtraction({ type: "PDF", extractedText: "   \n\t  ", storageKey: "materials/u/m.pdf" })
    ).toBe(true);
  });

  it("re-queues extraction once extractedText has been reset to null (Google Drive force re-import)", () => {
    expect(
      shouldQueueDocumentExtraction({ type: "PDF", extractedText: null, storageKey: "materials/u/m.pdf" })
    ).toBe(true);
  });

  it("does not queue extraction when there is no stored file yet", () => {
    expect(shouldQueueDocumentExtraction({ type: "PDF", extractedText: null, storageKey: null })).toBe(false);
  });
});

/**
 * resolveExtractedPages is the pure, DB-free transformation
 * runDocumentExtractionJob defers to (document-extraction.ts) when
 * deciding what to persist to Material.extractedPages — see that file's
 * doc comment for why an empty/absent `pages` result must become `null`
 * rather than an empty array (spec §92: never fabricate).
 */
describe("resolveExtractedPages", () => {
  it("returns the pages array when the extractor produced page-level text", () => {
    const pages = [
      { pageNumber: 1, text: "Thermodynamics is..." },
      { pageNumber: 2, text: "The zeroth law..." },
    ];
    expect(resolveExtractedPages({ text: "irrelevant", pages })).toEqual(pages);
  });

  it("returns null when the extractor's result has no `pages` field at all (e.g. DOCX)", () => {
    expect(resolveExtractedPages({ text: "irrelevant" })).toBeNull();
  });

  it("returns null rather than an empty array when `pages` is present but empty", () => {
    expect(resolveExtractedPages({ text: "irrelevant", pages: [] })).toBeNull();
  });
});

describe("runDocumentExtractionJob — Boundaries, Scheduler & Lifecycle", () => {
  const baseJob = {
    id: "job-extract-1",
    type: "DOCUMENT_EXTRACTION",
    materialId: "mat-1",
    userId: "user-1",
    status: "QUEUED",
  };

  const baseMaterial = {
    id: "mat-1",
    type: "PDF" as const,
    storageKey: "materials/user-1/mat-1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    status: "READY",
    extractedText: null,
    deletedAt: null,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    getDocumentExtractionScheduler().resetForTesting();
    _resetRecoveryStateForTesting();
    datadog.sendDatadogMetric.mockClear();
    tx.processingJob.updateMany.mockResolvedValue({ count: 1 });
    tx.material.update.mockResolvedValue({ id: "mat-1" });
    db.processingJob.findUnique.mockResolvedValue(baseJob);
    db.processingJob.updateMany.mockResolvedValue({ count: 1 });
    db.processingJob.findMany.mockResolvedValue([]);
    db.material.findUnique.mockResolvedValue(baseMaterial);
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    queue.queueEmbeddingJob.mockResolvedValue(undefined);
  });

  it("fails the job and refuses extraction before buffering when material.sizeBytes exceeds 50 MB", async () => {
    db.material.findUnique.mockResolvedValue({
      ...baseMaterial,
      sizeBytes: 55 * 1024 * 1024, // 55 MB (> 50 MB)
    });

    await runDocumentExtractionJob("job-extract-1");

    expect(docProc.extractText).not.toHaveBeenCalled();
    expect(db.processingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-extract-1" }),
        data: expect.objectContaining({
          status: "FAILED",
          error: expect.stringMatching(
            /This document exceeds the maximum supported file size for text extraction \(55 MB; limit is 50 MB\)\. The original file remains available for viewing and download\./
          ),
        }),
      })
    );
    expect(tx.material.update).not.toHaveBeenCalled();
    expect(queue.queueEmbeddingJob).not.toHaveBeenCalled();
    expect(getDocumentExtractionScheduler().activeCount).toBe(0);
  });


  it("atomically fails the job and releases slot on actual cumulative WorkBudget exhaustion through live extraction", async () => {
    const path = await import("path");
    const { LocalDocumentProcessingService, _setTestingWorkBudgetLimit } = await import(
      "@/lib/services/document-processing-local"
    );
    const storageModule = await import("@/lib/services/storage");
    const { LocalStorageService } = await import("@/lib/services/storage-local");

    const fixturesDir = path.resolve(__dirname, "../../lib/services/__tests__/fixtures");
    const localStorage = new LocalStorageService(fixturesDir);
    vi.spyOn(storageModule, "getStorageService").mockReturnValue(localStorage);

    db.material.findUnique.mockResolvedValue({
      ...baseMaterial,
      storageKey: "two-column-symmetric.pdf",
    });

    // Run real LocalDocumentProcessingService through the live extraction path
    const realService = new LocalDocumentProcessingService();
    docProc.extractText.mockImplementation(async (opts) => {
      return await realService.extractText(opts);
    });

    // Set tight testing budget limit so cumulative work accumulation causes real exhaustion
    _setTestingWorkBudgetLimit(10);

    try {
      await runDocumentExtractionJob("job-extract-1");

      // Verify the extraction job reaches FAILED with real budget exhaustion error message
      expect(docProc.extractText).toHaveBeenCalled();
      expect(db.processingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "job-extract-1" }),
          data: expect.objectContaining({
            status: "FAILED",
            error: expect.stringMatching(/Synchronous page processing budget exceeded/i),
          }),
        })
      );

      // Verify Material.extractedText remains unchanged (tx.material.update not called)
      expect(tx.material.update).not.toHaveBeenCalled();

      // Verify no embedding job is queued
      expect(queue.queueEmbeddingJob).not.toHaveBeenCalled();

      // Verify scheduler slot is released
      expect(getDocumentExtractionScheduler().activeCount).toBe(0);

      // Verify active extraction registry entries are removed
      expect(_getActiveExtractionRegistrySizeForTesting()).toEqual({ byJobId: 0, byMaterialId: 0 });

      // Verify Datadog error metrics are emitted
      expect(datadog.sendDatadogMetric).toHaveBeenCalledWith(
        "processing_job.failures",
        1,
        expect.objectContaining({
          type: "count",
          tags: expect.arrayContaining(["job_type:DOCUMENT_EXTRACTION"]),
        })
      );
    } finally {
      _setTestingWorkBudgetLimit(null);
    }
  });

  it("fails the job and refuses persistence when extracted text exceeds 500,000 characters", async () => {
    docProc.extractText.mockResolvedValue({
      text: "Z".repeat(MAX_EXTRACTED_TEXT_CHARS + 100),
      pages: [{ pageNumber: 1, text: "Z".repeat(MAX_EXTRACTED_TEXT_CHARS + 100) }],
    });

    await runDocumentExtractionJob("job-extract-1");

    expect(docProc.extractText).toHaveBeenCalled();
    expect(db.processingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-extract-1" }),
        data: expect.objectContaining({
          status: "FAILED",
          error: expect.stringMatching(
            /This document exceeds the maximum supported text length for extraction \(\d[\d,]* characters; limit is 500,000 characters\)\. The original file remains available for viewing and download\./
          ),
        }),
      })
    );
    expect(tx.material.update).not.toHaveBeenCalled();
    expect(queue.queueEmbeddingJob).not.toHaveBeenCalled();
    expect(getDocumentExtractionScheduler().activeCount).toBe(0);
  });


  it("successfully commits extracted text and triggers embedding for valid documents within boundaries", async () => {
    docProc.extractText.mockResolvedValue({
      text: "Valid extracted lecture text.",
      pages: [{ pageNumber: 1, text: "Valid extracted lecture text." }],
    });

    await runDocumentExtractionJob("job-extract-1");

    expect(docProc.extractText).toHaveBeenCalled();
    expect(tx.material.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-1", deletedAt: null },
        data: expect.objectContaining({
          extractedText: "Valid extracted lecture text.",
        }),
      })
    );
    expect(queue.queueEmbeddingJob).toHaveBeenCalledWith("user-1", "mat-1");
    expect(getDocumentExtractionScheduler().activeCount).toBe(0);
  });

  it("exports MAX_DOCUMENT_EXTRACTION_BYTES and MAX_EXTRACTED_TEXT_CHARS", () => {
    expect(MAX_DOCUMENT_EXTRACTION_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_EXTRACTED_TEXT_CHARS).toBe(500_000);
  });

  // =========================================================================
  // Scheduler Integration & Lifecycle Tests (Phase 11.3.3D.1)
  // =========================================================================
  describe("Scheduler slot lifecycle and claimJob integration", () => {
    it("releases scheduler slot when claimJob fails (job reaped, cancelled, or already running)", async () => {
      // claimJob returns false (count: 0)
      db.processingJob.updateMany.mockResolvedValueOnce({ count: 0 });

      const scheduler = getDocumentExtractionScheduler();
      expect(scheduler.activeCount).toBe(0);

      await runDocumentExtractionJob("job-extract-1");

      // Extraction must never run
      expect(docProc.extractText).not.toHaveBeenCalled();
      // Scheduler slot must be released immediately
      expect(scheduler.activeCount).toBe(0);
    });

    it("releases scheduler slot when extraction throws an error", async () => {
      docProc.extractText.mockRejectedValue(new Error("Corrupted archive stream"));

      const scheduler = getDocumentExtractionScheduler();
      await runDocumentExtractionJob("job-extract-1");

      expect(db.processingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-extract-1", type: "DOCUMENT_EXTRACTION", status: "RUNNING" },
          data: expect.objectContaining({
            status: "FAILED",
            error: expect.stringContaining("Corrupted archive stream"),
          }),
        })
      );
      expect(scheduler.activeCount).toBe(0);
    });

    it("settles QUEUED job into FAILED when scheduler rejects with ExtractionQueueFullError", async () => {
      const scheduler = getDocumentExtractionScheduler();
      vi.spyOn(scheduler, "acquire").mockRejectedValueOnce(
        new ExtractionQueueFullError("The document extraction queue is at capacity.")
      );

      await runDocumentExtractionJob("job-extract-1");

      expect(db.processingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-extract-1", type: "DOCUMENT_EXTRACTION", status: "QUEUED" },
          data: expect.objectContaining({
            status: "FAILED",
            error: expect.stringContaining("The document extraction queue is at capacity."),
          }),
        })
      );
      // Material state is untouched
      expect(tx.material.update).not.toHaveBeenCalled();
      expect(queue.queueEmbeddingJob).not.toHaveBeenCalled();
    });

    it("settles QUEUED job into FAILED when scheduler rejects with ExtractionQueueTimeoutError", async () => {
      const scheduler = getDocumentExtractionScheduler();
      vi.spyOn(scheduler, "acquire").mockRejectedValueOnce(
        new ExtractionQueueTimeoutError("Document extraction queue wait timed out after 300s.")
      );

      await runDocumentExtractionJob("job-extract-1");

      expect(db.processingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-extract-1", type: "DOCUMENT_EXTRACTION", status: "QUEUED" },
          data: expect.objectContaining({
            status: "FAILED",
            error: expect.stringContaining("Document extraction queue wait timed out after 300s."),
          }),
        })
      );
      expect(tx.material.update).not.toHaveBeenCalled();
      expect(queue.queueEmbeddingJob).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Duplicate Dispatch Safety (Phase 11.3.3D.1B §3 & §5)
  // =========================================================================
  describe("Duplicate Dispatch Safety", () => {
    it("exits duplicate invocation immediately without calling claimJob, failJob, or releasing the slot", async () => {
      docProc.extractText.mockResolvedValue({
        text: "Extracted exactly once.",
        pages: [{ pageNumber: 1, text: "Extracted exactly once." }],
      });

      // Run two invocations concurrently for the exact same job ID
      const [run1, run2] = [
        runDocumentExtractionJob("job-shared-1"),
        runDocumentExtractionJob("job-shared-1"),
      ];

      await Promise.all([run1, run2]);

      // Extraction ran exactly once
      expect(docProc.extractText).toHaveBeenCalledTimes(1);

      // failJob was never called
      const failCalls = db.processingJob.updateMany.mock.calls.filter(
        (call: unknown[]) => {
          const arg = call[0] as { data?: { status?: string } };
          return arg?.data?.status === "FAILED";
        }
      );
      expect(failCalls).toHaveLength(0);

      // Scheduler active count is clean
      expect(getDocumentExtractionScheduler().activeCount).toBe(0);
    });

    it("does not overwrite terminal CANCELLED job when queue timeout occurs", async () => {
      const scheduler = getDocumentExtractionScheduler();
      vi.spyOn(scheduler, "acquire").mockRejectedValueOnce(
        new ExtractionQueueTimeoutError("Document extraction queue wait timed out.")
      );

      // In the database, the job was cancelled while waiting in queue
      // (updateMany with status: "QUEUED" returns count: 0)
      db.processingJob.updateMany.mockResolvedValueOnce({ count: 0 });

      await runDocumentExtractionJob("job-cancelled-1");

      expect(db.processingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-cancelled-1", type: "DOCUMENT_EXTRACTION", status: "QUEUED" },
          data: expect.objectContaining({ status: "FAILED" }),
        })
      );
      // count: 0 indicates no row updated, preserving CANCELLED state
    });

    it("queue timeout settlement strictly updates QUEUED jobs and never overwrites a newly claimed RUNNING job", async () => {
      const jobAId = "job-race-timeout-1";
      const jobStates = new Map<string, "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED">();
      jobStates.set(jobAId, "QUEUED");

      const scheduler = getDocumentExtractionScheduler();

      // Occupy the active slot with a blocker so Job A is queued
      const blockRes = await scheduler.acquire("job-blocker");
      expect(scheduler.activeCount).toBe(1);

      // Controlled deferred promise for Runner 1's queue failure update
      let resolveDelayedTimeoutUpdate!: () => void;
      const delayedTimeoutUpdatePromise = new Promise<void>((resolve) => {
        resolveDelayedTimeoutUpdate = resolve;
      });

      let timeoutUpdateRowMatchCount = -1;

      db.processingJob.updateMany.mockImplementation(
        async (args: {
          where: { id: string; type?: string; status?: unknown };
          data: { status?: "RUNNING" | "FAILED" };
        }) => {
          if (args.where.id === jobAId && args.data.status === "FAILED") {
            // Wait until Runner 2 has claimed Job A before resolving Runner 1's update
            await delayedTimeoutUpdatePromise;

            const currentStatus = jobStates.get(jobAId);
            // Verify predicate matches against current DB state
            const statusMatches =
              typeof args.where.status === "string"
                ? currentStatus === args.where.status
                : Array.isArray((args.where.status as { in?: string[] })?.in)
                ? (args.where.status as { in: string[] }).in.includes(currentStatus!)
                : false;

            if (statusMatches) {
              jobStates.set(jobAId, "FAILED");
              timeoutUpdateRowMatchCount = 1;
              return { count: 1 };
            }
            timeoutUpdateRowMatchCount = 0;
            return { count: 0 };
          }

          if (args.where.id === jobAId && args.where.status === "QUEUED" && args.data.status === "RUNNING") {
            const currentStatus = jobStates.get(jobAId);
            if (currentStatus === "QUEUED") {
              jobStates.set(jobAId, "RUNNING");
              return { count: 1 };
            }
            return { count: 0 };
          }

          return { count: 1 };
        }
      );

      db.processingJob.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
        return {
          id: args.where.id,
          type: "DOCUMENT_EXTRACTION",
          materialId: "mat-1",
          userId: "user-1",
          status: jobStates.get(args.where.id) ?? "QUEUED",
        };
      });

      db.processingJob.findMany.mockImplementation(
        async (args: { where: { id?: { notIn?: string[] } } }) => {
          const excluded = new Set(args.where.id?.notIn ?? []);
          if (jobStates.get(jobAId) === "QUEUED" && !excluded.has(jobAId)) {
            return [{ id: jobAId }];
          }
          return [];
        }
      );

      docProc.extractText.mockResolvedValue({
        text: "Extracted text after winning claim race.",
        pages: [{ pageNumber: 1, text: "Extracted text after winning claim race." }],
      });

      vi.useFakeTimers();
      try {
        // Step 1: Runner 1 begins execution; slot is blocked so Job A queues in scheduler
        const runner1Promise = runDocumentExtractionJob(jobAId);
        expect(scheduler.isQueued(jobAId)).toBe(true);

        // Step 2: Queue wait timer expires
        vi.advanceTimersByTime(300_001);
        // Waiter cancelled; Job A evicted from scheduler queue
        expect(scheduler.isQueued(jobAId)).toBe(false);

        // Step 3: Runner 1 begins queue-failure settlement (suspended on delayedTimeoutUpdatePromise)
        // Step 4: Recovery discovers Job A in database (still QUEUED in DB) and dispatches Runner 2
        // Free the blocking slot so Runner 2 can acquire
        if (blockRes.status === "acquired") blockRes.release();

        const runner2Promise = runDocumentExtractionJob(jobAId);

        // Runner 2 acquires slot and claims Job A (transitions QUEUED -> RUNNING)
        for (let i = 0; i < 10; i++) {
          if (jobStates.get(jobAId) === "RUNNING") break;
          await Promise.resolve();
        }
        expect(jobStates.get(jobAId)).toBe("RUNNING");

        // Step 5: Now resolve Runner 1's delayed queue-failure update
        resolveDelayedTimeoutUpdate();
        await runner1Promise;

        // Step 6: Verify Runner 1's update updated zero rows because status was already RUNNING!
        expect(timeoutUpdateRowMatchCount).toBe(0);
        expect(jobStates.get(jobAId)).toBe("RUNNING");
        expect(datadog.sendDatadogMetric).not.toHaveBeenCalledWith(
          "processing_job.failures",
          1,
          expect.anything()
        );

        // Step 7: Allow Runner 2 to complete extraction
        await runner2Promise;

        // Step 8: Verify Job A reaches SUCCEEDED and extracted text was persisted
        expect(docProc.extractText).toHaveBeenCalledTimes(1);
        expect(tx.material.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: "mat-1", deletedAt: null },
            data: expect.objectContaining({
              extractedText: "Extracted text after winning claim race.",
            }),
          })
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // =========================================================================
  // Queue Failure Metrics Semantics (Phase 11.3.3D.1B.4 Part B)
  // =========================================================================
  describe("Queue Failure Metrics Semantics (Phase 11.3.3D.1B.4 Part B)", () => {
    it("emits processing_job.failures when updateMany successfully transitions a QUEUED job to FAILED (count > 0)", async () => {
      const scheduler = getDocumentExtractionScheduler();
      vi.spyOn(scheduler, "acquire").mockRejectedValueOnce(
        new ExtractionQueueTimeoutError("Document extraction queue wait timed out.")
      );
      db.processingJob.updateMany.mockResolvedValueOnce({ count: 1 });

      await runDocumentExtractionJob("job-timeout-metric-1");

      expect(datadog.sendDatadogMetric).toHaveBeenCalledWith(
        "processing_job.failures",
        1,
        {
          type: "count",
          tags: ["job_type:DOCUMENT_EXTRACTION"],
        }
      );
    });

    it("does not emit processing_job.failures when updateMany updates zero rows (count === 0)", async () => {
      const scheduler = getDocumentExtractionScheduler();
      vi.spyOn(scheduler, "acquire").mockRejectedValueOnce(
        new ExtractionQueueTimeoutError("Document extraction queue wait timed out.")
      );
      db.processingJob.updateMany.mockResolvedValueOnce({ count: 0 });

      await runDocumentExtractionJob("job-timeout-metric-2");

      expect(datadog.sendDatadogMetric).not.toHaveBeenCalledWith(
        "processing_job.failures",
        expect.anything(),
        expect.anything()
      );
    });

    it("does not emit processing_job.failures when database write throws an error", async () => {
      const scheduler = getDocumentExtractionScheduler();
      vi.spyOn(scheduler, "acquire").mockRejectedValueOnce(
        new ExtractionQueueTimeoutError("Document extraction queue wait timed out.")
      );
      db.processingJob.updateMany.mockRejectedValueOnce(new Error("Database connection dropped"));

      await expect(runDocumentExtractionJob("job-timeout-metric-3")).resolves.not.toThrow();

      expect(datadog.sendDatadogMetric).not.toHaveBeenCalledWith(
        "processing_job.failures",
        expect.anything(),
        expect.anything()
      );
    });
  });

  // =========================================================================
  // Recovery of Persisted QUEUED Jobs (Phase 11.3.3D.1B §1, §2, §4)
  // =========================================================================
  describe("recoverPersistedDocumentExtractionJobs", () => {
    it("recovers persisted QUEUED jobs without any 15-minute age cutoff (including hours-old jobs)", async () => {
      db.processingJob.findMany.mockResolvedValueOnce([
        { id: "job-old-1" },
        { id: "job-old-2" },
      ]);

      const dispatchedCount = await recoverPersistedDocumentExtractionJobs(10);
      expect(dispatchedCount).toBe(2);

      // Verify db query: type DOCUMENT_EXTRACTION, status QUEUED, NO createdAt filter!
      expect(db.processingJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: "DOCUMENT_EXTRACTION",
            status: "QUEUED",
          },
          orderBy: { createdAt: "asc" },
          take: 10,
        })
      );

      const queryCalls = db.processingJob.findMany.mock.calls;
      const queryArgs = (queryCalls[0]?.[0] ?? {}) as { where?: { createdAt?: unknown } };
      expect(queryArgs.where?.createdAt).toBeUndefined();
    });

    it("prevents head-of-line blocking by excluding currently tracked jobs via notIn filter", async () => {
      const scheduler = getDocumentExtractionScheduler();
      // Occupy slot and queue with tracked jobs
      const res1 = await scheduler.acquire("job-active-1");
      const res2Promise = scheduler.acquire("job-queued-1");

      expect(scheduler.getTrackedJobIds()).toEqual(
        expect.arrayContaining(["job-active-1", "job-queued-1"])
      );

      db.processingJob.findMany.mockResolvedValueOnce([
        { id: "job-fresh-3" },
      ]);

      await recoverPersistedDocumentExtractionJobs(10);

      expect(db.processingJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: "DOCUMENT_EXTRACTION",
            status: "QUEUED",
            id: { notIn: expect.arrayContaining(["job-active-1", "job-queued-1"]) },
          },
        })
      );

      if (res1.status === "acquired") res1.release();
      const res2 = await res2Promise;
      if (res2.status === "acquired") res2.release();
    });

    it("returns 0 immediately without querying the database when available capacity is 0", async () => {
      const scheduler = getDocumentExtractionScheduler();
      // Fill scheduler to capacity (mock 0 available capacity)
      vi.spyOn(scheduler, "availableCapacity", "get").mockReturnValue(0);

      const dispatchedCount = await recoverPersistedDocumentExtractionJobs(10);
      expect(dispatchedCount).toBe(0);
      expect(db.processingJob.findMany).not.toHaveBeenCalled();
    });

    it("coalesces concurrent recovery calls into a single execution plus follow-up pass", async () => {
      let resolveFirstQuery: (jobs: Array<{ id: string }>) => void;
      const firstQueryPromise = new Promise<Array<{ id: string }>>((resolve) => {
        resolveFirstQuery = resolve;
      });

      // First query blocks on promise
      db.processingJob.findMany.mockReturnValueOnce(firstQueryPromise);
      // Follow-up query returns empty
      db.processingJob.findMany.mockResolvedValueOnce([]);

      // Start recovery 1
      const call1 = recoverPersistedDocumentExtractionJobs(10);

      // Start recovery 2 while recovery 1 is in-flight -> should coalesce
      const call2 = recoverPersistedDocumentExtractionJobs(10);

      // Resolve first query
      resolveFirstQuery!([{ id: "job-coalesce-1" }]);

      const [res1, res2] = await Promise.all([call1, call2]);

      // Both callers receive the same resolved promise result
      expect(res1).toBe(1);
      expect(res2).toBe(1);

      // db.processingJob.findMany was called twice: once for initial pass, once for follow-up
      expect(db.processingJob.findMany).toHaveBeenCalledTimes(2);
    });

    it("continuously refills and drains a 50-job backlog to completion without new uploads", async () => {
      const totalJobs = 50;
      const jobStates = new Map<string, "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED">();
      for (let i = 0; i < totalJobs; i++) {
        jobStates.set(`job-backlog-${i}`, "QUEUED");
      }

      db.processingJob.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
        return {
          id: args.where.id,
          type: "DOCUMENT_EXTRACTION",
          materialId: "mat-1",
          userId: "user-1",
          status: jobStates.get(args.where.id) ?? "QUEUED",
        };
      });

      db.processingJob.updateMany.mockImplementation(
        async (args: { where: { id: string; status?: unknown }; data: { status?: "RUNNING" | "FAILED" } }) => {
          const currentStatus = jobStates.get(args.where.id);
          if (args.where.status === "QUEUED" && currentStatus === "QUEUED") {
            jobStates.set(args.where.id, "RUNNING");
            return { count: 1 };
          }
          if (args.data.status) {
            jobStates.set(args.where.id, args.data.status);
            return { count: 1 };
          }
          return { count: 1 };
        }
      );

      tx.processingJob.updateMany.mockImplementation(async (args: { where: { id: string } }) => {
        jobStates.set(args.where.id, "SUCCEEDED");
        return { count: 1 };
      });

      db.processingJob.findMany.mockImplementation(
        async (args: { where: { id?: { notIn?: string[] } }; take: number }) => {
          const excluded = new Set(args.where.id?.notIn ?? []);
          const queuedJobs: Array<{ id: string }> = [];
          for (let i = 0; i < totalJobs; i++) {
            const id = `job-backlog-${i}`;
            if (jobStates.get(id) === "QUEUED" && !excluded.has(id)) {
              queuedJobs.push({ id });
              if (queuedJobs.length >= args.take) break;
            }
          }
          return queuedJobs;
        }
      );

      docProc.extractText.mockResolvedValue({
        text: "Extracted lecture notes.",
        pages: [{ pageNumber: 1, text: "Extracted lecture notes." }],
      });

      // Kick off initial recovery pass
      await recoverPersistedDocumentExtractionJobs(10);

      // Wait until all 50 jobs are extracted or timeout
      const start = Date.now();
      while (docProc.extractText.mock.calls.length < totalJobs && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 10));
      }

      // All 50 jobs were extracted
      expect(docProc.extractText).toHaveBeenCalledTimes(totalJobs);

      // Scheduler is clean and empty
      const scheduler = getDocumentExtractionScheduler();
      expect(scheduler.activeCount).toBe(0);
      expect(scheduler.queuedCount).toBe(0);
    });

    it("handles database query failure gracefully without unhandled rejection and recovers on next call", async () => {
      // 1. First findMany rejects with connection error
      db.processingJob.findMany.mockRejectedValueOnce(new Error("Connection reset by peer"));

      // 2. Calling recovery must not throw an unhandled rejection
      const result1 = await recoverPersistedDocumentExtractionJobs(10);
      expect(result1).toBe(0);

      // 3. Verify in-flight recovery state was cleared by making a successful subsequent call
      db.processingJob.findMany.mockResolvedValueOnce([{ id: "job-recovered-after-fail" }]);

      const result2 = await recoverPersistedDocumentExtractionJobs(10);
      expect(result2).toBe(1);

      // Verify the job was dispatched to runDocumentExtractionJob
      const scheduler = getDocumentExtractionScheduler();
      expect(scheduler.hasJob("job-recovered-after-fail")).toBe(true);

      // 4. Verify exactly 2 calls occurred with no uncontrolled loop
      expect(db.processingJob.findMany).toHaveBeenCalledTimes(2);
    });

    // =========================================================================
    // Bounded Recovery Retry Lifecycle (Phase 11.3.3D.1B.4 Part A)
    // =========================================================================
    describe("Bounded Recovery Retry Lifecycle (Phase 11.3.3D.1B.4 Part A)", () => {
      it("automatically retries recovery after a startup database outage when database recovers", async () => {
        vi.useFakeTimers();
        try {
          // Startup: database outage -> findMany fails
          db.processingJob.findMany.mockRejectedValueOnce(new Error("Database connection refused at startup"));

          const initialDispatched = await recoverPersistedDocumentExtractionJobs(10);
          expect(initialDispatched).toBe(0);

          // State check: 1 failure, retry timer scheduled
          const state1 = _getRecoveryRetryStateForTesting();
          expect(state1.consecutiveFailures).toBe(1);
          expect(state1.isTimerScheduled).toBe(true);

          // Prepare database recovery response for when retry fires
          db.processingJob.findMany.mockResolvedValueOnce([{ id: "job-startup-1" }]);

          // Advance by 2000 ms (initial backoff delay)
          await vi.advanceTimersByTimeAsync(RECOVERY_INITIAL_RETRY_DELAY_MS);

          // State check: failure count reset to 0, no pending timer
          const state2 = _getRecoveryRetryStateForTesting();
          expect(state2.consecutiveFailures).toBe(0);
          expect(state2.isTimerScheduled).toBe(false);

          // Verify the job was discovered, dispatched, and executed to completion
          // Call 1: initial attempt (failed)
          // Call 2: retry attempt at 2000ms (succeeded, dispatched job-startup-1)
          // Call 3: automatic capacity refill query once job-startup-1 finishes and releases its slot
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(3);
          expect(db.processingJob.findUnique).toHaveBeenCalledWith({ where: { id: "job-startup-1" } });
          expect(docProc.extractText).toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });

      it("follows exponential backoff schedule [2s, 4s, 8s, 16s, 32s] and stops after 5 retries", async () => {
        vi.useFakeTimers();
        try {
          db.processingJob.findMany.mockRejectedValue(new Error("Persistent DB down"));

          // Initial recovery attempt (attempt 0)
          await recoverPersistedDocumentExtractionJobs(10);
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(1);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(true);

          const expectedDelays = [2000, 4000, 8000, 16000, 32000];

          // Retries 1 to 4:
          for (const [i, delay] of expectedDelays.slice(0, -1).entries()) {
            await vi.advanceTimersByTimeAsync(delay - 1);
            expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(i + 1);

            await vi.advanceTimersByTimeAsync(1);
            expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(i + 2);
            expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(true);
          }

          // Retry 5 (the last allowed retry at 32s delay)
          const lastDelay = expectedDelays[4]!;
          await vi.advanceTimersByTimeAsync(lastDelay);

          // Consecutive failures should now be 6 (initial + 5 retries)
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(6);
          // After 5 retries exhausted, no further timer should be scheduled
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(false);

          // Advancing time further produces NO more findMany calls
          const callsCount = db.processingJob.findMany.mock.calls.length;
          expect(callsCount).toBe(6); // 1 initial + 5 retries
          await vi.advanceTimersByTimeAsync(60000);
          expect(db.processingJob.findMany.mock.calls.length).toBe(6);
        } finally {
          vi.useRealTimers();
        }
      });

      it("allows a fresh independent trigger after exhaustion to begin a new retry cycle", async () => {
        vi.useFakeTimers();
        try {
          db.processingJob.findMany.mockRejectedValue(new Error("Persistent DB down"));

          // Exhaust all 5 retries
          await recoverPersistedDocumentExtractionJobs(10);
          for (const delay of RECOVERY_RETRY_DELAYS_MS) {
            await vi.advanceTimersByTimeAsync(delay);
          }
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(6);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(false);

          // Fresh independent trigger arrives (resets failure count to 0, runs recovery)
          await recoverPersistedDocumentExtractionJobs(10);
          const state = _getRecoveryRetryStateForTesting();
          expect(state.consecutiveFailures).toBe(1);
          expect(state.isTimerScheduled).toBe(true);

          // Advancing 2000ms triggers retry 1 of the new cycle
          await vi.advanceTimersByTimeAsync(2000);
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(2);
        } finally {
          vi.useRealTimers();
        }
      });

      it("cancels pending retry timer and runs immediately when an independent trigger arrives", async () => {
        vi.useFakeTimers();
        try {
          db.processingJob.findMany.mockRejectedValueOnce(new Error("Transient error"));

          await recoverPersistedDocumentExtractionJobs(10);
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(1);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(true);

          // Only 500ms elapsed
          await vi.advanceTimersByTimeAsync(500);

          // Independent trigger arrives and DB has recovered
          db.processingJob.findMany.mockResolvedValueOnce([]);

          const dispatched = await recoverPersistedDocumentExtractionJobs(10);
          expect(dispatched).toBe(0);

          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(0);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(false);

          // Advancing past original 2000ms timer produces NO extra calls
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(2);
          await vi.advanceTimersByTimeAsync(2000);
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(2);
        } finally {
          vi.useRealTimers();
        }
      });

      it("coalesces independent trigger during in-flight recovery and preserves fresh cycle intent", async () => {
        vi.useFakeTimers();
        try {
          let rejectFirstQuery!: (err: Error) => void;
          const firstQueryPromise = new Promise<Array<{ id: string }>>((_, reject) => {
            rejectFirstQuery = reject;
          });

          db.processingJob.findMany.mockReturnValueOnce(firstQueryPromise);

          // Initial attempt in flight as a retry
          const call1 = recoverPersistedDocumentExtractionJobs(10, { source: "retry" });

          // While call1 is in flight, an independent trigger arrives
          const call2 = recoverPersistedDocumentExtractionJobs(10);

          rejectFirstQuery(new Error("DB still failing during in flight"));
          await Promise.all([call1, call2]);

          const state = _getRecoveryRetryStateForTesting();
          expect(state.consecutiveFailures).toBe(1);
          expect(state.isTimerScheduled).toBe(true);
        } finally {
          vi.useRealTimers();
        }
      });

      it("_resetRecoveryStateForTesting clears pending retry timers and resets state", async () => {
        vi.useFakeTimers();
        try {
          db.processingJob.findMany.mockRejectedValueOnce(new Error("DB fail"));
          await recoverPersistedDocumentExtractionJobs(10);

          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(true);
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(1);

          _resetRecoveryStateForTesting();

          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(false);
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(0);

          await vi.advanceTimersByTimeAsync(10000);
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    // =========================================================================
    // Internal Recovery Trigger Classification & State Isolation (Phase 11.3.3D.1B.6)
    // =========================================================================
    describe("Internal Recovery Trigger Classification & State Isolation (Phase 11.3.3D.1B.6)", () => {
      it("capacity notification while retry timer is pending leaves timer and counter unchanged without querying database", async () => {
        vi.useFakeTimers();
        try {
          // 1. Initial recovery failure -> schedules retry timer (delay 2000ms)
          db.processingJob.findMany.mockRejectedValueOnce(new Error("Database connection dropped"));
          const initialDispatched = await recoverPersistedDocumentExtractionJobs(10, { source: "independent" });
          expect(initialDispatched).toBe(0);

          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(1);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(true);
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(1);

          // 2. Scheduler capacity notification arrives while timer is pending
          const capacityResult = await recoverPersistedDocumentExtractionJobs(10, { source: "internal" });
          expect(capacityResult).toBe(0);

          // 3. Verify no immediate query occurred, timer is still active, counter is unchanged
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(1);
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(1);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(true);

          // 4. Advance to scheduled retry time (2000ms) where DB has recovered
          db.processingJob.findMany.mockResolvedValueOnce([{ id: "job-retry-1" }]);
          await vi.advanceTimersByTimeAsync(RECOVERY_INITIAL_RETRY_DELAY_MS);

          // 5. Verify the scheduled retry occurred as planned
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(3); // call 1: initial fail, call 2: retry, call 3: capacity refill after job-retry-1 completes
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(0);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      });

      it("capacity notification during an in-flight recovery does not reset failure budget if query fails", async () => {
        vi.useFakeTimers();
        try {
          // 1. First failure occurs -> consecutiveRecoveryFailures = 1, timer = 2000ms
          db.processingJob.findMany.mockRejectedValueOnce(new Error("Initial DB failure"));
          await recoverPersistedDocumentExtractionJobs(10, { source: "independent" });
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(1);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(true);

          // 2. Advance time to 2000ms so Retry 1 begins
          let rejectInFlightRetry!: (err: Error) => void;
          const inFlightRetryPromise = new Promise<Array<{ id: string }>>((_, reject) => {
            rejectInFlightRetry = reject;
          });
          db.processingJob.findMany.mockReturnValueOnce(inFlightRetryPromise);

          // Advance timers synchronously by 2000ms so the timer callback executes
          vi.advanceTimersByTime(RECOVERY_INITIAL_RETRY_DELAY_MS);

          // 3. While Retry 1 is in flight, an internal capacity notification arrives
          const capacityCallPromise = recoverPersistedDocumentExtractionJobs(10, { source: "internal" });

          // Internal trigger coalesces onto in-flight promise without setting pendingIndependentTrigger
          expect(_getRecoveryRetryStateForTesting().hasPendingRefillRequest).toBe(true);
          expect(_getRecoveryRetryStateForTesting().pendingIndependentTrigger).toBe(false);

          // 4. Reject the in-flight retry query
          rejectInFlightRetry(new Error("Database still down"));
          await capacityCallPromise;

          // 5. Verify failure count incremented from 1 -> 2 (NOT reset to 0!)
          const state = _getRecoveryRetryStateForTesting();
          expect(state.consecutiveFailures).toBe(2);
          expect(state.isTimerScheduled).toBe(true);

          // 6. Verify the next backoff delay is 4000ms (RECOVERY_RETRY_DELAYS_MS[1])
          const secondDelay = RECOVERY_RETRY_DELAYS_MS[1]; // 4000ms
          await vi.advanceTimersByTimeAsync(secondDelay - 1);
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(2);

          // Advancing the final 1ms triggers Retry 2
          db.processingJob.findMany.mockResolvedValueOnce([]);
          await vi.advanceTimersByTimeAsync(1);
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(0);
        } finally {
          vi.useRealTimers();
        }
      });

      it("repeated capacity notifications during database failure cannot cancel or reset retry timer or execute queries", async () => {
        vi.useFakeTimers();
        try {
          db.processingJob.findMany.mockRejectedValueOnce(new Error("Database down"));
          await recoverPersistedDocumentExtractionJobs(10, { source: "independent" });

          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(1);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(true);
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(1);

          // Trigger multiple capacity notifications in rapid succession
          for (let i = 0; i < 5; i++) {
            const res = await recoverPersistedDocumentExtractionJobs(10, { source: "internal" });
            expect(res).toBe(0);
          }

          // No extra queries executed
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(1);
          // Timer still scheduled
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(true);
          // Counter still 1
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(1);

          // Advance time: retry fires normally at 2000ms
          db.processingJob.findMany.mockResolvedValueOnce([]);
          await vi.advanceTimersByTimeAsync(RECOVERY_INITIAL_RETRY_DELAY_MS);
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(2);
        } finally {
          vi.useRealTimers();
        }
      });

      it("coalesces internal capacity notification during in-flight successful recovery into internal refill follow-up", async () => {
        vi.useFakeTimers();
        try {
          let resolveFirstQuery!: (jobs: Array<{ id: string }>) => void;
          const firstQueryPromise = new Promise<Array<{ id: string }>>((resolve) => {
            resolveFirstQuery = resolve;
          });

          db.processingJob.findMany.mockReturnValueOnce(firstQueryPromise);
          db.processingJob.findMany.mockResolvedValueOnce([]); // follow-up query

          // 1. Initial independent recovery in flight
          const call1 = recoverPersistedDocumentExtractionJobs(10, { source: "independent" });

          // 2. Capacity notification arrives while in flight
          const call2 = recoverPersistedDocumentExtractionJobs(10, { source: "internal" });

          // Coalesced
          expect(_getRecoveryRetryStateForTesting().hasPendingRefillRequest).toBe(true);
          expect(_getRecoveryRetryStateForTesting().pendingIndependentTrigger).toBe(false);

          // Resolve first query with 1 job
          resolveFirstQuery([{ id: "job-refill-1" }]);
          const [res1, res2] = await Promise.all([call1, call2]);

          expect(res1).toBe(1);
          expect(res2).toBe(1);

          // Both initial query and follow-up query executed
          expect(db.processingJob.findMany).toHaveBeenCalledTimes(2);

          // Follow-up was internal and succeeded: no retry timer, failures = 0
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(0);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      });

      it("early exit caused by zero scheduler capacity clears pendingIndependentTrigger and does not leak stale intent to subsequent recovery", async () => {
        vi.useFakeTimers();
        try {
          const scheduler = getDocumentExtractionScheduler();

          // Block scheduler available capacity to 0
          const capacitySpy = vi.spyOn(scheduler, "availableCapacity", "get").mockReturnValue(0);

          // Hold pass 1 in flight with a deferred promise so call2 arrives while pass 1 is truly in flight
          let resolvePass1!: (jobs: Array<{ id: string }>) => void;
          const pass1Promise = new Promise<Array<{ id: string }>>((resolve) => {
            resolvePass1 = resolve;
          });

          // Unblock capacity for pass 1 just enough to initiate the query
          capacitySpy.mockReturnValueOnce(1);
          db.processingJob.findMany.mockReturnValueOnce(pass1Promise);

          // Pass 1: starts and pauses on findMany
          const call1 = recoverPersistedDocumentExtractionJobs(10, { source: "internal" });

          // Now, while pass 1 is waiting on findMany, capacity drops to 0
          capacitySpy.mockReturnValue(0);

          // An independent trigger arrives while pass 1 is in flight!
          const call2 = recoverPersistedDocumentExtractionJobs(10, { source: "independent" });
          expect(_getRecoveryRetryStateForTesting().pendingIndependentTrigger).toBe(true);

          // Resolve pass 1 query with 0 jobs -> loop re-checks capacity, sees availableCapacity <= 0, and breaks early
          resolvePass1([]);
          await Promise.all([call1, call2]);

          // Crucial assertion: pendingIndependentTrigger MUST be cleared at the end of the pass!
          expect(_getRecoveryRetryStateForTesting().pendingIndependentTrigger).toBe(false);

          // Restore normal capacity
          capacitySpy.mockRestore();

          // Now, simulate a subsequent recovery pass triggered internally that fails
          db.processingJob.findMany.mockRejectedValueOnce(new Error("DB failure on pass 2"));

          // Failure count increments normally without being cleared by stale flag
          await recoverPersistedDocumentExtractionJobs(10, { source: "internal" });
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(1);

          // Now, send a GENUINELY NEW independent trigger that also fails
          db.processingJob.findMany.mockRejectedValueOnce(new Error("DB failure on pass 3"));
          await recoverPersistedDocumentExtractionJobs(10, { source: "independent" });

          // The genuine independent trigger starts a fresh cycle (resets failure count to 0, increments to 1, schedules 2000ms)
          expect(_getRecoveryRetryStateForTesting().consecutiveFailures).toBe(1);
          expect(_getRecoveryRetryStateForTesting().isTimerScheduled).toBe(true);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    // =========================================================================
    // Independent In-Flight Upload Recovery Regression (Phase 11.3.3D.1B.8)
    // =========================================================================
    describe("Independent In-Flight Upload Recovery Regression (Phase 11.3.3D.1B.8)", () => {
      it("discovers and dispatches newly committed document queued during in-flight recovery pass", async () => {
        const scheduler = getDocumentExtractionScheduler();
        // Ensure scheduler has sufficient available capacity for both jobs so follow-up query executes immediately
        expect(scheduler.availableCapacity).toBeGreaterThanOrEqual(2);

        // Spy on scheduler.acquire to verify dispatch to the scheduler's admission path
        const acquireSpy = vi.spyOn(scheduler, "acquire");

        const existingJobId = "job-existing-1";
        const newlyCommittedJobId = "job-newly-uploaded-2";

        // Deferred promise to deterministically hold the first findMany query in-flight
        let resolveFirstQuery!: (jobs: Array<{ id: string }>) => void;
        const firstQueryPromise = new Promise<Array<{ id: string }>>((resolve) => {
          resolveFirstQuery = resolve;
        });

        // 1. Initial query is deferred in flight
        db.processingJob.findMany.mockReturnValueOnce(firstQueryPromise);
        // 5 & 6. Follow-up query returns the newly queued job
        db.processingJob.findMany.mockResolvedValueOnce([{ id: newlyCommittedJobId }]);

        // Step 1: Start initial recovery query
        const pass1Promise = recoverPersistedDocumentExtractionJobs(10, { source: "independent" });

        // Step 2 & 3: While query 1 is in-flight, simulate a newly committed QUEUED job triggering recovery
        const pass2Promise = recoverPersistedDocumentExtractionJobs(10, { source: "independent" });

        // Verify coalescing state while in flight
        const inFlightState = _getRecoveryRetryStateForTesting();
        expect(inFlightState.hasPendingRefillRequest).toBe(true);
        expect(inFlightState.pendingIndependentTrigger).toBe(true);

        // Step 4: Resolve the original query with only the existing job (does not contain newlyCommittedJobId)
        resolveFirstQuery([{ id: existingJobId }]);

        // Step 8: Await settlement of both the initial and coalesced recovery promises
        const [dispatchedPass1, dispatchedPass2] = await Promise.all([pass1Promise, pass2Promise]);

        // Both original and coalesced callers receive the same total dispatched count (2 jobs)
        expect(dispatchedPass1).toBe(2);
        expect(dispatchedPass2).toBe(2);

        // Verify findMany was called exactly twice (pass 1 and pass 2)
        expect(db.processingJob.findMany).toHaveBeenCalledTimes(2);

        // Verify the second query excluded the tracked existing job
        expect(db.processingJob.findMany).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            where: expect.objectContaining({
              type: "DOCUMENT_EXTRACTION",
              status: "QUEUED",
              id: { notIn: expect.arrayContaining([existingJobId]) },
            }),
            orderBy: { createdAt: "asc" },
          })
        );

        // Verify the second query returned the newly committed job
        const secondQueryResult = await db.processingJob.findMany.mock.results[1]?.value;
        expect(secondQueryResult).toEqual([{ id: newlyCommittedJobId }]);

        // Step 7: Verify both jobs (including the new job) reached the scheduler's dispatch/acquisition path
        expect(acquireSpy).toHaveBeenCalledWith(existingJobId);
        expect(acquireSpy).toHaveBeenCalledWith(newlyCommittedJobId);

        // Verify no duplicate dispatch occurred: acquire was called exactly once per distinct job
        expect(acquireSpy).toHaveBeenCalledTimes(2);
        expect(acquireSpy.mock.calls.map(([id]) => id)).toEqual([existingJobId, newlyCommittedJobId]);

        // Step 9: Verify recovery state is completely clean after completion
        const settledState = _getRecoveryRetryStateForTesting();
        expect(settledState.hasPendingRefillRequest).toBe(false);
        expect(settledState.pendingIndependentTrigger).toBe(false);
        expect(settledState.consecutiveFailures).toBe(0);
        expect(settledState.isTimerScheduled).toBe(false);
      });
    });
  });

  // =========================================================================
  // Phase 11.3.3D.2: Active Document Extraction Timeout & Cooperative Cancellation
  // =========================================================================
  describe("Phase 11.3.3D.2: Active Document Extraction Timeout & Cooperative Cancellation", () => {
    const originalEnv = process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS;

    beforeEach(() => {
      vi.resetAllMocks();
      vi.useRealTimers();
      process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = originalEnv;
      _resetRecoveryStateForTesting();
      _resetActiveExtractionRegistryForTesting();
      getDocumentExtractionScheduler().resetForTesting();

      db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
      db.processingJob.findUnique.mockResolvedValue({
        id: "job-timeout-1",
        userId: "user-1",
        materialId: "mat-timeout-1",
        type: "DOCUMENT_EXTRACTION",
        status: "QUEUED",
      });
      db.processingJob.updateMany.mockResolvedValue({ count: 1 });
      db.material.findUnique.mockResolvedValue({
        id: "mat-timeout-1",
        type: "PDF",
        storageKey: "materials/u/m.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        deletedAt: null,
      });
      tx.processingJob.updateMany.mockResolvedValue({ count: 1 });
      tx.material.update.mockResolvedValue({ id: "mat-timeout-1" });
    });

    afterEach(() => {
      process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = originalEnv;
      _resetActiveExtractionRegistryForTesting();
      vi.useRealTimers();
    });

    describe("Active Extraction Timeout Configuration", () => {
      it("defaults to 120,000 ms (2 minutes)", () => {
        delete process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS;
        expect(getDocumentExtractionActiveTimeoutMs()).toBe(DEFAULT_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS);
        expect(DEFAULT_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS).toBe(120_000);
      });

      it("parses valid integer timeout from environment variable", () => {
        process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = "45000";
        expect(getDocumentExtractionActiveTimeoutMs()).toBe(45_000);
      });

      it("enforces minimum timeout bound (MIN_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = 5,000 ms)", () => {
        process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = "2000";
        expect(getDocumentExtractionActiveTimeoutMs()).toBe(DEFAULT_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS);
        expect(MIN_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS).toBe(5_000);
      });

      it("falls back to default when environment variable is not a valid number", () => {
        process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = "invalid-timeout";
        expect(getDocumentExtractionActiveTimeoutMs()).toBe(DEFAULT_DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS);
      });
    });

    describe("Active Timeout vs Queue Wait Timeout Separation", () => {
      it("queue wait timeout targets status: 'QUEUED' before acquiring a slot", async () => {
        const scheduler = getDocumentExtractionScheduler();
        vi.spyOn(scheduler, "acquire").mockRejectedValueOnce(
          new ExtractionQueueTimeoutError()
        );

        await runDocumentExtractionJob("job-wait-timeout");

        expect(db.processingJob.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: "job-wait-timeout",
              type: "DOCUMENT_EXTRACTION",
              status: "QUEUED",
            },
            data: expect.objectContaining({
              status: "FAILED",
              error: expect.stringContaining("timed out"),
            }),
          })
        );
        expect(datadog.sendDatadogMetric).toHaveBeenCalledWith("processing_job.failures", 1, {
          type: "count",
          tags: ["job_type:DOCUMENT_EXTRACTION"],
        });
      });

      it("active timeout targets status: 'RUNNING' after slot acquisition and emits failure metric", async () => {
        vi.useFakeTimers();
        process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = "5000";

        let capturedSignal: AbortSignal | undefined;
        // Extractor hangs until aborted
        docProc.extractText.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
          capturedSignal = signal;
          return new Promise((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(signal.reason);
            });
          });
        });

        const runPromise = runDocumentExtractionJob("job-timeout-1");

        // Allow slot acquisition and claimJob to execute
        await vi.advanceTimersByTimeAsync(10);
        expect(getDocumentExtractionScheduler().activeCount).toBe(1);
        expect(capturedSignal?.aborted).toBe(false);

        // Advance past active timeout (5,000 ms)
        await vi.advanceTimersByTimeAsync(5000);
        await runPromise;

        // Verify active timeout aborted the extraction
        expect(capturedSignal?.aborted).toBe(true);
        expect(capturedSignal?.reason).toBeInstanceOf(ExtractionActiveTimeoutError);

        // Verify transition targeting status: 'RUNNING'
        expect(db.processingJob.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: "job-timeout-1",
              type: "DOCUMENT_EXTRACTION",
              status: "RUNNING",
            },
            data: expect.objectContaining({
              status: "FAILED",
              error: "Document extraction timed out after 5 seconds.",
            }),
          })
        );

        // Verify failure metric emitted exactly once
        const failureMetrics = datadog.sendDatadogMetric.mock.calls.filter(
          (call) => call[0] === "processing_job.failures"
        );
        expect(failureMetrics).toHaveLength(1);
        expect(datadog.sendDatadogMetric).toHaveBeenCalledWith("processing_job.failures", 1, {
          type: "count",
          tags: ["job_type:DOCUMENT_EXTRACTION"],
        });

        // Scheduler slot released in finally
        expect(getDocumentExtractionScheduler().activeCount).toBe(0);
      });
    });

    describe("Scheduler Slot Retention and Slow Parser Settlement (Mammoth Invariant)", () => {
      it("retains scheduler slot while slow parser is executing and releases only after promise settles", async () => {
        vi.useFakeTimers();
        process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = "5000";

        let resolveParser!: (value: { text: string }) => void;
        const parserPromise = new Promise<{ text: string }>((res) => {
          resolveParser = res;
        });

        docProc.extractText.mockReturnValue(parserPromise);

        const runPromise = runDocumentExtractionJob("job-timeout-slow");

        await vi.advanceTimersByTimeAsync(10);
        const scheduler = getDocumentExtractionScheduler();
        expect(scheduler.activeCount).toBe(1);

        // Advance past timeout: timer fires, abort signal triggered
        await vi.advanceTimersByTimeAsync(5000);

        // CRITICAL INVARIANT: Scheduler slot MUST STILL BE HELD while Mammoth/parser promise is unresolved!
        expect(scheduler.activeCount).toBe(1);

        // Slow parser finally completes after timeout
        resolveParser({ text: "Late extracted text from Mammoth" });
        await runPromise;

        // Only after parser settles is the slot released
        expect(scheduler.activeCount).toBe(0);

        // Late text MUST BE DISCARDED: transaction commit was never called
        expect(tx.material.update).not.toHaveBeenCalled();
      });
    });

    describe("Cooperative In-Flight Cancellation (Material & Group Deletion)", () => {
      it("cancels active extraction by material ID, halts extractor, and skips failure metrics", async () => {
        vi.useFakeTimers();

        let capturedSignal: AbortSignal | undefined;
        docProc.extractText.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
          capturedSignal = signal;
          return new Promise((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(signal.reason);
            });
          });
        });

        const runPromise = runDocumentExtractionJob("job-timeout-1");

        await vi.advanceTimersByTimeAsync(10);
        expect(capturedSignal?.aborted).toBe(false);

        // Verify job is registered in active registry
        const registryBefore = _getActiveExtractionRegistrySizeForTesting();
        expect(registryBefore.byJobId).toBe(1);
        expect(registryBefore.byMaterialId).toBe(1);

        // Simulate material deletion calling cancelActiveDocumentExtractionForMaterial
        const cancelled = cancelActiveDocumentExtractionForMaterial("mat-timeout-1", "Material was deleted.");
        expect(cancelled).toBe(true);

        // Extractor aborted cooperatively
        expect(capturedSignal?.aborted).toBe(true);
        expect(capturedSignal?.reason).toBeInstanceOf(ExtractionCancelledError);

        await runPromise;

        // Must NOT call failRunningDocumentExtractionJob or write FAILED status
        const failedUpdates = db.processingJob.updateMany.mock.calls.filter(
          (call) => call[0]?.data?.status === "FAILED"
        );
        expect(failedUpdates).toHaveLength(0);

        // Must NOT emit failure metrics
        const failureMetrics = datadog.sendDatadogMetric.mock.calls.filter(
          (call) => call[0] === "processing_job.failures"
        );
        expect(failureMetrics).toHaveLength(0);

        // Registry and slot cleaned up
        const registryAfter = _getActiveExtractionRegistrySizeForTesting();
        expect(registryAfter.byJobId).toBe(0);
        expect(registryAfter.byMaterialId).toBe(0);
        expect(getDocumentExtractionScheduler().activeCount).toBe(0);
      });

      it("returns false when cancelling a non-existent or inactive material ID", () => {
        expect(cancelActiveDocumentExtractionForMaterial("non-existent-material")).toBe(false);
        expect(cancelActiveDocumentExtraction("non-existent-job")).toBe(false);
      });
    });

    describe("Cancellation Overwrite Immunity and Metric Gating", () => {
      it("does not emit failure metric if job was already CANCELLED when active timeout fired", async () => {
        vi.useFakeTimers();
        process.env.DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS = "5000";

        // Claim succeeds, but subsequent status update targeting RUNNING finds 0 rows (job was CANCELLED)
        db.processingJob.updateMany
          .mockResolvedValueOnce({ count: 1 }) // claimJob
          .mockResolvedValueOnce({ count: 0 }); // timeout update finds 0 rows (already CANCELLED)

        docProc.extractText.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
          return new Promise((_, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason));
          });
        });

        const runPromise = runDocumentExtractionJob("job-timeout-1");
        await vi.advanceTimersByTimeAsync(10);
        await vi.advanceTimersByTimeAsync(5000);
        await runPromise;

        // Metric was gated on count > 0: count was 0, so 0 failure metrics emitted!
        const failureMetrics = datadog.sendDatadogMetric.mock.calls.filter(
          (call) => call[0] === "processing_job.failures"
        );
        expect(failureMetrics).toHaveLength(0);
      });
    });

    describe("Timer and Registry Cleanup on Successful Extraction", () => {
      it("cleans up active timeout timer and registry entries when extraction succeeds", async () => {
        docProc.extractText.mockResolvedValueOnce({ text: "Extracted document content." });

        await runDocumentExtractionJob("job-timeout-1");

        const registry = _getActiveExtractionRegistrySizeForTesting();
        expect(registry.byJobId).toBe(0);
        expect(registry.byMaterialId).toBe(0);
        expect(getDocumentExtractionScheduler().activeCount).toBe(0);
        expect(tx.material.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: "mat-timeout-1", deletedAt: null },
            data: expect.objectContaining({ extractedText: "Extracted document content." }),
          })
        );
      });
    });

    describe("Material Soft-Deletion Pre-Extraction Check", () => {
      it("exits cleanly without error or failure metric if material is soft-deleted before extraction starts", async () => {
        db.material.findUnique.mockResolvedValueOnce({
          id: "mat-timeout-1",
          deletedAt: new Date(),
        });

        await runDocumentExtractionJob("job-timeout-1");

        expect(docProc.extractText).not.toHaveBeenCalled();
        const failureMetrics = datadog.sendDatadogMetric.mock.calls.filter(
          (call) => call[0] === "processing_job.failures"
        );
        expect(failureMetrics).toHaveLength(0);
        expect(getDocumentExtractionScheduler().activeCount).toBe(0);
      });
    });

    describe("LayoutAmbiguityError Worker Pipeline Atomicity (Phase 11.3.5B.1)", () => {
      it("settles job as FAILED without updating Material.extractedText or queueing embeddings when LayoutAmbiguityError occurs, releasing scheduler slot", async () => {
        const { LayoutAmbiguityError } = await import("@/lib/services/document-processing-local");

        db.processingJob.findUnique.mockResolvedValueOnce({
          id: "job-ambig-1",
          type: "DOCUMENT_EXTRACTION",
          status: "QUEUED",
          materialId: "mat-ambig-1",
          userId: "user-1",
        });

        db.material.findUnique.mockResolvedValueOnce({
          id: "mat-ambig-1",
          type: "PDF",
          storageKey: "materials/ambiguous.pdf",
          mimeType: "application/pdf",
          extractedText: "Pre-existing valid text",
          sizeBytes: 1024,
          deletedAt: null,
        });

        docProc.extractText.mockRejectedValueOnce(
          new LayoutAmbiguityError("Item crosses confirmed gutter [180, 320]")
        );

        await runDocumentExtractionJob("job-ambig-1");

        // 1. ProcessingJob transitioned to FAILED with error message
        expect(db.processingJob.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: "job-ambig-1",
              type: "DOCUMENT_EXTRACTION",
              status: "RUNNING",
            },
            data: expect.objectContaining({
              status: "FAILED",
              error: expect.stringContaining("Item crosses confirmed gutter"),
            }),
          })
        );

        // 2. Material.extractedText was NEVER updated (transaction commit was never invoked)
        expect(tx.material.update).not.toHaveBeenCalled();

        // 3. Embedding job was NEVER queued
        expect(queue.queueEmbeddingJob).not.toHaveBeenCalled();

        // 4. Scheduler slot and registry released cleanly
        expect(getDocumentExtractionScheduler().activeCount).toBe(0);
        const registry = _getActiveExtractionRegistrySizeForTesting();
        expect(registry.byJobId).toBe(0);
        expect(registry.byMaterialId).toBe(0);

        // 5. Failure metric emitted
        expect(datadog.sendDatadogMetric).toHaveBeenCalledWith("processing_job.failures", 1, {
          type: "count",
          tags: ["job_type:DOCUMENT_EXTRACTION"],
        });
      });
    });

    describe("Error Classification Helper", () => {
      it("classifies ExtractionCancelledError and signals as 'cancelled'", () => {
        const err = new ExtractionCancelledError("User cancelled");
        expect(classifyExtractionError(err)).toBe("cancelled");

        const controller = new AbortController();
        controller.abort(err);
        expect(classifyExtractionError(new Error("generic"), controller.signal)).toBe("cancelled");
      });

      it("classifies ExtractionActiveTimeoutError and signals as 'timeout'", () => {
        const err = new ExtractionActiveTimeoutError(60000);
        expect(classifyExtractionError(err)).toBe("timeout");

        const controller = new AbortController();
        controller.abort(err);
        expect(classifyExtractionError(new Error("generic"), controller.signal)).toBe("timeout");
      });

      it("classifies Node AbortError with cancelled or timeout reasons correctly", () => {
        const cancelController = new AbortController();
        cancelController.abort(new ExtractionCancelledError("test"));
        const abortErr1 = new Error("This operation was aborted");
        abortErr1.name = "AbortError";
        expect(classifyExtractionError(abortErr1, cancelController.signal)).toBe("cancelled");

        const timeoutController = new AbortController();
        timeoutController.abort(new ExtractionActiveTimeoutError(10000));
        const abortErr2 = new Error("This operation was aborted");
        abortErr2.name = "AbortError";
        expect(classifyExtractionError(abortErr2, timeoutController.signal)).toBe("timeout");
      });

      it("classifies standard errors as 'failure'", () => {
        expect(classifyExtractionError(new Error("Disk read error"))).toBe("failure");
        expect(classifyExtractionError("some unknown string")).toBe("failure");
      });
    });
  });
});
