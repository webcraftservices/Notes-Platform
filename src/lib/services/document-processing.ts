import type { DocumentProcessingService } from "./interfaces";

/**
 * Registry entry point for DocumentProcessingService, matching the
 * getStorageService()/getSpeechService() pattern (see CLAUDE.md). Unlike
 * those, there is currently exactly one implementation and it needs no
 * API key or env var — PDF/DOCX/PPTX text extraction runs entirely
 * locally (pdfjs-dist, mammoth, jszip), so there is no
 * ServiceNotConfiguredError branch here. A future provider swap (e.g. an
 * OCR-backed cloud document API for scanned PDFs) would add a new branch
 * here behind an env var, following speech.ts's exact shape — never
 * inlined into a call site.
 */
let cachedService: DocumentProcessingService | null = null;

export function getDocumentProcessingService(): DocumentProcessingService {
  if (cachedService) return cachedService;
  const { LocalDocumentProcessingService } = require("./document-processing-local") as
    typeof import("./document-processing-local");
  cachedService = new LocalDocumentProcessingService();
  return cachedService;
}
