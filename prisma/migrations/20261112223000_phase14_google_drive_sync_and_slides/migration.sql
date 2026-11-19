-- Phase 14: Google Drive Continuous Synchronization & Native Google Slides Integration
-- Extends ConnectedAccount with Google Drive Changes API & push watch-channel state,
-- and extends Note with externalRef JSONB for bidirectional Google Docs synchronization.

ALTER TABLE "ConnectedAccount"
  ADD COLUMN IF NOT EXISTS "watchChannelId" TEXT,
  ADD COLUMN IF NOT EXISTS "watchResourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "watchTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "watchExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "changesPageToken" TEXT,
  ADD COLUMN IF NOT EXISTS "syncStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "lastSyncError" TEXT,
  ADD COLUMN IF NOT EXISTS "lastWebhookMessageNumber" BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS "ConnectedAccount_watchChannelId_key"
  ON "ConnectedAccount"("watchChannelId");

CREATE INDEX IF NOT EXISTS "ConnectedAccount_watchExpiresAt_idx"
  ON "ConnectedAccount"("watchExpiresAt");

ALTER TABLE "Note"
  ADD COLUMN IF NOT EXISTS "externalRef" JSONB;

