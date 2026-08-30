-- Phase 6.2 — membership + invitations.
--
-- Every invitation-management query this phase adds filters
-- GroupInvitation by (groupId, status) — listing an admin's pending
-- invitations, checking for an existing PENDING invite before creating a
-- new one, etc. The existing @@index([email]) doesn't help those lookups.
-- Purely additive: no data changes, no existing query behavior changes.

-- CreateIndex
CREATE INDEX "GroupInvitation_groupId_status_idx" ON "GroupInvitation"("groupId", "status");
