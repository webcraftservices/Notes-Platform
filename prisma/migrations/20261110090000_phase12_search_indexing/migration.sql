-- Phase 12 — Unified Global & Semantic Search Indexing
--
-- 1) Adds `plainText` column to Note for plain-text extraction from rich-text
--    Tiptap blocks, enabling lexical FTS and chunking.
-- 2) Creates `NoteChunk` table for note semantic vector search (1536d pgvector).
-- 3) Creates HNSW vector indexes on MaterialChunk and NoteChunk embeddings for
--    approximate nearest neighbor cosine distance search.
-- 4) Creates Expression GIN full-text search indexes with weighted tsvectors on
--    Subject, Chapter, Topic, Material, Note, Group, and FlashcardDeck.

-- AlterTable: Note
ALTER TABLE "Note" ADD COLUMN "plainText" TEXT;

-- CreateTable: NoteChunk
CREATE TABLE "NoteChunk" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "tokenCount" INTEGER,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteChunk_noteId_idx" ON "NoteChunk"("noteId");

-- AddForeignKey
ALTER TABLE "NoteChunk" ADD CONSTRAINT "NoteChunk_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Vector HNSW Indexes (pgvector cosine distance for semantic retrieval)
CREATE INDEX IF NOT EXISTS "idx_material_chunk_embedding_hnsw"
ON "MaterialChunk"
USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "idx_note_chunk_embedding_hnsw"
ON "NoteChunk"
USING hnsw ("embedding" vector_cosine_ops);

-- Expression GIN Full-Text Indexes across Core Entities

-- 1. Subject (name 'A', description 'B')
CREATE INDEX IF NOT EXISTS "idx_subject_search_fts"
ON "Subject"
USING gin ((
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
));

-- 2. Chapter (name 'A', description 'B')
CREATE INDEX IF NOT EXISTS "idx_chapter_search_fts"
ON "Chapter"
USING gin ((
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
));

-- 3. Topic (name 'A', description 'B')
CREATE INDEX IF NOT EXISTS "idx_topic_search_fts"
ON "Topic"
USING gin ((
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
));

-- 4. Material (title 'A', originalFilename 'B', extractedText 'C')
CREATE INDEX IF NOT EXISTS "idx_material_search_fts"
ON "Material"
USING gin ((
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("originalFilename", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("extractedText", '')), 'C')
));

-- 5. Note (title 'A', plainText 'B')
CREATE INDEX IF NOT EXISTS "idx_note_search_fts"
ON "Note"
USING gin ((
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("plainText", '')), 'B')
));

-- 6. Group (name 'A', description 'B')
CREATE INDEX IF NOT EXISTS "idx_group_search_fts"
ON "Group"
USING gin ((
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B')
));

-- 7. FlashcardDeck (title 'A')
CREATE INDEX IF NOT EXISTS "idx_flashcard_deck_search_fts"
ON "FlashcardDeck"
USING gin ((
    setweight(to_tsvector('english', coalesce("title", '')), 'A')
));
