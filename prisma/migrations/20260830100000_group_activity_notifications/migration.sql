-- Phase 6.6 — group activity log + notifications.
--
-- ActivityLog and Notification already existed (added in the Phase 1
-- schema, never wired up). This migration is purely additive:
--   1. Composite indexes for the two access patterns every Phase 6.6 read
--      actually uses (group-scoped feed / per-user inbox, both ordered by
--      createdAt DESC; the notification bell's unread count also filters
--      by readAt IS NULL).
--   2. Five new NotificationType enum values for group membership events
--      that need to reach a specific user personally, following the
--      existing GROUP_INVITATION / NEW_GROUP_MATERIAL naming convention.
--
-- No data changes. No existing query behavior changes. ALTER TYPE ... ADD
-- VALUE is run before any statement in this migration references the new
-- values (in fact nothing in this migration file uses them at all — the
-- application code that does runs in a later transaction), which is the
-- documented-safe ordering in Postgres 12+.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'GROUP_MEMBER_JOINED';
ALTER TYPE "NotificationType" ADD VALUE 'GROUP_MEMBER_LEFT';
ALTER TYPE "NotificationType" ADD VALUE 'GROUP_MEMBER_REMOVED';
ALTER TYPE "NotificationType" ADD VALUE 'GROUP_ROLE_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'GROUP_INVITATION_DECLINED';

-- CreateIndex
CREATE INDEX "ActivityLog_groupId_createdAt_idx" ON "ActivityLog"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
