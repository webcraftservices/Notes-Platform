-- Post-6.6-verification fixes — pending invitation cancel/resend.
--
-- Adds CANCELLED to InvitationStatus so an admin revoking a pending
-- invite is recorded distinctly from the recipient declining it
-- (DECLINED) or it simply expiring (EXPIRED). No row is deleted on
-- cancel, matching the existing DECLINED status-update pattern — this
-- keeps GroupInvitation rows intact for activity history.
--
-- No data changes to existing rows. ALTER TYPE ... ADD VALUE is the only
-- statement in this migration and nothing in this same migration file
-- references the new value, which is the documented-safe ordering in
-- Postgres 12+.

-- AlterEnum
ALTER TYPE "InvitationStatus" ADD VALUE 'CANCELLED';
