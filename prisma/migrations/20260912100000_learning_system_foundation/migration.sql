-- Phase 8.1 — Learning System foundation.
--
-- 1) Gives FlashcardDeck and Quiz the same five-field scope Material
--    already has (workspaceId/groupId/subjectId/chapterId/topicId), so a
--    deck/quiz can be attached at any level of the hierarchy — not just a
--    Topic — exactly like resolveMaterialScope()/MaterialScope already
--    resolve for Material. Existing rows (none in production yet; the
--    Phase 8 feature set was never wired to write these tables — see
--    PROJECT_STATE.md) get NULL for every new column, which is a valid
--    "Unorganized"-equivalent state, same as an unattached Material.
--
-- 2) Fixes an ownership-boundary bug in the original scaffolding: Flashcard
--    carried timesReviewed/timesCorrect/nextReviewAt directly on the
--    shared card row, which would have conflated one user's private study
--    activity with another's the moment a deck was shared in a Group.
--    Nothing in the app reads or writes these columns yet (grep confirms
--    zero call sites outside this schema file), so dropping them here is
--    not a breaking change. A new FlashcardReview table replaces them,
--    mirroring the existing (and already-correct) Quiz/QuizQuestion vs.
--    QuizAttempt split: shared content vs. private per-user attempts.
--
-- 3) Adds a `sources` JSONB provenance column to Flashcard and
--    QuizQuestion, reusing the exact shape already established by
--    AIMessage.sources ({ materialId, label, timestampSeconds?, page? }[])
--    instead of a new provenance table.

-- AlterTable: FlashcardDeck scope
ALTER TABLE "FlashcardDeck" ADD COLUMN     "workspaceId" TEXT;
ALTER TABLE "FlashcardDeck" ADD COLUMN     "groupId" TEXT;
ALTER TABLE "FlashcardDeck" ADD COLUMN     "subjectId" TEXT;
ALTER TABLE "FlashcardDeck" ADD COLUMN     "chapterId" TEXT;
ALTER TABLE "FlashcardDeck" ALTER COLUMN "topicId" DROP NOT NULL;

-- AlterTable: Quiz scope
ALTER TABLE "Quiz" ADD COLUMN     "workspaceId" TEXT;
ALTER TABLE "Quiz" ADD COLUMN     "groupId" TEXT;
ALTER TABLE "Quiz" ADD COLUMN     "subjectId" TEXT;
ALTER TABLE "Quiz" ADD COLUMN     "chapterId" TEXT;
ALTER TABLE "Quiz" ALTER COLUMN "topicId" DROP NOT NULL;

-- AlterTable: Flashcard — drop the shared-row activity fields, add provenance
ALTER TABLE "Flashcard" DROP COLUMN "timesReviewed";
ALTER TABLE "Flashcard" DROP COLUMN "timesCorrect";
ALTER TABLE "Flashcard" DROP COLUMN "nextReviewAt";
ALTER TABLE "Flashcard" ADD COLUMN     "sources" JSONB;

-- AlterTable: QuizQuestion — add provenance
ALTER TABLE "QuizQuestion" ADD COLUMN     "sources" JSONB;

-- CreateTable: FlashcardReview (private per-user study activity)
CREATE TABLE "FlashcardReview" (
    "id" TEXT NOT NULL,
    "flashcardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wasCorrect" BOOLEAN NOT NULL,
    "selfRating" "Difficulty",
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlashcardReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlashcardDeck_workspaceId_idx" ON "FlashcardDeck"("workspaceId");

-- CreateIndex
CREATE INDEX "FlashcardDeck_groupId_idx" ON "FlashcardDeck"("groupId");

-- CreateIndex
CREATE INDEX "FlashcardDeck_subjectId_idx" ON "FlashcardDeck"("subjectId");

-- CreateIndex
CREATE INDEX "FlashcardDeck_chapterId_idx" ON "FlashcardDeck"("chapterId");

-- CreateIndex
CREATE INDEX "Quiz_workspaceId_idx" ON "Quiz"("workspaceId");

-- CreateIndex
CREATE INDEX "Quiz_groupId_idx" ON "Quiz"("groupId");

-- CreateIndex
CREATE INDEX "Quiz_subjectId_idx" ON "Quiz"("subjectId");

-- CreateIndex
CREATE INDEX "Quiz_chapterId_idx" ON "Quiz"("chapterId");

-- CreateIndex
CREATE INDEX "FlashcardReview_flashcardId_idx" ON "FlashcardReview"("flashcardId");

-- CreateIndex
CREATE INDEX "FlashcardReview_userId_idx" ON "FlashcardReview"("userId");

-- AddForeignKey
ALTER TABLE "FlashcardDeck" ADD CONSTRAINT "FlashcardDeck_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashcardDeck" ADD CONSTRAINT "FlashcardDeck_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashcardDeck" ADD CONSTRAINT "FlashcardDeck_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashcardDeck" ADD CONSTRAINT "FlashcardDeck_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashcardReview" ADD CONSTRAINT "FlashcardReview_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashcardReview" ADD CONSTRAINT "FlashcardReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
