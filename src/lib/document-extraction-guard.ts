import type { Material } from "@prisma/client";

/**
 * Material types this pipeline knows how to extract text from. Kept as
 * its own list (not reused from mime.ts's ACCEPTED_MIME_TYPES) because
 * it's a statement about what DocumentProcessingService currently
 * supports, not about what's accepted at upload time — the two lists
 * will diverge the day a new document type is accepted for upload before
 * extraction support for it exists.
 */
export const DOCUMENT_EXTRACTION_TYPES: ReadonlySet<Material["type"]> = new Set(["PDF", "DOCX", "PPTX"]);

/**
 * Pure decision function: should this Material get a DOCUMENT_EXTRACTION
 * job queued? Deliberately DB- and I/O-free (imports nothing but a
 * Prisma type, not the Prisma client itself) so it's directly unit
 * testable without mocking Prisma or a real database connection — same
 * convention as invitation-status.ts's canManageInvitation. The two call
 * sites (upload complete route, Google import job, in document-
 * extraction.ts) both defer to this rather than duplicating the
 * conditions inline.
 *
 * Idempotency: a Material that already has non-empty extractedText is
 * assumed already (successfully) processed and is skipped — re-running
 * extraction on unchanged content is wasted work. This holds because the
 * only place that clears extractedText back to null on an existing
 * Material is the Google Drive force-reimport path (google-import.ts),
 * which does so specifically because the underlying file content
 * changed — so "extractedText is null" and "content needs (re)extracting"
 * stay in sync without a separate content-hash column.
 */
export function shouldQueueDocumentExtraction(material: {
  type: Material["type"];
  extractedText: string | null;
  storageKey: string | null;
}): boolean {
  if (!DOCUMENT_EXTRACTION_TYPES.has(material.type)) return false;
  if (!material.storageKey) return false;
  if (material.extractedText && material.extractedText.trim().length > 0) return false;
  return true;
}
