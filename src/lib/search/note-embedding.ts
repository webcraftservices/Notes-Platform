/**
 * src/lib/search/note-embedding.ts
 *
 * Note Chunking, Vector Embedding Lifecycle, Content Hashing, Advisory Locking,
 * and Invalidation for Zenote Phase 12 Search.
 */

import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { lockGroupForShare } from "@/lib/access";
import { chunkText, type TextChunk, type ChunkOptions } from "@/lib/chunking";
import { getEmbeddingService, EMBEDDING_DIMENSIONS } from "@/lib/services/embedding";
import type { EmbeddingService } from "@/lib/services/interfaces";
import { recordAIUsage } from "@/lib/ai-usage";
import { buildNotePlainText } from "./tiptap-text";

export const DEFAULT_NOTE_CHUNK_WORDS = 220;
export const DEFAULT_NOTE_OVERLAP_WORDS = 40;
export const NOTE_CHUNK_INSERT_BATCH_SIZE = 50;
export const NOTE_CHUNK_WRITE_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

export interface SyncNoteChunksOptions {
  /** Optional custom embedding service for dependency injection / hermetic unit testing */
  embeddingService?: EmbeddingService;
  /** Force re-embedding even if content hash matches */
  force?: boolean;
  /** Custom chunk word limit (defaults to 220) */
  chunkWords?: number;
  /** Custom chunk overlap words (defaults to 40) */
  overlapWords?: number;
  /** User ID for AI usage accounting */
  userId?: string;
  /** Workspace ID for AI usage accounting */
  workspaceId?: string | null;
  /** Optional retry attempts on transient embedding errors when called via syncNoteSearchIndex */
  maxRetries?: number;
}

export interface SyncNoteChunksResult {
  chunkCount: number;
  embedded: boolean;
  skippedReason?: "content_unchanged" | "empty_content" | "superseded" | "embedding_failed";
}

