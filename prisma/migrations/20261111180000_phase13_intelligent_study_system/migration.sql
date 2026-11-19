-- Phase 13 — Intelligent Study System (FSRS-4.5 Scheduling & Card-Level Lexical Search)
--
-- 1) Creates `ReviewRating` ('AGAIN', 'HARD', 'GOOD', 'EASY') and
--    `CardLearningState` ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING', 'SUSPENDED') enums.
-- 2) Extends `FlashcardReview` with FSRS-4.5 scheduling parameters, state transition
--    tracking, algorithm version metadata, and per-user idempotency keys.
-- 3) Safely backfills any pre-existing Phase 8.6 `FlashcardReview` rows with deterministic
--    FSRS-4.5 baseline values without altering existing `wasCorrect` or `reviewedAt` values.
-- 4) Adds composite B-tree indexes on `FlashcardReview` for due-queue partitioning,
--    latest-card-state lookup, and analytics date-window queries.
-- 5) Creates Expression GIN full-text search index `idx_flashcard_search_fts` on `Flashcard`
--    (`front` weight 'B', `back` weight 'C') to support card-level lexical search (resolving LIM-10).
--
-- Rollback / Reversibility Reference:
--   DROP INDEX IF EXISTS "idx_flashcard_search_fts";
--   DROP INDEX IF EXISTS "FlashcardReview_userId_dueAt_idx";
--   DROP INDEX IF EXISTS "FlashcardReview_userId_flashcardId_reviewedAt_idx";
--   DROP INDEX IF EXISTS "FlashcardReview_userId_reviewedAt_idx";
--   DROP INDEX IF EXISTS "FlashcardReview_userId_idempotencyKey_key";
--   ALTER TABLE "FlashcardReview"
--     DROP COLUMN IF EXISTS "idempotencyKey",
--     DROP COLUMN IF EXISTS "algorithmVersion",
--     DROP COLUMN IF EXISTS "dueAt",
--     DROP COLUMN IF EXISTS "lapses",
--     DROP COLUMN IF EXISTS "reps",
--     DROP COLUMN IF EXISTS "scheduledDays",
--     DROP COLUMN IF EXISTS "elapsedDays",
--     DROP COLUMN IF EXISTS "difficulty",
--     DROP COLUMN IF EXISTS "stability",
--     DROP COLUMN IF EXISTS "state",
--     DROP COLUMN IF EXISTS "stateBefore",
--     DROP COLUMN IF EXISTS "rating";
--   DROP TYPE IF EXISTS "CardLearningState";
--   DROP TYPE IF EXISTS "ReviewRating";

-- CreateEnum: ReviewRating
DO $$ BEGIN
    CREATE TYPE "ReviewRating" AS ENUM ('AGAIN', 'HARD', 'GOOD', 'EASY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: CardLearningState
DO $$ BEGIN
    CREATE TYPE "CardLearningState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable: FlashcardReview
ALTER TABLE "FlashcardReview"
    ADD COLUMN IF NOT EXISTS "rating" "ReviewRating",
    ADD COLUMN IF NOT EXISTS "stateBefore" "CardLearningState",
    ADD COLUMN IF NOT EXISTS "state" "CardLearningState" NOT NULL DEFAULT 'REVIEW',
    ADD COLUMN IF NOT EXISTS "stability" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "difficulty" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "elapsedDays" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "scheduledDays" INTEGER,
    ADD COLUMN IF NOT EXISTS "reps" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS "lapses" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "algorithmVersion" TEXT,
    ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- Backfill pre-existing Phase 8.6 FlashcardReview rows with deterministic FSRS-4.5 initial state
UPDATE "FlashcardReview"
SET
    "rating" = CASE WHEN "wasCorrect" THEN 'GOOD'::"ReviewRating" ELSE 'AGAIN'::"ReviewRating" END,
    "stateBefore" = 'NEW'::"CardLearningState",
    "state" = CASE WHEN "wasCorrect" THEN 'REVIEW'::"CardLearningState" ELSE 'LEARNING'::"CardLearningState" END,
    "stability" = CASE WHEN "wasCorrect" THEN 2.4 ELSE 0.4 END,
    "difficulty" = CASE WHEN "wasCorrect" THEN 4.93 ELSE 6.81 END,
    "elapsedDays" = 0,
    "scheduledDays" = CASE WHEN "wasCorrect" THEN 2 ELSE 0 END,
    "dueAt" = CASE WHEN "wasCorrect" THEN "reviewedAt" + INTERVAL '2 days' ELSE "reviewedAt" + INTERVAL '10 minutes' END,
    "algorithmVersion" = 'fsrs-4.5'
WHERE "rating" IS NULL AND "dueAt" IS NULL;

-- CreateIndex: Composite and uniqueness indexes on FlashcardReview
CREATE UNIQUE INDEX IF NOT EXISTS "FlashcardReview_userId_idempotencyKey_key"
ON "FlashcardReview"("userId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "FlashcardReview_userId_reviewedAt_idx"
ON "FlashcardReview"("userId", "reviewedAt");

CREATE INDEX IF NOT EXISTS "FlashcardReview_userId_flashcardId_reviewedAt_idx"
ON "FlashcardReview"("userId", "flashcardId", "reviewedAt");

CREATE INDEX IF NOT EXISTS "FlashcardReview_userId_dueAt_idx"
ON "FlashcardReview"("userId", "dueAt");

-- CreateIndex: Expression GIN Full-Text Index on Flashcard (front 'B', back 'C')
CREATE INDEX IF NOT EXISTS "idx_flashcard_search_fts"
ON "Flashcard"
USING gin ((
    setweight(to_tsvector('english', coalesce("front", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("back", '')), 'C')
));

