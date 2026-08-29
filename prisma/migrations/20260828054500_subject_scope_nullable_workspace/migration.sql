-- Phase 6.1 — Decision 1: a Subject belongs to exactly one scope, a
-- personal Workspace OR a shared Group, never both, never neither.
--
-- Previously Subject.workspaceId was NOT NULL, which made it impossible
-- for a Subject to belong to a Group instead of a Workspace without using
-- a meaningless placeholder workspaceId. This migration relaxes the
-- column to nullable. The workspaceId/groupId "exactly one of" invariant
-- itself is enforced in application code (see
-- lib/access.ts:assertSubjectScopeInvariant), not as a DB CHECK
-- constraint, consistent with how this project already enforces the
-- Material scope-consistency invariant in lib/materials-scope.ts.
--
-- Safe for existing data: every Subject row created before this migration
-- already has a non-null workspaceId (Phase 6 has not created any Group
-- Subjects yet), so relaxing the constraint changes zero existing rows.

-- AlterTable
ALTER TABLE "Subject" ALTER COLUMN "workspaceId" DROP NOT NULL;
