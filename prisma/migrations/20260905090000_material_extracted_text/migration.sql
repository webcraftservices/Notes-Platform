-- Phase 7 (Google Drive/Docs integration) — generic extracted-text storage.
--
-- Adds a single nullable column to Material for plain-text content that
-- isn't tied to a storage-key file (currently: Google Docs, exported via
-- the Drive API's text/plain export and chunked/embedded the same way
-- Transcript.fullText already is for audio/video). No other schema changes
-- were required for Phase 7 — ConnectedAccount/ConnectedProvider and the
-- Material.externalRef / MaterialType.GOOGLE_DOC / GOOGLE_DRIVE_FILE
-- scaffolding already existed from Phase 1 and are wired up by this phase's
-- application code, not by a migration.
--
-- Purely additive: existing Material rows get NULL, nothing is backfilled,
-- and no other column changes shape.

-- AlterTable
ALTER TABLE "Material" ADD COLUMN "extractedText" TEXT;
