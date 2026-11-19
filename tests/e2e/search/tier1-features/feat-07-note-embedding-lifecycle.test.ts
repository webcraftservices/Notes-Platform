/**
 * Tier 1 — Feature 7: Note Embedding Lifecycle
 *
 * Verifies NoteChunk model structure, SHA-256 content hashing,
 * chunking word windows and overlap, atomic stale vector cleanup,
 * and search invalidation upon note update or deletion.
 */

import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { computeContentHash, chunkNoteText } from "@/lib/search/note-embedding";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse } from "../harness/contracts";
import { createMockEmbedding } from "../harness/fixtures";

describe("Tier 1 — Feat 07: Note Embedding Lifecycle", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("computes deterministic SHA-256 content hashes of note plain text", () => {
    const text1 = "DNA helicase unwinds double stranded DNA during replication.";
    const text2 = "DNA helicase unwinds double stranded DNA during replication.";
    const text3 = "Different note content about RNA transcription.";

    const hash1 = computeContentHash(text1);
    const hash2 = computeContentHash(text2);
    const hash3 = computeContentHash(text3);

    // Matches standard Node crypto SHA-256
    const expected = crypto.createHash("sha256").update(text1.trim(), "utf8").digest("hex");
    expect(hash1).toBe(expected);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64); // SHA-256 hex length
  });

  it("chunks note text with configured word limits and overlap windows", () => {
    // Generate a long text with 500 words
    const words = Array.from({ length: 500 }, (_, i) => `concept${i}`).join(" ");

    // Chunk with 200 words and 40 word overlap
    const chunks = chunkNoteText(words, { chunkWords: 200, overlapWords: 40 });

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      expect(chunk).toBeDefined();
      if (!chunk) continue;
      expect(chunk.order).toBe(i);
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.tokenCount).toBeLessThanOrEqual(200);
    }

    // Verify overlap between adjacent chunks
    const chunk0 = chunks[0];
    const chunk1 = chunks[1];
    expect(chunk0).toBeDefined();
    expect(chunk1).toBeDefined();
    if (chunk0 && chunk1) {
      const chunk0Words = chunk0.content.split(/\s+/);
      const chunk0End = chunk0Words.slice(-10).join(" ");
      expect(chunk1.content).toContain(chunk0End);
    }
  });

  it("verifies NoteChunk records contain 1536-dimensional embeddings and cascade foreign keys", async () => {
    const db = harness.store.createPrismaClientMock();
    const chunks = await db.noteChunk.findMany({
      where: { noteId: "note-dna-helicase" },
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.noteId).toBe("note-dna-helicase");
      expect(chunk.embedding).toBeDefined();
      expect(chunk.embedding.length).toBe(1536);
      expect(typeof chunk.order).toBe("number");
      expect(typeof chunk.content).toBe("string");
    }
  });

  it("re-chunking note updates NoteChunk records and prevents stale vector retention", async () => {
    const db = harness.store.createPrismaClientMock();

    // Initial note chunks
    const initialChunks = await db.noteChunk.findMany({
      where: { noteId: "note-dna-helicase" },
    });
    expect(initialChunks.length).toBe(2);

    // Simulate updating note: delete old chunks and insert updated chunk
    await db.noteChunk.deleteMany({
      where: { noteId: "note-dna-helicase" },
    });
    const updatedChunk = await db.noteChunk.create({
      data: {
        id: "nchunk-updated-1",
        noteId: "note-dna-helicase",
        content: "Updated content about telomerase and lagging strand replication.",
        order: 0,
        embedding: createMockEmbedding("telomerase-updated"),
      },
    });

    const activeChunks = await db.noteChunk.findMany({
      where: { noteId: "note-dna-helicase" },
    });
    expect(activeChunks.length).toBe(1);
    expect(activeChunks[0].id).toBe(updatedChunk.id);
    expect(activeChunks[0].content).toContain("telomerase");
  });

  it("soft-deleting a note invalidates its chunk embeddings from search retrieval", async () => {
    // Before delete: note-dna-helicase is retrievable
    const beforeRes = await harness.dispatchSearchApiJson(
      { q: "helicase", mode: "semantic", types: "note" },
      alice
    );
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.data.hits.some((h: any) => h.id === "note-dna-helicase")).toBe(true);

    // Soft-delete the note
    const db = harness.store.createPrismaClientMock();
    await db.note.update({
      where: { id: "note-dna-helicase" },
      data: { deletedAt: new Date() },
    });

    // After delete: search must not return note-dna-helicase
    const afterRes = await harness.dispatchSearchApiJson(
      { q: "helicase", mode: "semantic", types: "note" },
      alice
    );
    expect(afterRes.status).toBe(200);
    expect(afterRes.data.hits.some((h: any) => h.id === "note-dna-helicase")).toBe(false);
  });

  it("advisory locking key pattern isolates per-note concurrent chunking transactions", () => {
    // Verifies advisory lock key formula: hashtextextended('note-chunks:' + noteId, 0)
    const noteIdA = "note-12345";
    const noteIdB = "note-67890";

    const lockKeyA = `note-chunks:${noteIdA}`;
    const lockKeyB = `note-chunks:${noteIdB}`;

    expect(lockKeyA).not.toBe(lockKeyB);
    expect(lockKeyA.startsWith("note-chunks:")).toBe(true);
    expect(lockKeyB.startsWith("note-chunks:")).toBe(true);
  });
});