/** Computes deterministic SHA-256 hex digest of a string */
export function computeContentHash(text: string): string {
  return crypto.createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

/** Computes deterministic SHA-256 hash across an array of chunk content strings */
export function computeChunksHash(chunkContents: string[]): string {
  return crypto
    .createHash("sha256")
    .update(chunkContents.join("\n---note-chunk-boundary---\n"), "utf8")
    .digest("hex");
}

/**
 * Splits note plain text into ordered, overlapping word-bounded chunks.
 * Reuses chunkText from @/lib/chunking for architectural consistency with Material chunks.
 */
export function chunkNoteText(plainText: string, options: ChunkOptions = {}): TextChunk[] {
  return chunkText(plainText, {
    chunkWords: options.chunkWords ?? DEFAULT_NOTE_CHUNK_WORDS,
    overlapWords: options.overlapWords ?? DEFAULT_NOTE_OVERLAP_WORDS,
  });
}

/**
 * Synchronizes Note chunks and pgvector embeddings for a note.
 *
 * Steps:
 * 1. Resolves plain text (from parameter or db.note.findUnique).
 * 2. If text is empty: acquires advisory lock, wipes existing NoteChunk records, returns.
 * 3. Chunks text into 220-word slices.
 * 4. Content Hash Check: queries existing chunks. If sha256 matches and force != true, returns early without calling OpenAI.
 * 5. Calls EmbeddingService.embed() outside the database transaction.
 * 6. Acquires transaction-scoped advisory lock: pg_advisory_xact_lock(hashtextextended('note_chunks:' + noteId, 0)).
 * 7. Checks for superseded note text: aborts write if newer plainText was committed during embedding.
 * 8. Deletes existing chunks and batch-inserts new chunks with raw ::vector casts.
 * 9. Records AI usage accounting (best-effort, non-blocking).
 */
export async function syncNoteChunksAndEmbeddings(
  noteId: string,
  plainText?: string,
  options: SyncNoteChunksOptions = {}
): Promise<SyncNoteChunksResult> {
  // 1. Resolve plainText / hierarchy groupId if needed
  let resolvedText = plainText;
  let resolvedUserId = options.userId;
  let resolvedWorkspaceId = options.workspaceId;
  let resolvedGroupId: string | null = null;

  if (typeof db.note?.findUnique === "function") {
    const note = (await db.note.findUnique({
      where: { id: noteId },
      select: {
        id: true,
        plainText: true,
        authorId: true,
        deletedAt: true,
        topic: {
          select: {
            deletedAt: true,
            chapter: {
              select: {
                deletedAt: true,
                subject: {
                  select: { workspaceId: true, groupId: true, deletedAt: true },
                },
              },
            },
          },
        },
      },
    })) as {
      id: string;
      plainText?: string | null;
      authorId?: string;
      deletedAt?: Date | null;
      topic?: {
        deletedAt?: Date | null;
        chapter?: {
          deletedAt?: Date | null;
          subject?: {
            workspaceId?: string | null;
            groupId?: string | null;
            deletedAt?: Date | null;
          } | null;
        } | null;
      } | null;
    } | null;

    if (!note) {
      if (resolvedText === undefined || !resolvedUserId) {
        throw new Error(`Note ${noteId} could not be found.`);
      }
    } else {
      if (
        note.deletedAt != null ||
        note.topic?.deletedAt != null ||
        note.topic?.chapter?.deletedAt != null ||
        note.topic?.chapter?.subject?.deletedAt != null
      ) {
        await deleteNoteChunks(noteId);
        return { chunkCount: 0, embedded: false, skippedReason: "superseded" };
      }
      resolvedGroupId = note.topic?.chapter?.subject?.groupId ?? null;
      if (resolvedText === undefined) {
        resolvedText = note.plainText ?? "";
      }
      if (!resolvedUserId) {
        resolvedUserId = note.authorId;
      }
      if (resolvedWorkspaceId === undefined) {
        resolvedWorkspaceId = note.topic?.chapter?.subject?.workspaceId ?? null;
      }
    }
  } else if (resolvedText === undefined || !resolvedUserId) {
    throw new Error(`Note ${noteId} could not be found.`);
  }

  const trimmedText = (resolvedText ?? "").trim();

  // 2. Handle empty note content: clean chunk invalidation
  if (trimmedText.length === 0) {
    await db.$transaction(async (tx) => {
      if (resolvedGroupId && typeof tx.$queryRaw === "function") {
        const lockedGroup = await lockGroupForShare(tx, resolvedGroupId);
        if (!lockedGroup || lockedGroup.deletedAt !== null) {
          await tx.noteChunk.deleteMany({ where: { noteId } });
          return;
        }
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`note_chunks:${noteId}`}, 0))`;
      await tx.noteChunk.deleteMany({ where: { noteId } });
    }, NOTE_CHUNK_WRITE_TX_OPTIONS);

    return { chunkCount: 0, embedded: false, skippedReason: "empty_content" };
  }

  // 3. Chunk the text
  const chunks = chunkNoteText(trimmedText, {
    chunkWords: options.chunkWords,
    overlapWords: options.overlapWords,
  });

  if (chunks.length === 0) {
    return { chunkCount: 0, embedded: false, skippedReason: "empty_content" };
  }

  // 4. Content Hashing: compare against existing chunks in DB to avoid redundant OpenAI calls
  if (!options.force) {
    const existingChunks = await db.noteChunk.findMany({
      where: { noteId },
      orderBy: { order: "asc" },
      select: { content: true },
    });

    if (existingChunks.length > 0) {
      const existingHash = computeChunksHash(existingChunks.map((c) => c.content));
      const newHash = computeChunksHash(chunks.map((c) => c.content));

      if (existingHash === newHash) {
        return {
          chunkCount: existingChunks.length,
          embedded: false,
          skippedReason: "content_unchanged",
        };
      }
    }
  }

  // 5. Embedding generation via EmbeddingService (outside DB transaction)
  const embeddingService = options.embeddingService ?? getEmbeddingService();
  if (embeddingService.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `EmbeddingService reports ${embeddingService.dimensions} dimensions, but NoteChunk.embedding ` +
        `is a fixed vector(${EMBEDDING_DIMENSIONS}) column.`
    );
  }

  const { vectors, totalTokens } = await embeddingService.embed(chunks.map((c) => c.content));
  if (vectors.length !== chunks.length) {
    throw new Error("EmbeddingService returned a different number of vectors than chunks were requested.");
  }

  // Verify vector dimensions
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    if (!v || v.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding vector at index ${i} has invalid dimension (expected ${EMBEDDING_DIMENSIONS}).`);
    }
  }

  // Compute expected hash of the chunks we just embedded
  const targetHash = computeChunksHash(chunks.map((c) => c.content));

  // 6–8. Write to database with Advisory Lock & Invalidation
  let writeCommitted = false;

  await db.$transaction(async (tx) => {
    // 6. Top-down lock order: lock parent Group FOR SHARE (if any) BEFORE per-note advisory lock
    if (resolvedGroupId && typeof tx.$queryRaw === "function") {
      const lockedGroup = await lockGroupForShare(tx, resolvedGroupId);
      if (!lockedGroup || lockedGroup.deletedAt !== null) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`note_chunks:${noteId}`}, 0))`;
        await tx.noteChunk.deleteMany({ where: { noteId } });
        return;
      }
    }

    // Acquire transaction-scoped advisory lock for this note
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`note_chunks:${noteId}`}, 0))`;

    // 7. Stale / Soft-Delete Overwrite Protection:
    // Verify note + hierarchy are still active AND plainText wasn't superseded while embedding ran.
    const currentNote = (await tx.note.findUnique({
      where: { id: noteId },
      select: {
        plainText: true,
        deletedAt: true,
        topic: {
          select: {
            deletedAt: true,
            chapter: {
              select: {
                deletedAt: true,
                subject: {
                  select: { deletedAt: true, groupId: true },
                },
              },
            },
          },
        },
      },
    })) as {
      plainText?: string | null;
      deletedAt?: Date | null;
      topic?: {
        deletedAt?: Date | null;
        chapter?: {
          deletedAt?: Date | null;
          subject?: { deletedAt?: Date | null; groupId?: string | null } | null;
        } | null;
      } | null;
    } | null;

    if (
      currentNote &&
      (currentNote.deletedAt != null ||
        currentNote.topic?.deletedAt != null ||
        currentNote.topic?.chapter?.deletedAt != null ||
        currentNote.topic?.chapter?.subject?.deletedAt != null)
    ) {
      await tx.noteChunk.deleteMany({ where: { noteId } });
      return;
    }

    const activeGroupId = currentNote?.topic?.chapter?.subject?.groupId ?? resolvedGroupId;
    if (activeGroupId && activeGroupId !== resolvedGroupId && typeof tx.$queryRaw === "function") {
      const lockedGroup = await lockGroupForShare(tx, activeGroupId);
      if (!lockedGroup || lockedGroup.deletedAt !== null) {
        await tx.noteChunk.deleteMany({ where: { noteId } });
        return;
      }
    }

    if (currentNote && currentNote.plainText != null) {
      const currentChunks = chunkNoteText(currentNote.plainText, {
        chunkWords: options.chunkWords,
        overlapWords: options.overlapWords,
      });
      const currentHash = computeChunksHash(currentChunks.map((c) => c.content));

      if (currentHash !== targetHash) {
        // Note text in DB was modified after this embedding request started; abort to prevent stale vector overwrite
        return;
      }
    }

    // 8. Atomic Invalidation: delete existing chunks
    await tx.noteChunk.deleteMany({ where: { noteId } });

    // Batch insert new chunks with ::vector casting
    for (let start = 0; start < chunks.length; start += NOTE_CHUNK_INSERT_BATCH_SIZE) {
      const slice = chunks.slice(start, start + NOTE_CHUNK_INSERT_BATCH_SIZE);
      const rows = slice.map((chunk, offset) => {
        const vector = vectors[start + offset];
        if (!vector) throw new Error("Missing vector during chunk insertion.");
        const vectorLiteral = `[${vector.join(",")}]`;

        return Prisma.sql`(${crypto.randomUUID()}, ${noteId}, ${chunk.content}, ${chunk.order}, ${chunk.tokenCount}, ${vectorLiteral}::vector, now())`;
      });

      await tx.$executeRaw`
        INSERT INTO "NoteChunk"
          (id, "noteId", content, "order", "tokenCount", embedding, "createdAt")
        VALUES ${Prisma.join(rows)}
      `;
    }

    writeCommitted = true;
  }, NOTE_CHUNK_WRITE_TX_OPTIONS);

  if (!writeCommitted) {
    return {
      chunkCount: 0,
      embedded: false,
      skippedReason: "superseded",
    };
  }

  // 9. Record AI usage accounting (best-effort, non-blocking)
  if (resolvedUserId) {
    await recordAIUsage({
      userId: resolvedUserId,
      workspaceId: resolvedWorkspaceId,
      category: "embedding",
      provider: embeddingService.providerName,
      model: embeddingService.modelName,
      tokensInput: totalTokens,
      context: { noteId, chunkCount: chunks.length },
    });
  }

  return { chunkCount: chunks.length, embedded: true };
}

