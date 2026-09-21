import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  transcript: { upsert: vi.fn() },
  transcriptSegment: { deleteMany: vi.fn(), createMany: vi.fn() },
  processingJob: { update: vi.fn() },
}));
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  processingJob: { findUnique: vi.fn(), updateMany: vi.fn() },
  material: { findUnique: vi.fn() },
  transcript: { updateMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/observability/datadog", () => ({ sendDatadogMetric: vi.fn() }));

const queue = vi.hoisted(() => ({ queueEmbeddingJob: vi.fn() }));
vi.mock("@/lib/ingestion", () => queue);

const speech = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock("@/lib/services/speech", () => ({ getSpeechService: () => speech }));

vi.mock("@/lib/services/storage", () => ({ getStorageService: vi.fn() }));

import { runTranscriptionJob } from "@/lib/transcription";
import { getStorageService } from "@/lib/services/storage";
import { LocalStorageService } from "@/lib/services/storage-local";

const job = { id: "job-1", type: "TRANSCRIPTION", materialId: "mat-1", userId: "user-1" };

describe("runTranscriptionJob — failure handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const storage = Object.create(LocalStorageService.prototype) as LocalStorageService;
    storage.readFile = vi.fn().mockResolvedValue(Buffer.from("audio"));
    vi.mocked(getStorageService).mockReturnValue(storage);

    db.processingJob.findUnique.mockResolvedValue(job);
    db.processingJob.updateMany.mockResolvedValue({ count: 1 });
    db.material.findUnique.mockResolvedValue({ id: "mat-1", topicId: "t", storageKey: "k", mimeType: "audio/mpeg" });
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    db.transcript.updateMany.mockResolvedValue({ count: 0 });
    tx.transcript.upsert.mockResolvedValue({ id: "tr-1" });
    speech.transcribe.mockResolvedValue({ language: "en", segments: [{ startSeconds: 0, endSeconds: 3, text: "hello" }] });
  });

  const failedJobWrites = () => db.processingJob.updateMany.mock.calls.filter(([a]) => a.data?.status === "FAILED");

  it("does NOT report a committed, successful transcription as failed when queueing indexing afterwards fails", async () => {
    queue.queueEmbeddingJob.mockRejectedValue(new Error("connection terminated")); // even a misbehaving queue must not flip the result

    await runTranscriptionJob("job-1").catch(() => undefined);

    expect(tx.processingJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) }));
    expect(failedJobWrites()).toHaveLength(0);
    expect(db.transcript.updateMany).not.toHaveBeenCalled();
  });

  it("queues indexing after a successful transcription", async () => {
    queue.queueEmbeddingJob.mockResolvedValue(undefined);
    await runTranscriptionJob("job-1");
    expect(queue.queueEmbeddingJob).toHaveBeenCalledWith("user-1", "mat-1");
  });

  it("a failed (re-)run never demotes a transcript that is already READY", async () => {
    speech.transcribe.mockRejectedValue(new Error("AssemblyAI upload failed (500)"));

    await runTranscriptionJob("job-1");

    expect(failedJobWrites()).toHaveLength(1);
    expect(db.transcript.updateMany).toHaveBeenCalledWith({
      where: { materialId: "mat-1", status: { not: "READY" } },
      data: { status: "FAILED" },
    });
    expect(queue.queueEmbeddingJob).not.toHaveBeenCalled();
  });

  it("never rejects — even when the database is down while recording the failure — so `void runTranscriptionJob()` can't crash the process", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.processingJob.findUnique.mockRejectedValue(new Error("connection refused"));
    db.processingJob.updateMany.mockRejectedValue(new Error("connection refused"));

    await expect(runTranscriptionJob("job-1")).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });

  it("does not run a job that another runner already claimed (no second paid provider call)", async () => {
    db.processingJob.updateMany.mockResolvedValue({ count: 0 });

    await runTranscriptionJob("job-1");

    expect(speech.transcribe).not.toHaveBeenCalled();
  });
});
