import path from "path";
import JSZipImport from "jszip";
import type { DocumentProcessingService } from "./interfaces";
import { getStorageService } from "./storage";
import { LocalStorageService } from "./storage-local";
import { S3StorageService } from "./storage-s3";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api.js";

/**
 * jszip ships an old (TS 2.3-era) UMD-style declaration file. Under this
 * project's full compilation it resolves the default import's value to
 * `unknown` rather than its real shape (it compiles fine in isolation —
 * this only shows up once the whole program is type-checked together,
 * a known category of resolution quirk with older `export =` .d.ts files
 * under `moduleResolution: "bundler"`). presentation-viewer.tsx sidesteps
 * the same quirk by never type-checking its own JSZip usage at all
 * (it just assigns the import to `globalThis` for the untyped
 * `pptx2html` library to consume). Here, narrowing to the minimal real
 * shape this file actually uses is more honest than a blanket `as any`.
 */
interface JSZipFileEntry {
  async(type: "string"): Promise<string>;
}
interface JSZipInstance {
  files: Record<string, JSZipFileEntry>;
}
const JSZip = JSZipImport as unknown as {
  loadAsync(data: Buffer): Promise<JSZipInstance>;
};

/**
 * Local, provider-free DocumentProcessingService for PDF/DOCX/PPTX text
 * extraction. Unlike SpeechService/EmbeddingService, this isn't a paid
 * external API — it's pure local parsing (pdfjs-dist, mammoth, and the
 * project's existing jszip dependency), so there is no
 * ServiceNotConfiguredError path and no env var to set. It's registered
 * through document-processing.ts's getDocumentProcessingService() purely
 * to follow the project's interface+registry convention (see CLAUDE.md),
 * not because a provider swap is expected here.
 *
 * The interface (interfaces.ts) takes `storageKey`/`mimeType`, not a
 * pre-resolved buffer, so — unlike SpeechService, whose caller resolves
 * storage first — this implementation reads storage itself, duck-typing
 * the active backend exactly like transcription.ts's getAudioBuffer() and
 * google-import.ts's writeImportedBytes() already do.
 */
async function readStorageBuffer(storageKey: string): Promise<Buffer> {
  const storage = getStorageService();
  if (storage instanceof LocalStorageService) return storage.readFile(storageKey);
  if (storage instanceof S3StorageService) return storage.getObjectBuffer(storageKey);
  throw new Error("Unknown storage backend — cannot read file bytes for document extraction.");
}

const PDF_MIME_TYPES = new Set(["application/pdf"]);
const DOCX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);
const PPTX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);

/**
 * Extracts real text from a PDF using pdfjs-dist directly (Mozilla's own
 * PDF.js, not the unmaintained `pdf-parse` wrapper — that wrapper vendors
 * a frozen, years-old pdf.js snapshot that fails to parse PDFs produced
 * by this project's own `pdf-lib` dependency, let alone modern real-world
 * PDFs). The `legacy` build is the Node-compatible entry point; the
 * non-legacy build assumes DOM/browser APIs.
 *
 * `pdfjs-dist` ships only as ESM (`.mjs`), so it's loaded with a dynamic
 * `import()` from this CommonJS-compiled module rather than `require()`.
 */
async function extractPdfText(buffer: Buffer): Promise<{ text: string; pages: { pageNumber: number; text: string }[] }> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Ships its own standard (non-embedded) font metrics; without this,
  // pdf.js still extracts text correctly but throws when a PDF references
  // one of the 14 standard fonts (Helvetica, Times, etc.) without
  // embedding it — extremely common in real-world PDFs.
  const standardFontDataUrl =
    path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;

  const loadingTask = pdfjsLib.getDocument({
    // pdf.js requires a real Uint8Array, not a Node Buffer (a Buffer
    // *is* a Uint8Array subclass, but pdf.js's internal type check
    // rejects it specifically) — wrap explicitly.
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl,
  });

  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    throw new Error(
      `Couldn't read this PDF — it may be corrupted or password-protected. (${
        err instanceof Error ? err.message : "unknown error"
      })`
    );
  }

  try {
    const pages: { pageNumber: number; text: string }[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: TextItem | TextMarkedContent) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({ pageNumber, text: pageText });
    }
    return { text: pages.map((p) => p.text).join("\n\n"), pages };
  } finally {
    await pdf.destroy();
  }
}

