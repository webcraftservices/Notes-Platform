/**
 * src/lib/search/__tests__/note-embedding.test.ts
 *
 * Comprehensive Vitest suite for Note chunking, content hashing,
 * advisory locking, atomic invalidation, and concurrency control.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @prisma/client sql and join helpers
vi.mock("@prisma/client", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    join: (rows: unknown[]) => ({ rows }),
  },
}));

// Mock transaction and db clients
const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  noteChunk: { deleteMany: vi.fn() },
  note: { findUnique: vi.fn() },
}));

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  note: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  noteChunk: { findMany: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

// Mock AI usage recorder
const recordAIUsageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/ai-usage", () => ({ recordAIUsage: recordAIUsageMock }));

// Mock embedding service
const mockEmbed = vi.hoisted(() => vi.fn());
const mockEmbeddingService = {
  dimensions: 1536,
  providerName: "openai",
  modelName: "text-embedding-3-small",
  embed: mockEmbed,
};

vi.mock("@/lib/services/embedding", () => ({
  EMBEDDING_DIMENSIONS: 1536,
  getEmbeddingService: () => mockEmbeddingService,
}));

import {
  chunkNoteText,
  computeContentHash,
  computeChunksHash,
  syncNoteChunksAndEmbeddings,
  syncNoteSearchIndex,
  backfillNotesSearchIndex,
  deleteNoteChunks,
} from "@/lib/search/note-embedding";

function generateWords(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
}

describe("Note Chunking (chunkNoteText)", () => {
  it("returns empty array for empty or whitespace-only text", () => {
    expect(chunkNoteText("")).toEqual([]);
    expect(chunkNoteText("   \n\t  ")).toEqual([]);
  });

  it("returns a single chunk for notes under 220 words", () => {
    const text = "Overview\n\nThis is a short note explaining basic cell biology.";
    const chunks = chunkNoteText(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.order).toBe(0);
    expect(chunks[0]!.content).toBe("Overview This is a short note explaining basic cell biology.");
    expect(chunks[0]!.tokenCount).toBe(10);
  });

  it("splits multi-paragraph long notes into overlapping chunks of 220 words", () => {
    // 500 words
    const longText = generateWords(500);
    const chunks = chunkNoteText(longText, { chunkWords: 220, overlapWords: 40 });

    // Step is 220 - 40 = 180 words. ceil((500 - 40) / 180) = ceil(460 / 180) = 3 chunks
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.tokenCount).toBe(220);
    expect(chunks[1]!.tokenCount).toBe(220);
    expect(chunks[2]!.tokenCount).toBe(140); // remaining words
    expect(chunks[0]!.order).toBe(0);
    expect(chunks[1]!.order).toBe(1);
    expect(chunks[2]!.order).toBe(2);

    // Verify 40-word overlap between chunk 0 and chunk 1
    const chunk0Words = chunks[0]!.content.split(" ");
    const chunk1Words = chunks[1]!.content.split(" ");
    expect(chunk0Words.slice(-40)).toEqual(chunk1Words.slice(0, 40));
  });
});

describe("Content Hashing (computeContentHash & computeChunksHash)", () => {
  it("produces deterministic SHA-256 hex digests", () => {
    const hash1 = computeContentHash("Hello world");
    const hash2 = computeContentHash("Hello world");
    const hash3 = computeContentHash("Hello world!");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64);
  });

  it("normalizes outer whitespace when hashing", () => {
    expect(computeContentHash("  hello  ")).toBe(computeContentHash("hello"));
  });

  it("produces consistent hash across chunks array", () => {
    const hashA = computeChunksHash(["chunk 1", "chunk 2"]);
    const hashB = computeChunksHash(["chunk 1", "chunk 2"]);
    const hashC = computeChunksHash(["chunk 1", "chunk 2 modified"]);

    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);
  });
});

describe("syncNoteChunksAndEmbeddings Lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.$executeRaw.mockResolvedValue(1);
    tx.noteChunk.deleteMany.mockResolvedValue({ count: 1 });
    tx.note.findUnique.mockResolvedValue({ plainText: null });

    db.note.findUnique.mockResolvedValue({
      id: "note-1",
      plainText: "Initial note text",
      authorId: "user-1",
      topic: { chapter: { subject: { workspaceId: "ws-1" } } },
    });

    db.noteChunk.findMany.mockResolvedValue([]);

    mockEmbed.mockImplementation(async (texts: string[]) => ({
      vectors: texts.map(() => Array.from({ length: 1536 }, () => 0.05)),
      totalTokens: texts.length * 50,
    }));
  });

  it("skips OpenAI embedding when existing chunk content hash matches", async () => {
    const plainText = "Biology lecture on photosynthesis and light reactions.";
    const chunks = chunkNoteText(plainText);

    // Simulate existing chunks already in DB matching new content
    db.noteChunk.findMany.mockResolvedValue(chunks.map((c) => ({ content: c.content })));

    const result = await syncNoteChunksAndEmbeddings("note-1", plainText);

    expect(result.embedded).toBe(false);
    expect(result.skippedReason).toBe("content_unchanged");
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("embeds and writes chunks when content has changed", async () => {
    const plainText = "Updated note text with new findings.";
    db.noteChunk.findMany.mockResolvedValue([{ content: "Old note text" }]);

    const result = await syncNoteChunksAndEmbeddings("note-1", plainText);

    expect(result.embedded).toBe(true);
    expect(result.chunkCount).toBe(1);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(recordAIUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "embedding",
        userId: "user-1",
        tokensInput: 50,
      })
    );
  });

  it("forces re-embedding when force: true even if hash matches", async () => {
    const plainText = "Static note text.";
    const chunks = chunkNoteText(plainText);
    db.noteChunk.findMany.mockResolvedValue(chunks.map((c) => ({ content: c.content })));

    const result = await syncNoteChunksAndEmbeddings("note-1", plainText, { force: true });

    expect(result.embedded).toBe(true);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });

  it("cleans existing chunks and skips embedding when note is empty", async () => {
    const result = await syncNoteChunksAndEmbeddings("note-1", "    \n   ");

    expect(result.chunkCount).toBe(0);
    expect(result.embedded).toBe(false);
    expect(result.skippedReason).toBe("empty_content");
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(tx.noteChunk.deleteMany).toHaveBeenCalledWith({ where: { noteId: "note-1" } });
  });

  it("serializes concurrent writers with pg_advisory_xact_lock before chunk deletion", async () => {
    const operations: string[] = [];
    tx.$executeRaw.mockImplementation(async (query: any) => {
      const str = query.strings ? query.strings.join("?") : String(query);
      if (str.includes("pg_advisory_xact_lock")) {
        operations.push("lock");
      } else if (str.includes("INSERT INTO \"NoteChunk\"")) {
        operations.push("insert");
      }
      return 1;
    });

    tx.noteChunk.deleteMany.mockImplementation(async () => {
      operations.push("delete");
      return { count: 1 };
    });

    await syncNoteChunksAndEmbeddings("note-1", "Sample note content to embed");

    expect(operations).toEqual(["lock", "delete", "insert"]);
  });

  it("aborts chunk write if note content was superseded by a newer save during embedding", async () => {
    const originalText = "Original version that took 2 seconds to embed";
    const newerText = "Newer version already committed to DB by another request";

    // Simulate note having updated plainText when checking inside transaction
    tx.note.findUnique.mockResolvedValue({ plainText: newerText });

    const result = await syncNoteChunksAndEmbeddings("note-1", originalText);

    expect(result.embedded).toBe(false);
    expect(result.skippedReason).toBe("superseded");
    expect(tx.noteChunk.deleteMany).not.toHaveBeenCalled();
  });

  it("batches chunk inserts in groups of 50 inside transaction", async () => {
    // 120 chunks of text
    const words = Array.from({ length: 120 * 180 + 40 }, (_, i) => `w${i}`).join(" ");

    await syncNoteChunksAndEmbeddings("note-1", words);

    // 1 lock query + ceil(120 / 50) = 3 insert queries
    const insertCalls = tx.$executeRaw.mock.calls.filter((call) => {
      const queryStr = Array.isArray(call[0])
        ? call[0].join("?")
        : call[0]?.strings
        ? call[0].strings.join("?")
        : String(call[0]);
      return queryStr.includes('INSERT INTO "NoteChunk"');
    });
    expect(insertCalls.length).toBe(3);
  });

  it("throws clear error when embedding service dimensions mismatch EMBEDDING_DIMENSIONS", async () => {
    const badService = {
      ...mockEmbeddingService,
      dimensions: 768, // mismatch with 1536
    };

    await expect(
      syncNoteChunksAndEmbeddings("note-1", "Text", { embeddingService: badService })
    ).rejects.toThrow(/dimensions/);

    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it("resolves note plainText and authorId from db when not provided directly", async () => {
    const result = await syncNoteChunksAndEmbeddings("note-1");

    expect(db.note.findUnique).toHaveBeenCalledWith({
      where: { id: "note-1" },
      select: expect.objectContaining({
        id: true,
        plainText: true,
        authorId: true,
      }),
    });
    expect(result.embedded).toBe(true);
  });
});

describe("deleteNoteChunks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.$executeRaw.mockResolvedValue(1);
    tx.noteChunk.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("deletes note chunks within advisory lock transaction", async () => {
    await deleteNoteChunks("note-1");

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.noteChunk.deleteMany).toHaveBeenCalledWith({ where: { noteId: "note-1" } });
  });
});

describe("syncNoteSearchIndex & backfillNotesSearchIndex", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.$executeRaw.mockResolvedValue(1);
    tx.noteChunk.deleteMany.mockResolvedValue({ count: 1 });
    tx.note.findUnique.mockResolvedValue({ plainText: null });
    db.noteChunk.findMany.mockResolvedValue([]);
    db.noteChunk.deleteMany.mockResolvedValue({ count: 0 });
    mockEmbed.mockImplementation(async (texts: string[]) => ({
      vectors: texts.map(() => Array.from({ length: 1536 }, () => 0.05)),
      totalTokens: texts.length * 40,
    }));
  });

  it("retries transient embedding errors when maxRetries > 0 and succeeds on retry", async () => {
    mockEmbed
      .mockRejectedValueOnce(new Error("Transient 503 OpenAI failure"))
      .mockImplementationOnce(async (texts: string[]) => ({
        vectors: texts.map(() => Array.from({ length: 1536 }, () => 0.05)),
        totalTokens: texts.length * 40,
      }));

    const res = await syncNoteSearchIndex("note-1", "Updated content after retry", {
      userId: "user-1",
      maxRetries: 1,
    });

    expect(res.embedded).toBe(true);
    expect(mockEmbed).toHaveBeenCalledTimes(2);
  });

  it("purges stale NoteChunk rows when embedding fails after note content changed", async () => {
    db.noteChunk.findMany.mockResolvedValue([{ content: "Old sensitive note content" }]);
    mockEmbed.mockRejectedValue(new Error("ServiceNotConfiguredError: OPENAI_API_KEY missing"));

    const res = await syncNoteSearchIndex("note-1", "New replacement note content", {
      userId: "user-1",
      maxRetries: 0,
    });

    expect(res.embedded).toBe(false);
    expect(res.skippedReason).toBe("embedding_failed");
    // Must invalidate stale chunks so old deleted text cannot remain discoverable via vector search
    expect(tx.noteChunk.deleteMany).toHaveBeenCalledWith({ where: { noteId: "note-1" } });
  });

  it("backfills plainText and embeddings for active notes and purges chunks for soft-deleted notes when allowGlobalBackfill: true is set", async () => {
    db.note.findMany
      .mockResolvedValueOnce([{ id: "deleted-note-1" }]) // soft-deleted notes
      .mockResolvedValueOnce([
        {
          id: "active-note-1",
          title: "Photosynthesis",
          plainText: null,
          authorId: "user-1",
          blocks: [
            {
              heading: "Chloroplast",
              content: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Light reactions in thylakoid." }] }],
              },
              order: 0,
            },
          ],
        },
      ]);
    db.noteChunk.deleteMany.mockResolvedValueOnce({ count: 2 });
    db.note.update.mockResolvedValue({});

    const summary = await backfillNotesSearchIndex({ allowGlobalBackfill: true });

    expect(summary).toEqual({
      processedNotes: 1,
      updatedPlainTextCount: 1,
      embeddedNotesCount: 1,
      purgedDeletedNoteChunks: 2,
    });
    expect(db.note.update).toHaveBeenCalledWith({
      where: { id: "active-note-1" },
      data: { plainText: "Photosynthesis\n\nChloroplast\nLight reactions in thylakoid." },
    });
  });

  it("restricts database queries to explicit noteIds when scoped noteIds are provided", async () => {
    db.note.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "scoped-note-1",
          title: "Scoped Note",
          plainText: "Scoped Note\n\nScoped content",
          authorId: "user-1",
          blocks: [],
        },
      ]);

    const summary = await backfillNotesSearchIndex({
      noteIds: ["scoped-note-1"],
      embeddingService: mockEmbeddingService,
    });

    expect(summary).toEqual({
      processedNotes: 1,
      updatedPlainTextCount: 0,
      embeddedNotesCount: 1,
      purgedDeletedNoteChunks: 0,
    });
    expect(db.note.findMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ["scoped-note-1"] }, deletedAt: { not: null } },
      select: { id: true },
    });
    expect(db.note.findMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ["scoped-note-1"] }, deletedAt: null },
      include: { blocks: { orderBy: { order: "asc" } } },
    });
  });

  it("rejects unauthorized global backfillNotesSearchIndex when neither noteIds nor allowGlobalBackfill: true is provided", async () => {
    await expect(backfillNotesSearchIndex()).rejects.toThrow(
      /Refusing unscoped global backfillNotesSearchIndex without explicit authorization/i
    );
    await expect(backfillNotesSearchIndex({})).rejects.toThrow(
      /Refusing unscoped global backfillNotesSearchIndex without explicit authorization/i
    );
    await expect(backfillNotesSearchIndex({ allowGlobalBackfill: false })).rejects.toThrow(
      /Refusing unscoped global backfillNotesSearchIndex without explicit authorization/i
    );

    expect(db.note.findMany).not.toHaveBeenCalled();
  });

  it("rejects unscoped backfillNotesSearchIndex when a custom embeddingService is injected without explicit noteIds (even if allowGlobalBackfill: true)", async () => {
    await expect(
      backfillNotesSearchIndex({
        embeddingService: mockEmbeddingService,
      })
    ).rejects.toThrow(/explicit non-empty noteIds are required/i);

    await expect(
      backfillNotesSearchIndex({
        embeddingService: mockEmbeddingService,
        allowGlobalBackfill: true,
      })
    ).rejects.toThrow(/explicit non-empty noteIds are required/i);

    await expect(
      backfillNotesSearchIndex({
        embeddingService: mockEmbeddingService,
        noteIds: [],
      })
    ).rejects.toThrow(/explicit non-empty noteIds are required/i);

    expect(db.note.findMany).not.toHaveBeenCalled();
  });
});