/**
 * Explicitly removes all vector chunks for a note.
 * Useful for soft-delete cleanup or administrative reset.
 */
export async function deleteNoteChunks(noteId: string): Promise<void> {
  if (typeof db.$transaction !== "function" || !db.noteChunk) return;
  await db.$transaction(async (tx) => {
    if (typeof tx.$executeRaw === "function") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`note_chunks:${noteId}`}, 0))`;
    }
    if (tx.noteChunk?.deleteMany) {
      await tx.noteChunk.deleteMany({ where: { noteId } });
    }
  }, NOTE_CHUNK_WRITE_TX_OPTIONS);
}

/**
 * Best-effort note search index synchronization hook invoked from Note mutation paths
 * (block save, title update, version restore, AI note generation, and creation).
 *
 * Guarantees:
 * 1. Never throws into caller HTTP routes or background jobs if EmbeddingService is unconfigured or fails.
 * 2. Supports configurable retry attempts (`maxRetries`) on transient embedding failures.
 * 3. If embedding generation fails AND the note's existing NoteChunk rows are stale relative to the
 *    updated `plainText`, invalidates (deletes) the stale NoteChunk rows so removed or modified text
 *    can never remain discoverable via semantic search.
 */
export async function syncNoteSearchIndex(
  noteId: string,
  plainText?: string,
  options: SyncNoteChunksOptions = {}
): Promise<SyncNoteChunksResult> {
  if (!db.noteChunk || typeof db.noteChunk.findMany !== "function" || typeof db.$transaction !== "function") {
    return { chunkCount: 0, embedded: false, skippedReason: "embedding_failed" };
  }

  const maxRetries = Math.max(0, options.maxRetries ?? 0);
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await syncNoteChunksAndEmbeddings(noteId, plainText, options);
    } catch (err) {
      lastError = err;
    }
  }

  // If embedding failed after all attempts, ensure stale NoteChunk rows from prior content
  // are purged so deleted/edited note content cannot remain discoverable via vector search.
  try {
    const resolvedText = (plainText ?? "").trim();
    if (resolvedText.length === 0) {
      await deleteNoteChunks(noteId);
    } else {
      const existingChunks = await db.noteChunk.findMany({
        where: { noteId },
        orderBy: { order: "asc" },
        select: { content: true },
      });
      if (existingChunks.length > 0) {
        const newChunks = chunkNoteText(resolvedText, {
          chunkWords: options.chunkWords,
          overlapWords: options.overlapWords,
        });
        const existingHash = computeChunksHash(existingChunks.map((c) => c.content));
        const newHash = computeChunksHash(newChunks.map((c) => c.content));
        if (existingHash !== newHash) {
          await deleteNoteChunks(noteId);
        }
      }
    }
  } catch (cleanupErr) {
    console.warn("[note-embedding] Failed to purge stale note chunks after embedding failure:", cleanupErr);
  }

  console.warn("[note-embedding] Note embedding sync skipped/failed (lexical FTS remains up-to-date):", lastError);
  return { chunkCount: 0, embedded: false, skippedReason: "embedding_failed" };
}

export interface BackfillNotesResult {
  processedNotes: number;
  updatedPlainTextCount: number;
  embeddedNotesCount: number;
  purgedDeletedNoteChunks: number;
}

export interface BackfillNotesOptions extends SyncNoteChunksOptions {
  /** Optional list of specific note IDs to backfill. Required unless `allowGlobalBackfill: true` is explicitly set. */
  noteIds?: string[];
  /**
   * Explicit authorization flag required to execute an unscoped database-wide backfill
   * across all active and soft-deleted notes using the default embedding service.
   * Ignored (rejected) if a custom `embeddingService` is injected without `noteIds`.
   */
  allowGlobalBackfill?: boolean;
}

/**
 * Backfills `Note.plainText` and `NoteChunk` vector embeddings for existing active notes,
 * and purges any orphaned `NoteChunk` rows belonging to soft-deleted notes.
 */
export async function backfillNotesSearchIndex(
  options: BackfillNotesOptions = {}
): Promise<BackfillNotesResult> {
  if (options.embeddingService && (!options.noteIds || options.noteIds.length === 0)) {
    throw new Error(
      "Refusing unscoped backfillNotesSearchIndex with a custom embeddingService: explicit non-empty noteIds are required to prevent modifying pre-existing database records."
    );
  }

  if (options.noteIds === undefined && options.allowGlobalBackfill !== true) {
    throw new Error(
      "Refusing unscoped global backfillNotesSearchIndex without explicit authorization: provide explicit noteIds or set allowGlobalBackfill: true for an intentional operational backfill."
    );
  }

  if (options.noteIds && options.noteIds.length === 0) {
    return {
      processedNotes: 0,
      updatedPlainTextCount: 0,
      embeddedNotesCount: 0,
      purgedDeletedNoteChunks: 0,
    };
  }

  const idFilter = options.noteIds ? { id: { in: options.noteIds } } : {};

  // 1. Purge any chunks belonging to soft-deleted notes
  const deletedNotes = await db.note.findMany({
    where: { ...idFilter, deletedAt: { not: null } },
    select: { id: true },
  });
  let purgedDeletedNoteChunks = 0;
  if (deletedNotes.length > 0) {
    const res = await db.noteChunk.deleteMany({
      where: { noteId: { in: deletedNotes.map((n) => n.id) } },
    });
    purgedDeletedNoteChunks = res.count;
  }

  // 2. Backfill active notes
  const activeNotes = await db.note.findMany({
    where: { ...idFilter, deletedAt: null },
    include: { blocks: { orderBy: { order: "asc" } } },
  });

  let updatedPlainTextCount = 0;
  let embeddedNotesCount = 0;

  for (const note of activeNotes) {
    const hasBlocks = Array.isArray(note.blocks) && note.blocks.length > 0;
    const computedPlainText =
      hasBlocks || !note.plainText
        ? buildNotePlainText(note.title, note.blocks ?? [])
        : note.plainText;

    if (note.plainText !== computedPlainText) {
      await db.note.update({
        where: { id: note.id },
        data: { plainText: computedPlainText },
      });
      updatedPlainTextCount++;
    }

    const syncRes = await syncNoteSearchIndex(note.id, computedPlainText, {
      ...options,
      userId: options.userId ?? note.authorId,
    });
    if (syncRes.embedded) {
      embeddedNotesCount++;
    }
  }

  return {
    processedNotes: activeNotes.length,
    updatedPlainTextCount,
    embeddedNotesCount,
    purgedDeletedNoteChunks,
  };
}