/**
 * Extracts real text from a DOCX using `mammoth`. `extractRawText`
 * intentionally discards formatting — this is for RAG chunking, not
 * document rendering (the project has no DOCX preview to begin with).
 * DOCX has no natural "page" concept at the file-format level (page
 * breaks are a rendering-time computation, not stored data), so unlike
 * PDF/PPTX this never returns a `pages` array — that's a real format
 * limitation, not an oversight.
 */
async function extractDocxText(buffer: Buffer): Promise<{ text: string }> {
  const mammoth = await import("mammoth");
  try {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value.trim() };
  } catch (err) {
    throw new Error(
      `Couldn't read this Word document — it may be corrupted or in an unsupported format. (${
        err instanceof Error ? err.message : "unknown error"
      })`
    );
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Pulls every DrawingML text run (`<a:t>...</a:t>`) out of one slide's XML, in document order. */
function extractSlideText(xml: string): string {
  const matches = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)];
  return matches
    .map((match) => decodeXmlEntities(match[1] ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts real text from a PPTX by reading its slide XML parts directly
 * with JSZip (already a project dependency for the PPTX *preview*
 * renderer — see presentation-viewer.tsx) rather than the client-only
 * `pptx2html` library, which assumes jQuery/d3/a live DOM and cannot run
 * server-side. This is deliberately a separate, minimal, server-side text
 * path — not a second visual renderer — and does not touch or replace
 * PresentationViewer.
 *
 * Slide order is approximated from the numeric filename
 * (`slideN.xml`), which matches how PowerPoint actually names slide
 * parts. The authoritative order lives in `ppt/presentation.xml`'s
 * `<p:sldIdLst>` plus the slide relationship IDs; not resolving that here
 * is a known, documented approximation (real-world decks are numbered
 * sequentially in the vast majority of cases) rather than an oversight —
 * revisit only if a customer-reported deck actually reorders slides
 * without renumbering the underlying parts.
 */
async function extractPptxText(buffer: Buffer): Promise<{ text: string; pages: { pageNumber: number; text: string }[] }> {
  let zip: JSZipInstance;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new Error(
      `Couldn't read this PowerPoint file — it may be corrupted or not a real .pptx file. (${
        err instanceof Error ? err.message : "unknown error"
      })`
    );
  }

  const slideEntries = Object.keys(zip.files)
    .map((name) => {
      const match = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
      return match ? { name, index: Number(match[1]) } : null;
    })
    .filter((entry): entry is { name: string; index: number } => entry !== null)
    .sort((a, b) => a.index - b.index);

  if (slideEntries.length === 0) {
    throw new Error("No slides were found in this presentation file.");
  }

  const pages: { pageNumber: number; text: string }[] = [];
  for (const [position, entry] of slideEntries.entries()) {
    const file = zip.files[entry.name];
    if (!file) continue;
    const xml = await file.async("string");
    pages.push({ pageNumber: position + 1, text: extractSlideText(xml) });
  }

  return { text: pages.map((p) => p.text).join("\n\n"), pages };
}

export class LocalDocumentProcessingService implements DocumentProcessingService {
  async extractText(input: { storageKey: string; mimeType: string }): Promise<{
    text: string;
    pages?: { pageNumber: number; text: string }[];
  }> {
    const buffer = await readStorageBuffer(input.storageKey);
    const mimeType = input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

    if (PDF_MIME_TYPES.has(mimeType)) {
      return extractPdfText(buffer);
    }
    if (DOCX_MIME_TYPES.has(mimeType)) {
      return extractDocxText(buffer);
    }
    if (PPTX_MIME_TYPES.has(mimeType)) {
      return extractPptxText(buffer);
    }

    throw new Error(`DocumentProcessingService cannot extract text from MIME type "${input.mimeType}".`);
  }
}
