-- Phase 8.4: AI Tutor
--
-- Adds a `kind` discriminator to the existing AIConversation table so a
-- grounded, Topic-scoped AI Tutor conversation can reuse the exact same
-- AIConversation/AIMessage tables the Phase 5 "Ask AI" chat already uses,
-- instead of a parallel conversation/message schema. See the doc comment
-- on `AIConversation.kind` in prisma/schema.prisma for the full rationale.
--
-- Hand-written (not `prisma migrate dev`-generated) per this sandbox's
-- documented constraint: binaries.prisma.sh is network-blocked here, so
-- `prisma generate`/`prisma migrate dev` cannot run. This SQL mirrors
-- exactly what Prisma would generate for this schema diff.

-- CreateEnum
CREATE TYPE "AIConversationKind" AS ENUM ('CHAT', 'TUTOR');

-- AlterTable
ALTER TABLE "AIConversation" ADD COLUMN "kind" "AIConversationKind" NOT NULL DEFAULT 'CHAT';

-- CreateIndex
CREATE INDEX "AIConversation_userId_kind_idx" ON "AIConversation"("userId", "kind");
