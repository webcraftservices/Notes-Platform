import type { MaterialType } from "@prisma/client";
import { resolveMaterialType } from "@/lib/mime";
import { GOOGLE_DOC_MIME } from "@/lib/services/google-drive";

export type GoogleFileClassification =
  | { kind: "google_doc" }
  | { kind: "concrete"; materialType: MaterialType }
  | { kind: "unsupported"; reason: string };

const GOOGLE_NATIVE_UNSUPPORTED: Record<string, string> = {
  "application/vnd.google-apps.spreadsheet": "Google Sheets isn't supported for import yet.",
  "application/vnd.google-apps.presentation": "Google Slides isn't supported for import yet.",
  "application/vnd.google-apps.form": "Google Forms isn't supported for import yet.",
  "application/vnd.google-apps.drawing": "Google Drawings aren't supported for import yet.",
  "application/vnd.google-apps.folder": "Folders can't be imported as a material.",
  "application/vnd.google-apps.shortcut": "Shortcuts can't be imported directly — open the original file instead.",
};

/**
 * Decides how (or whether) a Drive file can enter the Materials pipeline.
 * Kept dependency-free (no db, no Google API calls) so it's a pure,
 * synchronous decision — and so it can be unit tested without needing a
 * generated Prisma client (see __tests__/google-file-classifier.test.ts).
 *
 * - Native Google Docs go through the Docs export path (extractedText).
 * - Files whose MIME type is in mime.ts's ACCEPTED_MIME_TYPES import as
 *   that concrete MaterialType, getting the exact same preview/metadata/
 *   (for audio/video) transcription treatment as a normal upload.
 * - Other Google-native formats (Sheets, Slides, ...) are explicitly out of
 *   scope for this phase (spec §4) and are rejected with a clear message,
 *   never silently imported as an empty/broken material.
 * - Any other binary MIME type still imports, generically, as
 *   GOOGLE_DRIVE_FILE — real bytes, safely stored, download-only preview
 *   (UnsupportedPreview) — the same honest fallback DOCX already gets.
 */
export function classifyGoogleFile(mimeType: string): GoogleFileClassification {
  if (mimeType === GOOGLE_DOC_MIME) return { kind: "google_doc" };
  if (mimeType in GOOGLE_NATIVE_UNSUPPORTED) {
    return { kind: "unsupported", reason: GOOGLE_NATIVE_UNSUPPORTED[mimeType]! };
  }
  const concreteType = resolveMaterialType(mimeType);
  if (concreteType) return { kind: "concrete", materialType: concreteType };
  return { kind: "concrete", materialType: "GOOGLE_DRIVE_FILE" };
}
