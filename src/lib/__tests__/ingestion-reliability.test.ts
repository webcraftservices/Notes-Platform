import { beforeEach, describe, expect, it, vi } from "vitest";

// The Prisma client can't be generated in every environment; only the two
// SQL-fragment helpers ingestion.ts uses are needed, and they're inert here.
vi.mock("@prisma/client", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    join: (rows: unknown[]) => ({ rows }),
  },
}));

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  materialChunk: { deleteMany: vi.fn() },
  processingJob: { update: vi.fn() },
}));
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  processingJob: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  material: { findUnique: vi.fn() },
  transcript: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/observability/datadog", () => ({ sendDatadogMetric: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/ai-usage", () => ({ recordAIUsage: vi.fn().mockResolvedValue(undefined) }));

const embedding = vi.hoisted(() => ({ embed: vi.fn() }));
vi.mock("@/lib/services/embedding", () => ({
  EMBEDDING_DIMENSIONS: 1536,
  getEmbeddingService: () => ({ dimensions: 1536, providerName: "openai", modelName: "m", embed: embedding.embed }),
}));

import { queueEmbeddingJob, runEmbeddingJob } from "@/lib/ingestion";

/** ~n chunks' worth of words (chunking is 220 words with 40 overlap → 180-word stride). */
function textForChunks(n: number): string {
  return Array.from({ length: n * 180 + 40 }, (_, i) => `w${i}`).join(" ");
}

describe("runEmbeddingJob — index write reliability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.$executeRaw.mockResolvedValue(1);
    db.processingJob.findUnique.mockResolvedValue({ id: "job-1", type: "EMBEDDING", materialId: "mat-1", userId: "u1" });
    db.processingJob.updateMany.mockResolvedValue({ count: 1 });
    db.material.findUnique.mockResolvedValue({
      id: "mat-1",
      type: "PDF",
      ownerId: "u1",
      workspaceId: "w1",
      extractedPages: null,
      extractedText: textForChunks(120),
    });
    embedding.embed.mockImplementation(async (texts: string[]) => ({
      vectors: texts.map(() => Array.from({ length: 1536 }, () => 0.1)),
      totalTokens: texts.length,
    }));
  });

  it("writes a large document in multi-row batches inside ONE transaction with an explicit timeout (Prisma's 5s default would roll back after the paid embedding calls)", async () => {
    await runEmbeddingJob("job-1");

    const chunkCount = embedding.embed.mock.calls[0]![0].length;
    expect(chunkCount).toBeGreaterThanOrEqual(100);

    // 1 advisory-lock statement + ceil(chunks / 50) INSERT statements — NOT one per chunk.
    const inserts = tx.$executeRaw.mock.calls.length - 1;
    expect(inserts).toBe(Math.ceil(chunkCount / 50));
    expect(inserts).toBeLessThan(chunkCount);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const options = db.$transaction.mock.calls[0]![1];
    expect(options.timeout).toBeGreaterThanOrEqual(30_000);
  });

  it("serializes concurrent writers for the same material with an advisory lock taken before the delete", async () => {
    const order: string[] = [];
    tx.$executeRaw.mockImplementation(async (strings: TemplateStringsArray) => void order.push(strings.join("?").includes("pg_advisory_xact_lock") ? "lock" : "insert"));
    tx.materialChunk.deleteMany.mockImplementation(async () => void order.push("delete"));

    await runEmbeddingJob("job-1");

    expect(order.slice(0, 2)).toEqual(["lock", "delete"]);
    expect(order[2]).toBe("insert");
  });

  it("marks the job SUCCEEDED in the same transaction that writes the chunks", async () => {
    await runEmbeddingJob("job-1");
    expect(tx.processingJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    });
  });

  it("records a provider failure as FAILED without throwing, and never touches chunks", async () => {
    embedding.embed.mockRejectedValue(new Error("OpenAI embeddings request failed: (503) unavailable"));

    await expect(runEmbeddingJob("job-1")).resolves.toBeUndefined();

    expect(tx.materialChunk.deleteMany).not.toHaveBeenCalled();
    expect(db.processingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1", status: { in: ["QUEUED", "RUNNING"] } },
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });

  it("does not run at all when another runner already claimed the job", async () => {
    db.processingJob.updateMany.mockResolvedValue({ count: 0 }); // claimJob loses

    await runEmbeddingJob("job-1");

    expect(db.material.findUnique).not.toHaveBeenCalled();
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it("does not leak an unhandled rejection when the database itself is down", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.processingJob.findUnique.mockRejectedValue(new Error("connection refused"));
    db.processingJob.updateMany.mockRejectedValue(new Error("connection refused"));

    await expect(runEmbeddingJob("job-1")).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });
});

describe("queueEmbeddingJob", () => {
  beforeEach(() => vi.resetAllMocks());

  it("is best-effort: a failure to queue indexing never throws into the caller that already succeeded", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.processingJob.create.mockRejectedValue(new Error("connection terminated"));

    await expect(queueEmbeddingJob("u1", "mat-1")).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
