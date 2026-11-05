import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  processingJob: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  material: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  transcript: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  transcriptSegment: { deleteMany: vi.fn(), createMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/observability/datadog", () => ({
  sendDatadogMetric: vi.fn().mockResolvedValue(undefined),
}));

const queue = vi.hoisted(() => ({ queueEmbeddingJob: vi.fn() }));
vi.mock("@/lib/ingestion", () => queue);

const speech = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock("@/lib/services/speech", () => ({ getSpeechService: () => speech }));

vi.mock("@/lib/services/storage", () => ({ getStorageService: vi.fn() }));

const docService = vi.hoisted(() => ({ extractText: vi.fn() }));
vi.mock("@/lib/services/document-processing", () => ({
  getDocumentProcessingService: () => docService,
}));

import { isJobActive, failJob, completeJobWithin } from "@/lib/processing-jobs";
import { runTranscriptionJob } from "@/lib/transcription";
import { runDocumentExtractionJob } from "@/lib/document-extraction";
import { getStorageService } from "@/lib/services/storage";
import { LocalStorageService } from "@/lib/services/storage-local";

describe("Processing jobs isolation & cancellation safety (Phase 10C.1D)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const storage = Object.create(LocalStorageService.prototype) as LocalStorageService;
    storage.readFile = vi.fn().mockResolvedValue(Buffer.from("fake-audio"));
    vi.mocked(getStorageService).mockReturnValue(storage);
    db.transcript.updateMany.mockResolvedValue({ count: 0 });
    db.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") return arg(db);
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg;
    });
  });

  describe("isJobActive guard", () => {
    it("returns true when job is RUNNING and material is not soft-deleted", async () => {
      db.processingJob.findUnique.mockResolvedValue({ id: "job-1", status: "RUNNING" });
      db.material.findUnique.mockResolvedValue({ id: "mat-1", deletedAt: null });

      expect(await isJobActive("job-1", "mat-1")).toBe(true);
    });

    it("returns true when job is QUEUED and material is not soft-deleted", async () => {
      db.processingJob.findUnique.mockResolvedValue({ id: "job-1", status: "QUEUED" });
      db.material.findUnique.mockResolvedValue({ id: "mat-1", deletedAt: null });

      expect(await isJobActive("job-1", "mat-1")).toBe(true);
    });

    it("returns false when job was CANCELLED (e.g. by group deletion)", async () => {
      db.processingJob.findUnique.mockResolvedValue({ id: "job-1", status: "CANCELLED" });
      db.material.findUnique.mockResolvedValue({ id: "mat-1", deletedAt: null });

      expect(await isJobActive("job-1", "mat-1")).toBe(false);
    });

    it("returns false when job reached FAILED status", async () => {
      db.processingJob.findUnique.mockResolvedValue({ id: "job-1", status: "FAILED" });
      db.material.findUnique.mockResolvedValue({ id: "mat-1", deletedAt: null });

      expect(await isJobActive("job-1", "mat-1")).toBe(false);
    });

    it("returns false when job already reached SUCCEEDED status", async () => {
      db.processingJob.findUnique.mockResolvedValue({ id: "job-1", status: "SUCCEEDED" });
      db.material.findUnique.mockResolvedValue({ id: "mat-1", deletedAt: null });

      expect(await isJobActive("job-1", "mat-1")).toBe(false);
    });

    it("returns false when parent material has been soft-deleted", async () => {
      db.processingJob.findUnique.mockResolvedValue({ id: "job-1", status: "RUNNING" });
      db.material.findUnique.mockResolvedValue({ id: "mat-1", deletedAt: new Date() });

      expect(await isJobActive("job-1", "mat-1")).toBe(false);
    });
  });

  describe("failJob terminal state protection", () => {
    it("only updates jobs that are still QUEUED or RUNNING — never overwrites a CANCELLED job", async () => {
      db.processingJob.updateMany.mockResolvedValue({ count: 0 });

      await failJob("job-cancelled", "TRANSCRIPTION", new Error("error"), "fallback");

      expect(db.processingJob.updateMany).toHaveBeenCalledWith({
        where: { id: "job-cancelled", status: { in: ["QUEUED", "RUNNING"] } },
        data: expect.objectContaining({ status: "FAILED" }),
      });
    });
  });

  describe("completeJobWithin conditional completion (Phase 10C.1D.1)", () => {
    it("returns true when job is successfully transitioned from RUNNING to SUCCEEDED and material is active", async () => {
      const mockTx = {
        processingJob: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };

      const result = await completeJobWithin(mockTx as unknown as Parameters<typeof completeJobWithin>[0], "job-1", "mat-1");
      expect(result).toBe(true);
      expect(mockTx.processingJob.updateMany).toHaveBeenCalledWith({
        where: {
          id: "job-1",
          status: "RUNNING",
          material: { deletedAt: null },
        },
        data: {
          status: "SUCCEEDED",
          progress: 100,
          completedAt: expect.any(Date),
        },
      });
    });

    it("returns false when job status was already CANCELLED or material was soft-deleted (count is 0)", async () => {
      const mockTx = {
        processingJob: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };

      const result = await completeJobWithin(mockTx as unknown as Parameters<typeof completeJobWithin>[0], "job-cancelled", "mat-1");
      expect(result).toBe(false);
    });
  });

  describe("Worker execution safety against cancelled jobs", () => {
    it("runTranscriptionJob aborts inside transaction when completeJobWithin returns false (race window closed)", async () => {
      // Step 1: Initial claim succeeds
      db.processingJob.findUnique
        .mockResolvedValueOnce({ id: "job-race", type: "TRANSCRIPTION", materialId: "mat-1", userId: "u1" })
        .mockResolvedValueOnce({ id: "job-race", status: "RUNNING" }); // isJobActive initially returned true
      db.material.findUnique
        .mockResolvedValueOnce({ id: "mat-1", storageKey: "audio.mp3", mimeType: "audio/mpeg" })
        .mockResolvedValueOnce({ id: "mat-1", deletedAt: null }); // material initially appeared active

      // claimJob returns count: 1, speech succeeds
      speech.transcribe.mockResolvedValue({ language: "en", segments: [{ text: "hello", startSeconds: 0, endSeconds: 2 }] });

      // Inside transaction, completeJobWithin's updateMany returns count: 0 because group deletion cancelled the job concurrently
      db.processingJob.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claimJob
        .mockResolvedValueOnce({ count: 0 }); // completeJobWithin inside transaction

      await runTranscriptionJob("job-race");

      // Verify that transcript was NOT upserted and embedding job was NOT queued
      expect(db.transcript.upsert).not.toHaveBeenCalled();
      expect(queue.queueEmbeddingJob).not.toHaveBeenCalled();
    });
    it("runTranscriptionJob does not write SUCCEEDED or transcript if job was cancelled during transcription", async () => {
      // Step 1: Initial claim succeeds
      db.processingJob.findUnique
        .mockResolvedValueOnce({ id: "job-1", type: "TRANSCRIPTION", materialId: "mat-1", userId: "u1" }) // start
        .mockResolvedValueOnce({ id: "job-1", status: "CANCELLED" }); // isJobActive check after speech API

      db.processingJob.updateMany.mockResolvedValue({ count: 1 }); // claimJob
      db.material.findUnique.mockResolvedValue({ id: "mat-1", storageKey: "audio.mp3", mimeType: "audio/mpeg" });
      speech.transcribe.mockResolvedValue({ language: "en", segments: [{ text: "hello", startSeconds: 0, endSeconds: 2 }] });

      await runTranscriptionJob("job-1");

      // Verify speech API ran, but completion transaction was NOT committed
      expect(speech.transcribe).toHaveBeenCalled();
      expect(db.transcript.upsert).not.toHaveBeenCalled();
      expect(db.processingJob.update).not.toHaveBeenCalled();
      expect(queue.queueEmbeddingJob).not.toHaveBeenCalled();
    });

    it("runDocumentExtractionJob does not update Material or mark job SUCCEEDED if job was cancelled during extraction", async () => {
      // Initial claim succeeds, but before commit, group deletion cancels job
      db.processingJob.findUnique
        .mockResolvedValueOnce({ id: "job-doc", type: "DOCUMENT_EXTRACTION", materialId: "mat-doc", userId: "u1" })
        .mockResolvedValueOnce({ id: "job-doc", status: "CANCELLED" });

      db.processingJob.updateMany.mockResolvedValue({ count: 1 });
      db.material.findUnique.mockResolvedValue({ id: "mat-doc", type: "PDF", storageKey: "doc.pdf", mimeType: "application/pdf" });
      docService.extractText.mockResolvedValue({ text: "Extracted content", pages: [] });

      await runDocumentExtractionJob("job-doc");

      expect(docService.extractText).toHaveBeenCalled();
      expect(db.material.update).not.toHaveBeenCalled();
      expect(db.processingJob.update).not.toHaveBeenCalled();
      expect(queue.queueEmbeddingJob).not.toHaveBeenCalled();
    });

    it("runTranscriptionJob commits successfully when job remains active and material is active", async () => {
      db.processingJob.findUnique
        .mockResolvedValueOnce({ id: "job-1", type: "TRANSCRIPTION", materialId: "mat-1", userId: "u1" })
        .mockResolvedValueOnce({ id: "job-1", status: "RUNNING" });

      db.processingJob.updateMany.mockResolvedValue({ count: 1 });
      db.material.findUnique
        .mockResolvedValueOnce({ id: "mat-1", storageKey: "audio.mp3", mimeType: "audio/mpeg" })
        .mockResolvedValueOnce({ id: "mat-1", deletedAt: null });

      speech.transcribe.mockResolvedValue({ language: "en", segments: [{ text: "hello", startSeconds: 0, endSeconds: 2 }] });
      db.transcript.upsert.mockResolvedValue({ id: "tr-1" });
      db.processingJob.update.mockResolvedValue({ id: "job-1", status: "SUCCEEDED" });
      queue.queueEmbeddingJob.mockResolvedValue(undefined);

      await runTranscriptionJob("job-1");

      expect(speech.transcribe).toHaveBeenCalled();
      expect(db.transcript.upsert).toHaveBeenCalled();
      expect(db.processingJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "job-1",
            status: "RUNNING",
            material: { deletedAt: null },
          }),
          data: expect.objectContaining({ status: "SUCCEEDED", progress: 100 }),
        })
      );
      expect(queue.queueEmbeddingJob).toHaveBeenCalledWith("u1", "mat-1");
    });
  });
});
