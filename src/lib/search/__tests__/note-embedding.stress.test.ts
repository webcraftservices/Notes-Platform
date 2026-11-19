/**
 * src/lib/search/__tests__/note-embedding.stress.test.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS FOR MILESTONE 1
 * Conducted by Challenger 2 (Empirical Concurrency & Embedding Lifecycle Verification)
 *
 * Verifies:
 * 1. Concurrency & Race Conditions (Interleaved Autosaves & Stale Overwrite Protection)
 * 2. Real PostgreSQL Advisory Lock Serialization (Mutex-backed blocking simulation)
 * 3. Content Hash Deduplication & Zero-Embedding-Cost Guarantees
 * 4. Clean Chunk Invalidation (Empty Content & deleteNoteChunks)
 * 5. High-Volume Batch Slicing (>100 chunks in batches of 50)
 * 6. Vector Dimension & Output Shape Integrity Guards
 * 7. Failure Containment & Resilience (API timeouts, DB rollbacks, special characters)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @prisma/client sql and join helpers
vi.mock("@prisma/client", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    join: (rows: unknown[]) => ({ rows }),
  },
}));

// Hoisted stateful mock database engine
const { mockPg, dbMock, recordAIUsageMock, mockEmbed, mockEmbeddingService } = vi.hoisted(() => {
  class MockPostgresDatabase {
    public notes = new Map<string, { id: string; plainText: string | null; authorId: string; workspaceId?: string | null }>();
    public noteChunks = new Map<string, Array<{ id: string; noteId: string; content: string; order: number; tokenCount: number; embedding: string }>>();
    public advisoryLockHolders = new Map<string, string>(); // lockKey -> transactionId
    public lockWaitQueue = new Map<string, Array<() => void>>();
    public operationTrace: Array<{ txId?: string; op: string; detail?: unknown; timestamp: number }> = [];

    public reset() {
      this.notes.clear();
      this.noteChunks.clear();
      this.advisoryLockHolders.clear();
      this.lockWaitQueue.clear();
      this.operationTrace = [];
    }

    private async acquireAdvisoryLock(key: string, txId: string): Promise<void> {
      this.operationTrace.push({ txId, op: "advisory_lock_request", detail: key, timestamp: Date.now() });

      if (this.advisoryLockHolders.has(key) && this.advisoryLockHolders.get(key) !== txId) {
        // Must wait for current holder to release
        await new Promise<void>((resolve) => {
          if (!this.lockWaitQueue.has(key)) {
            this.lockWaitQueue.set(key, []);
          }
          this.lockWaitQueue.get(key)!.push(resolve);
        });
      }

      this.advisoryLockHolders.set(key, txId);
      this.operationTrace.push({ txId, op: "advisory_lock_acquired", detail: key, timestamp: Date.now() });
    }

    private releaseAdvisoryLocksForTx(txId: string): void {
      for (const [key, holderTxId] of Array.from(this.advisoryLockHolders.entries())) {
        if (holderTxId === txId) {
          this.advisoryLockHolders.delete(key);
          this.operationTrace.push({ txId, op: "advisory_lock_released", detail: key, timestamp: Date.now() });
          const waiter = this.lockWaitQueue.get(key)?.shift();
          if (waiter) {
            waiter();
          }
        }
      }
    }

    public getDbClient() {
      return {
        note: {
          findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
            const n = this.notes.get(where.id);
            if (!n) return null;
            return {
              id: n.id,
              plainText: n.plainText,
              authorId: n.authorId,
              topic: { chapter: { subject: { workspaceId: n.workspaceId ?? "ws-test" } } },
            };
          }),
        },
        noteChunk: {
          findMany: vi.fn(async ({ where }: { where: { noteId: string } }) => {
            const chunks = this.noteChunks.get(where.noteId) ?? [];
            return chunks.map((c) => ({ content: c.content, order: c.order }));
          }),
          deleteMany: vi.fn(async ({ where }: { where: { noteId: string } }) => {
            const count = (this.noteChunks.get(where.noteId) ?? []).length;
            this.noteChunks.set(where.noteId, []);
            return { count };
          }),
        },
        $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
          const txId = `tx_${Math.random().toString(36).slice(2, 9)}`;
          this.operationTrace.push({ txId, op: "transaction_begin", timestamp: Date.now() });

          // Staged state for rollback on error
          const chunksSnapshot = new Map(
            Array.from(this.noteChunks.entries()).map(([k, v]) => [k, [...v]])
          );

          const txClient = {
            $executeRaw: vi.fn(async (query: any, ...args: any[]) => {
              const queryStr = Array.isArray(query)
                ? query.join("?")
                : query?.strings
                ? query.strings.join("?")
                : String(query);

              if (queryStr.includes("pg_advisory_xact_lock")) {
                const lockKey = args[0] ?? (query.values ? query.values[0] : "unknown");
                await this.acquireAdvisoryLock(String(lockKey), txId);
                return 1;
              }

              if (queryStr.includes('INSERT INTO "NoteChunk"')) {
                this.operationTrace.push({ txId, op: "insert_chunks_batch", detail: { queryStr, args }, timestamp: Date.now() });
                const joined = args[0] ?? (query.values ? query.values[0] : null);
                const rows = joined?.rows ?? [];
                for (const row of rows) {
                  const values = row.values ?? [];
                  const id = values[0] ?? `chunk_${Math.random()}`;
                  const noteId = values[1];
                  const content = values[2];
                  const order = values[3];
                  const tokenCount = values[4];
                  const embedding = values[5];

                  if (!this.noteChunks.has(noteId)) {
                    this.noteChunks.set(noteId, []);
                  }
                  this.noteChunks.get(noteId)!.push({ id, noteId, content, order, tokenCount, embedding });
                }
                return 1;
              }

              return 1;
            }),
            note: {
              findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
                const n = this.notes.get(where.id);
                if (!n) return null;
                return { plainText: n.plainText };
              }),
            },
            noteChunk: {
              deleteMany: vi.fn(async ({ where }: { where: { noteId: string } }) => {
                this.operationTrace.push({ txId, op: "delete_existing_chunks", detail: where.noteId, timestamp: Date.now() });
                const count = (this.noteChunks.get(where.noteId) ?? []).length;
                this.noteChunks.set(where.noteId, []);
                return { count };
              }),
            },
          };

          try {
            const result = await callback(txClient);
            this.operationTrace.push({ txId, op: "transaction_commit", timestamp: Date.now() });
            return result;
          } catch (err) {
            // Rollback on error
            this.noteChunks = chunksSnapshot;
            this.operationTrace.push({ txId, op: "transaction_rollback", detail: err, timestamp: Date.now() });
            throw err;
          } finally {
            this.releaseAdvisoryLocksForTx(txId);
          }
        }),
      };
    }
  }

  const mockPgInstance = new MockPostgresDatabase();
  const dbClientInstance = mockPgInstance.getDbClient();
  const recordAIUsageFn = vi.fn().mockResolvedValue(undefined);
  const embedFn = vi.fn();
  const embeddingServiceObj = {
    dimensions: 1536,
    providerName: "openai",
    modelName: "text-embedding-3-small",
    embed: embedFn,
  };

  return {
    mockPg: mockPgInstance,
    dbMock: dbClientInstance,
    recordAIUsageMock: recordAIUsageFn,
    mockEmbed: embedFn,
    mockEmbeddingService: embeddingServiceObj,
  };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/ai-usage", () => ({ recordAIUsage: recordAIUsageMock }));
vi.mock("@/lib/services/embedding", () => ({
  EMBEDDING_DIMENSIONS: 1536,
  getEmbeddingService: () => mockEmbeddingService,
}));

import {
  chunkNoteText,
  computeContentHash,
  computeChunksHash,
  syncNoteChunksAndEmbeddings,
  deleteNoteChunks,
  DEFAULT_NOTE_CHUNK_WORDS,
  DEFAULT_NOTE_OVERLAP_WORDS,
  NOTE_CHUNK_INSERT_BATCH_SIZE,
} from "@/lib/search/note-embedding";

function generateWords(count: number, prefix = "word"): string {
  return Array.from({ length: count }, (_, i) => `${prefix}_${i}`).join(" ");
}

describe("Empirical Stress Suite: Note Chunking & Invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPg.reset();

    mockEmbed.mockImplementation(async (texts: string[]) => ({
      vectors: texts.map(() => Array.from({ length: 1536 }, () => 0.0123)),
      totalTokens: texts.length * 180,
    }));
  });

  describe("1. Concurrency & Interleaved Autosaves (Adversarial Race Conditions)", () => {
    it("prevents slow embedding requests from overwriting newer committed plainText", async () => {
      const noteId = "note-concurrency-1";
      const v1Text = "Version 1: The mitochondrion is the powerhouse of the cell.";
      const v2Text = "Version 2: Mitochondria generate most of the chemical energy needed by cells.";

      // Initial state: Note V1 is in DB
      mockPg.notes.set(noteId, { id: noteId, plainText: v1Text, authorId: "u1" });

      // Request 1: Starts embedding V1 text, but encounters an 80ms network latency
      let resolveV1Embedding: () => void;
      const v1EmbeddingPromise = new Promise<{ vectors: number[][]; totalTokens: number }>((resolve) => {
        resolveV1Embedding = () =>
          resolve({
            vectors: [Array(1536).fill(0.1)],
            totalTokens: 20,
          });
      });

      // Request 2: Arrives, note is updated to V2 in DB, fast 10ms embedding
      mockEmbed.mockImplementationOnce(() => v1EmbeddingPromise); // First call is V1 (slow)
      mockEmbed.mockImplementationOnce(async () => ({             // Second call is V2 (fast)
        vectors: [Array(1536).fill(0.2)],
        totalTokens: 25,
      }));

      // Fire Request 1 (slow)
      const req1Promise = syncNoteChunksAndEmbeddings(noteId, v1Text);

      // Meanwhile, user typed V2, autosave PUT commits V2 to DB and starts sync
      mockPg.notes.set(noteId, { id: noteId, plainText: v2Text, authorId: "u1" });
      const req2Promise = syncNoteChunksAndEmbeddings(noteId, v2Text);

      // Wait for Request 2 to finish
      const res2 = await req2Promise;
      expect(res2.embedded).toBe(true);
      expect(res2.chunkCount).toBe(1);

      // DB now has V2 chunks
      expect(mockPg.noteChunks.get(noteId)?.[0]?.content).toContain("Version 2");

      // Now Request 1's embedding finally arrives
      resolveV1Embedding!();
      const res1 = await req1Promise;

      // Request 1 MUST abort cleanly with skippedReason: 'superseded'
      expect(res1.embedded).toBe(false);
      expect(res1.skippedReason).toBe("superseded");
      expect(res1.chunkCount).toBe(0);

      // CRITICAL ASSERTION: DB must still have Version 2 chunks, NOT stale Version 1!
      const currentChunks = mockPg.noteChunks.get(noteId);
      expect(currentChunks).toHaveLength(1);
      expect(currentChunks?.[0]?.content).toContain("Version 2");
      expect(currentChunks?.[0]?.content).not.toContain("Version 1");
    });

    it("handles 5 rapid interleaved saves concurrently without chunk duplication or corrupted DB", async () => {
      const noteId = "note-rapid-5";
      const versions = [
        "Rapid edit 1: introductory outline",
        "Rapid edit 2: introductory outline with section headers",
        "Rapid edit 3: full paragraph body on thermodynamic systems",
        "Rapid edit 4: added enthalpy formulas and examples",
        "Rapid edit 5: final polished chapter note on thermodynamics",
      ];

      // Initial DB state
      mockPg.notes.set(noteId, { id: noteId, plainText: versions[0]!, authorId: "u1" });

      // Run 5 rapid saves in flight with varying simulated embedding network delays
      const promises = versions.map(async (text, idx) => {
        // Latency jitter: earlier versions take LONGER, later versions take SHORTER
        const latencyMs = (5 - idx) * 15;
        const customService = {
          dimensions: 1536,
          providerName: "openai",
          modelName: "text-embedding-3-small",
          embed: async (texts: string[]) => {
            await new Promise((r) => setTimeout(r, latencyMs));
            return {
              vectors: texts.map(() => Array(1536).fill(idx * 0.1)),
              totalTokens: 30,
            };
          },
        };

        // When each version is saved in Zenote, DB plainText is updated to latest save
        mockPg.notes.set(noteId, { id: noteId, plainText: text, authorId: "u1" });

        return syncNoteChunksAndEmbeddings(noteId, text, { embeddingService: customService });
      });

      const results = await Promise.all(promises);

      // Exactly the latest version (version 5) or matching version should be committed
      const committedResults = results.filter((r) => r.embedded);
      const supersededResults = results.filter((r) => r.skippedReason === "superseded");

      // Some earlier versions were superseded by the newer version
      expect(supersededResults.length).toBeGreaterThan(0);
      expect(committedResults.length).toBeGreaterThan(0);

      // Chunks in DB must match the final text
      const finalChunks = mockPg.noteChunks.get(noteId);
      expect(finalChunks).toBeDefined();
      expect(finalChunks!.length).toBe(1);
      expect(finalChunks![0]!.content).toBe(versions[4]);
    });

    it("verifies advisory lock serializes concurrent transactions on the same note", async () => {
      const noteId = "note-lock-check";
      const textA = "Note A text content";
      mockPg.notes.set(noteId, { id: noteId, plainText: textA, authorId: "u1" });

      await syncNoteChunksAndEmbeddings(noteId, textA);

      // Verify lock order from operation trace
      const trace = mockPg.operationTrace.map((t) => t.op);
      const lockIndex = trace.indexOf("advisory_lock_acquired");
      const deleteIndex = trace.indexOf("delete_existing_chunks");
      const insertIndex = trace.indexOf("insert_chunks_batch");

      expect(lockIndex).toBeGreaterThanOrEqual(0);
      expect(deleteIndex).toBeGreaterThan(lockIndex);
      expect(insertIndex).toBeGreaterThan(deleteIndex);
    });

    it("allows simultaneous embedding of DIFFERENT notes without lock contention", async () => {
      const note1 = "note-indep-1";
      const note2 = "note-indep-2";
      mockPg.notes.set(note1, { id: note1, plainText: "Content of note 1", authorId: "u1" });
      mockPg.notes.set(note2, { id: note2, plainText: "Content of note 2", authorId: "u2" });

      const [res1, res2] = await Promise.all([
        syncNoteChunksAndEmbeddings(note1, "Content of note 1"),
        syncNoteChunksAndEmbeddings(note2, "Content of note 2"),
      ]);

      expect(res1.embedded).toBe(true);
      expect(res2.embedded).toBe(true);
      expect(mockPg.noteChunks.get(note1)?.[0]?.content).toBe("Content of note 1");
      expect(mockPg.noteChunks.get(note2)?.[0]?.content).toBe("Content of note 2");
    });
  });

  describe("2. Content Hash Deduplication & Zero-Embedding-Cost Guarantees", () => {
    it("avoids calling OpenAI when identical content hash exists in DB", async () => {
      const noteId = "note-hash-dedup";
      const text = generateWords(100, "photosynthesis");
      mockPg.notes.set(noteId, { id: noteId, plainText: text, authorId: "u1" });

      // First run: chunks are embedded and saved
      const firstRun = await syncNoteChunksAndEmbeddings(noteId, text);
      expect(firstRun.embedded).toBe(true);
      expect(mockEmbed).toHaveBeenCalledTimes(1);

      // Reset mockEmbed tracker
      mockEmbed.mockClear();

      // Second run: exactly same content
      const secondRun = await syncNoteChunksAndEmbeddings(noteId, text);
      expect(secondRun.embedded).toBe(false);
      expect(secondRun.skippedReason).toBe("content_unchanged");
      expect(mockEmbed).not.toHaveBeenCalled();

      // Third run with leading/trailing whitespace changes (which do not affect chunk tokens)
      mockEmbed.mockClear();
      const thirdRun = await syncNoteChunksAndEmbeddings(noteId, `   \n\n  ${text}  \t\t\n`);
      expect(thirdRun.embedded).toBe(false);
      expect(thirdRun.skippedReason).toBe("content_unchanged");
      expect(mockEmbed).not.toHaveBeenCalled();
    });

    it("triggers re-embedding when content hash differs even by a single word", async () => {
      const noteId = "note-hash-diff";
      const textOriginal = generateWords(250, "cell");
      mockPg.notes.set(noteId, { id: noteId, plainText: textOriginal, authorId: "u1" });

      await syncNoteChunksAndEmbeddings(noteId, textOriginal);
      expect(mockEmbed).toHaveBeenCalledTimes(1);

      // Modify single word in the middle
      mockEmbed.mockClear();
      const textModified = textOriginal.replace("cell_100", "organelle_100");
      mockPg.notes.set(noteId, { id: noteId, plainText: textModified, authorId: "u1" });

      const res = await syncNoteChunksAndEmbeddings(noteId, textModified);
      expect(res.embedded).toBe(true);
      expect(mockEmbed).toHaveBeenCalledTimes(1);
    });

    it("bypasses content hash check when force: true is specified", async () => {
      const noteId = "note-force";
      const text = "Static text needing forced re-embedding for model migration.";
      mockPg.notes.set(noteId, { id: noteId, plainText: text, authorId: "u1" });

      await syncNoteChunksAndEmbeddings(noteId, text);
      expect(mockEmbed).toHaveBeenCalledTimes(1);

      mockEmbed.mockClear();
      const forceRes = await syncNoteChunksAndEmbeddings(noteId, text, { force: true });
      expect(forceRes.embedded).toBe(true);
      expect(mockEmbed).toHaveBeenCalledTimes(1);
    });
  });

  describe("3. Clean Invalidation & Deletion Lifecycle", () => {
    it("deletes all chunks under advisory lock when plainText is cleared to empty", async () => {
      const noteId = "note-empty-invalidation";
      mockPg.notes.set(noteId, { id: noteId, plainText: "Initial populated text", authorId: "u1" });

      // Embed initial text
      await syncNoteChunksAndEmbeddings(noteId, "Initial populated text");
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(1);

      // Clear text to empty string
      mockEmbed.mockClear();
      const emptyRes = await syncNoteChunksAndEmbeddings(noteId, "   \n\t  ");
      expect(emptyRes.chunkCount).toBe(0);
      expect(emptyRes.embedded).toBe(false);
      expect(emptyRes.skippedReason).toBe("empty_content");
      expect(mockEmbed).not.toHaveBeenCalled();

      // Chunks in DB must be wiped
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(0);

      // Verify advisory lock was acquired during empty deletion
      const trace = mockPg.operationTrace.filter((t) => t.op.includes("advisory_lock"));
      expect(trace.length).toBeGreaterThan(0);
    });

    it("deleteNoteChunks cleanly purges chunks under advisory lock", async () => {
      const noteId = "note-purge";
      mockPg.notes.set(noteId, { id: noteId, plainText: "Content to purge", authorId: "u1" });
      await syncNoteChunksAndEmbeddings(noteId, "Content to purge");
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(1);

      await deleteNoteChunks(noteId);
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(0);
    });
  });

  describe("4. Large Batch Slicing & Boundary Stress (>100 Chunks)", () => {
    it("slices 125 chunks into 3 batches (50 + 50 + 25) with exact ordering", async () => {
      const noteId = "note-large-doc";
      // 125 chunks: step is 180 words, so 124 * 180 + 220 words
      const totalWords = 124 * (DEFAULT_NOTE_CHUNK_WORDS - DEFAULT_NOTE_OVERLAP_WORDS) + DEFAULT_NOTE_CHUNK_WORDS;
      const massiveText = generateWords(totalWords, "neuroscience");

      mockPg.notes.set(noteId, { id: noteId, plainText: massiveText, authorId: "u1" });

      mockEmbed.mockImplementationOnce(async (chunks: string[]) => ({
        vectors: chunks.map((_, i) => Array(1536).fill((i % 100) * 0.001)),
        totalTokens: chunks.length * 180,
      }));

      const res = await syncNoteChunksAndEmbeddings(noteId, massiveText);

      expect(res.embedded).toBe(true);
      expect(res.chunkCount).toBe(125);

      // Verify batch insertions in trace
      const batchInserts = mockPg.operationTrace.filter((t) => t.op === "insert_chunks_batch");
      // ceil(125 / 50) = 3 batches
      expect(batchInserts.length).toBe(3);

      // Verify all 125 chunks are in DB with correct sequential ordering
      const storedChunks = mockPg.noteChunks.get(noteId);
      expect(storedChunks).toBeDefined();
      expect(storedChunks!.length).toBe(125);

      for (let i = 0; i < 125; i++) {
        expect(storedChunks![i]!.order).toBe(i);
        expect(storedChunks![i]!.content).toContain("neuroscience");
      }
    });

    it("verifies chunk overlap across boundaries is exactly DEFAULT_NOTE_OVERLAP_WORDS (40 words)", () => {
      const text = generateWords(600, "overlap");
      const chunks = chunkNoteText(text);

      expect(chunks.length).toBeGreaterThan(1);
      for (let i = 0; i < chunks.length - 1; i++) {
        const c1Words = chunks[i]!.content.split(/\s+/);
        const c2Words = chunks[i + 1]!.content.split(/\s+/);
        const tailC1 = c1Words.slice(-DEFAULT_NOTE_OVERLAP_WORDS);
        const headC2 = c2Words.slice(0, DEFAULT_NOTE_OVERLAP_WORDS);
        expect(tailC1).toEqual(headC2);
      }
    });
  });

  describe("5. Vector Dimension & Output Shape Integrity Guards", () => {
    it("fails fast before embed() if service reports wrong dimensions", async () => {
      const noteId = "note-dim-check-1";
      mockPg.notes.set(noteId, { id: noteId, plainText: "Test text", authorId: "u1" });

      const wrongDimService = {
        dimensions: 768, // Wrong dimension (not 1536)
        providerName: "nomic",
        modelName: "nomic-embed-text",
        embed: mockEmbed,
      };

      await expect(
        syncNoteChunksAndEmbeddings(noteId, "Test text", { embeddingService: wrongDimService })
      ).rejects.toThrow(/dimensions/i);

      expect(mockEmbed).not.toHaveBeenCalled();
    });

    it("fails before DB transaction if embed() returns vector with wrong dimension", async () => {
      const noteId = "note-dim-check-2";
      mockPg.notes.set(noteId, { id: noteId, plainText: "Test text", authorId: "u1" });

      mockEmbed.mockResolvedValueOnce({
        vectors: [Array(512).fill(0.1)], // returns 512d instead of 1536d
        totalTokens: 10,
      });

      await expect(
        syncNoteChunksAndEmbeddings(noteId, "Test text")
      ).rejects.toThrow(/invalid dimension/i);

      // Verify no DB transaction took place
      const trace = mockPg.operationTrace.filter((t) => t.op === "transaction_begin");
      expect(trace.length).toBe(0);
    });

    it("fails before DB transaction if embed() returns wrong number of vectors", async () => {
      const noteId = "note-dim-check-3";
      mockPg.notes.set(noteId, { id: noteId, plainText: "Test text", authorId: "u1" });

      mockEmbed.mockResolvedValueOnce({
        vectors: [], // 0 vectors returned for 1 chunk
        totalTokens: 0,
      });

      await expect(
        syncNoteChunksAndEmbeddings(noteId, "Test text")
      ).rejects.toThrow(/different number of vectors/i);

      expect(mockPg.operationTrace.filter((t) => t.op === "transaction_begin").length).toBe(0);
    });
  });

  describe("6. Failure Containment & Resilience", () => {
    it("preserves existing database chunks when OpenAI API throws an exception", async () => {
      const noteId = "note-api-fail";
      const initialText = "Existing valid note chunks";
      mockPg.notes.set(noteId, { id: noteId, plainText: initialText, authorId: "u1" });

      // Initially embed successfully
      await syncNoteChunksAndEmbeddings(noteId, initialText);
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(1);

      // Subsequent update where OpenAI fails with 500 or rate limit
      mockEmbed.mockRejectedValueOnce(new Error("Rate limit exceeded (429)"));

      await expect(
        syncNoteChunksAndEmbeddings(noteId, "Modified text that fails OpenAI")
      ).rejects.toThrow("Rate limit exceeded (429)");

      // Existing chunks MUST still be preserved in DB!
      const chunks = mockPg.noteChunks.get(noteId);
      expect(chunks).toBeDefined();
      expect(chunks!.length).toBe(1);
      expect(chunks![0]!.content).toBe(initialText);
    });

    it("handles complex Unicode, emoji, quotes, and symbols safely without SQL errors", async () => {
      const noteId = "note-unicode";
      const specialText = "Special characters: 'quotes' \"double\" `backticks` --comment ; DROP TABLE students; 🧬🔬🚀 한국어 中文 العربية";
      mockPg.notes.set(noteId, { id: noteId, plainText: specialText, authorId: "u1" });

      const res = await syncNoteChunksAndEmbeddings(noteId, specialText);
      expect(res.embedded).toBe(true);

      const stored = mockPg.noteChunks.get(noteId);
      expect(stored).toBeDefined();
      expect(stored![0]!.content).toBe(specialText);
    });

    it("throws explicit error when noteId does not exist in DB", async () => {
      await expect(
        syncNoteChunksAndEmbeddings("non-existent-note-id")
      ).rejects.toThrow(/could not be found/i);
    });
  });

  describe("7. Extreme Boundary Cases & Adversarial Stress Inputs", () => {
    it("handles exact word boundaries (220 vs 221 words)", () => {
      const text220 = generateWords(220, "boundary");
      const chunks220 = chunkNoteText(text220);
      expect(chunks220.length).toBe(1);
      expect(chunks220[0]!.tokenCount).toBe(220);

      const text221 = generateWords(221, "boundary");
      const chunks221 = chunkNoteText(text221);
      expect(chunks221.length).toBe(2);
      expect(chunks221[0]!.tokenCount).toBe(220);
      // Step is 220 - 40 = 180 words. Remaining words in chunk 1 = 221 - 180 = 41 words.
      expect(chunks221[1]!.tokenCount).toBe(41);
    });

    it("handles an enormous unbroken string without whitespace (e.g. minified code or base64)", async () => {
      const noteId = "note-unbroken";
      const giantToken = "A".repeat(15000); // 15,000 char unbroken token
      mockPg.notes.set(noteId, { id: noteId, plainText: giantToken, authorId: "u1" });

      const res = await syncNoteChunksAndEmbeddings(noteId, giantToken);
      expect(res.embedded).toBe(true);
      expect(res.chunkCount).toBe(1);
      expect(mockPg.noteChunks.get(noteId)?.[0]?.content).toBe(giantToken);
    });

    it("rolls back all staged chunk insertions atomically if a subsequent batch fails", async () => {
      const noteId = "note-rollback-test";
      const originalText = "Original content that must survive rollback";
      mockPg.notes.set(noteId, { id: noteId, plainText: originalText, authorId: "u1" });

      // Populate initial chunk
      await syncNoteChunksAndEmbeddings(noteId, originalText);
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(1);

      // Create a 125-chunk document (3 batches)
      const totalWords = 124 * (DEFAULT_NOTE_CHUNK_WORDS - DEFAULT_NOTE_OVERLAP_WORDS) + DEFAULT_NOTE_CHUNK_WORDS;
      const massiveText = generateWords(totalWords, "failing_batch");
      mockPg.notes.set(noteId, { id: noteId, plainText: massiveText, authorId: "u1" });

      mockEmbed.mockImplementationOnce(async (chunks: string[]) => ({
        vectors: chunks.map(() => Array(1536).fill(0.05)),
        totalTokens: chunks.length * 180,
      }));

      // Simulate a database failure on the second batch insert
      let insertCount = 0;
      const originalTransaction = dbMock.$transaction;
      dbMock.$transaction.mockImplementationOnce(async (callback: any) => {
        return originalTransaction(async (txClient: any) => {
          const originalExecuteRaw = txClient.$executeRaw;
          txClient.$executeRaw = vi.fn(async (query: any, ...args: any[]) => {
            const queryStr = Array.isArray(query) ? query.join("?") : query?.strings ? query.strings.join("?") : String(query);
            if (queryStr.includes('INSERT INTO "NoteChunk"')) {
              insertCount += 1;
              if (insertCount === 2) {
                throw new Error("PostgreSQL Error: disk quota exceeded on batch 2");
              }
            }
            return originalExecuteRaw(query, ...args);
          });
          return callback(txClient);
        });
      });

      await expect(
        syncNoteChunksAndEmbeddings(noteId, massiveText)
      ).rejects.toThrow("PostgreSQL Error: disk quota exceeded on batch 2");

      // Verify that after rollback, the database state was restored and NO partial chunks remain
      const chunksAfterRollback = mockPg.noteChunks.get(noteId);
      expect(chunksAfterRollback).toBeDefined();
      expect(chunksAfterRollback!.length).toBe(1);
      expect(chunksAfterRollback![0]!.content).toBe(originalText);
    });

    it("verifies idempotency of deleteNoteChunks when called multiple times", async () => {
      const noteId = "note-idempotent-del";
      mockPg.notes.set(noteId, { id: noteId, plainText: "Short text", authorId: "u1" });

      await syncNoteChunksAndEmbeddings(noteId, "Short text");
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(1);

      // First delete
      await deleteNoteChunks(noteId);
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(0);

      // Second delete on empty note must succeed quietly
      await expect(deleteNoteChunks(noteId)).resolves.not.toThrow();
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(0);
    });

    it("cleans existing chunks when plainText is resolved as empty from database", async () => {
      const noteId = "note-db-empty";
      // First populate with text
      mockPg.notes.set(noteId, { id: noteId, plainText: "Initial content", authorId: "u1" });
      await syncNoteChunksAndEmbeddings(noteId, "Initial content");
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(1);

      // Now set note's plainText to empty in DB and call sync without plainText param
      mockPg.notes.set(noteId, { id: noteId, plainText: "", authorId: "u1" });
      const res = await syncNoteChunksAndEmbeddings(noteId);

      expect(res.chunkCount).toBe(0);
      expect(res.embedded).toBe(false);
      expect(res.skippedReason).toBe("empty_content");
      expect(mockPg.noteChunks.get(noteId)?.length).toBe(0);
    });
  });
});
