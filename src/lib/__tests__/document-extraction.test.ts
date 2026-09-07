import { describe, expect, it } from "vitest";
import { shouldQueueDocumentExtraction } from "@/lib/document-extraction-guard";

/**
 * shouldQueueDocumentExtraction is the pure, DB-free decision function
 * both trigger sites (upload complete route, Google import job) defer
 * to via document-extraction.ts — see document-extraction-guard.ts for
 * why it lives in its own module (imports nothing but a Prisma *type*,
 * never the Prisma client itself) and is directly testable without a
 * database connection, matching this project's convention for pure-
 * function extraction (e.g. canManageInvitation, parseRangeHeader).
 */
describe("shouldQueueDocumentExtraction", () => {
  it("queues extraction for a fresh PDF with no extracted text yet", () => {
    expect(
      shouldQueueDocumentExtraction({ type: "PDF", extractedText: null, storageKey: "materials/u/m.pdf" })
    ).toBe(true);
  });

  it("queues extraction for a fresh DOCX and PPTX with no extracted text yet", () => {
    expect(
      shouldQueueDocumentExtraction({ type: "DOCX", extractedText: null, storageKey: "materials/u/m.docx" })
    ).toBe(true);
    expect(
      shouldQueueDocumentExtraction({ type: "PPTX", extractedText: null, storageKey: "materials/u/m.pptx" })
    ).toBe(true);
  });

  it("does not queue extraction for material types this pipeline doesn't handle", () => {
    for (const type of ["AUDIO", "VIDEO", "IMAGE", "TEXT", "GOOGLE_DOC", "GOOGLE_DRIVE_FILE", "LINK"] as const) {
      expect(
        shouldQueueDocumentExtraction({ type, extractedText: null, storageKey: "materials/u/m.bin" })
      ).toBe(false);
    }
  });

  it("is idempotent: skips a PDF that already has non-empty extracted text", () => {
    expect(
      shouldQueueDocumentExtraction({
        type: "PDF",
        extractedText: "Some previously extracted text.",
        storageKey: "materials/u/m.pdf",
      })
    ).toBe(false);
  });

  it("treats whitespace-only extractedText as 'not yet extracted' and queues it", () => {
    expect(
      shouldQueueDocumentExtraction({ type: "PDF", extractedText: "   \n\t  ", storageKey: "materials/u/m.pdf" })
    ).toBe(true);
  });

  it("re-queues extraction once extractedText has been reset to null (Google Drive force re-import)", () => {
    // google-import.ts's force-reimport path explicitly nulls
    // extractedText when Drive file content has changed — this is the
    // mechanism by which "content changed" and "needs reprocessing" stay
    // in sync without a separate content-hash column.
    expect(
      shouldQueueDocumentExtraction({ type: "PDF", extractedText: null, storageKey: "materials/u/m.pdf" })
    ).toBe(true);
  });

  it("does not queue extraction when there is no stored file yet", () => {
    expect(shouldQueueDocumentExtraction({ type: "PDF", extractedText: null, storageKey: null })).toBe(false);
  });
});
