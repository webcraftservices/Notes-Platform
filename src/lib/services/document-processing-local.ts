import path from "path";
import { DOMParser } from "@xmldom/xmldom";
import type { DocumentProcessingService } from "./interfaces";
import { getStorageService } from "./storage";
import { LocalStorageService } from "./storage-local";
import { S3StorageService } from "./storage-s3";
import type { PDFPageProxy, TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api.js";
import {
  LayoutAmbiguityError,
  WorkBudget,
  constructSlices,
  extractSliceGaps,
  validateGapIntervals,
  computeOptimalBipartiteAssignment,
  trackCorridorsAcrossSlices,
  checkWholeBandProjectionVoid,
  reconstructMultiColumnLayout,
  reconstructPageLayout,
  partitionPageIntoBands,
  decomposeBandColumns,
  getPageViewBounds,
  computeBodyTextHeight,
  computeMinGutterWidth,
  reconstructSingleColumnStreamText,
  verifyMissingGeometrySingleColumnSafety,
  MAX_RAW_ITEMS_PER_PAGE,
  MAX_VALID_ITEMS_PER_PAGE,
  MAX_BANDS_PER_PAGE,
  MAX_COLUMNS_PER_BAND,
  MAX_REGIONS_PER_PAGE,
  MAX_SLICES_PER_PAGE,
  MAX_SLICE_ITEM_MEMBERSHIPS,
  MAX_GAPS_PER_SLICE,
  MAX_ACTIVE_CORRIDORS,
  MAX_SOLVER_NODES_PER_SLICE,
  MAX_PAGE_SOLVER_NODES,
  MAX_PAGE_WORK_UNITS,
  MIN_GUTTER_WIDTH_PT,
  TEXT_MERGE_TOLERANCE_PT,
  MIN_SLICE_HEIGHT_PT,
  MIN_CORRIDOR_CONFIRMATION_COVERAGE,
} from "./pdf-layout-engine";
import type {
  PositionedPdfTextItem,
  GapInterval,
  Slice,
  CandidateCorridor,
  CorridorState,
  SolverResult,
  AssignmentMatch,
  ContentBand,
  PageLayout,
} from "./pdf-layout-engine";

export {
  LayoutAmbiguityError,
  WorkBudget,
  constructSlices,
  extractSliceGaps,
  validateGapIntervals,
  computeOptimalBipartiteAssignment,
  trackCorridorsAcrossSlices,
  checkWholeBandProjectionVoid,
  reconstructMultiColumnLayout,
  reconstructPageLayout,
  partitionPageIntoBands,
  decomposeBandColumns,
  getPageViewBounds,
  computeBodyTextHeight,
  computeMinGutterWidth,
  reconstructSingleColumnStreamText,
  verifyMissingGeometrySingleColumnSafety,
  MAX_RAW_ITEMS_PER_PAGE,
  MAX_VALID_ITEMS_PER_PAGE,
  MAX_BANDS_PER_PAGE,
  MAX_COLUMNS_PER_BAND,
  MAX_REGIONS_PER_PAGE,
  MAX_SLICES_PER_PAGE,
  MAX_SLICE_ITEM_MEMBERSHIPS,
  MAX_GAPS_PER_SLICE,
  MAX_ACTIVE_CORRIDORS,
  MAX_SOLVER_NODES_PER_SLICE,
  MAX_PAGE_SOLVER_NODES,
  MAX_PAGE_WORK_UNITS,
  MIN_GUTTER_WIDTH_PT,
  TEXT_MERGE_TOLERANCE_PT,
  MIN_SLICE_HEIGHT_PT,
  MIN_CORRIDOR_CONFIRMATION_COVERAGE,
};
export type {
  PositionedPdfTextItem,
  GapInterval,
  Slice,
  CandidateCorridor,
  CorridorState,
  SolverResult,
  AssignmentMatch,
  ContentBand,
  PageLayout,
};

/**
 * Maximum pages permitted for PDF text extraction.
 * Protects server memory and event-loop responsiveness against multi-hundred-page
 * documents or textbook dumps. A 400-page document represents ~160,000–200,000 words,
 * which already exceeds single-pass AI note-generation limits (MAX_DOCUMENT_NOTE_GEN_CHARS = 200,000).
 */
export const MAX_PDF_PAGES = 400;

/**
 * Maximum slides permitted for PPTX text extraction.
 * Standard university lecture decks range from 20 to 100 slides; 250 accommodates
 * extensive multi-lecture decks while bounding JSZip iteration and XML parsing overhead.
 */
export const MAX_PPTX_SLIDES = 250;

/**
 * Maximum uncompressed size permitted for a single PPTX slide XML file (2 MB).
 * Standard text-heavy slide XML is 20–100 KB. A slide XML exceeding 2 MB indicates
 * an XML/decompression bomb, extreme nesting, or abnormal inline data.
 */
export const MAX_PPTX_SLIDE_XML_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Maximum file size permitted for document extraction (50 MB).
 * Files larger than this ceiling remain safely stored and accessible for viewing
 * and downloading, but are rejected before being buffered into memory for text/RAG indexing.
 */
export const MAX_DOCUMENT_EXTRACTION_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Maximum character length permitted for stored extracted text (500,000 characters).
 * Documents exceeding this ceiling are rejected from automated indexing with a clear
 * message, preserving the original file in storage without silent truncation.
 */
export const MAX_EXTRACTED_TEXT_CHARS = 500_000;

/**
 * Maximum archive entries permitted in a PPTX ZIP archive.
 * Protects against ZIP bombs containing thousands of nested or redundant entries.
 */
export const MAX_PPTX_TOTAL_ENTRIES = 1_000;

/**
 * Number of pages or slides processed between cooperative event-loop yields.
 * Long document extraction loops periodically yield using setImmediate (Node macrotask)
 * to avoid starving concurrent HTTP requests and health probes. Short documents
 * (<= 10 pages/slides) incur zero yields.
 */
export const EXTRACTION_YIELD_INTERVAL = 10;

/**
 * Cooperative event-loop yielding helper using Node.js setImmediate.
 * Allows pending I/O and incoming HTTP requests to be handled during
 * long document extraction loops without blocking the event loop.
 * Encapsulated in an exported object so tests can verify yielding calls
 * without being polluted by third-party libraries (e.g. JSZip) that also
 * use setImmediate internally.
 */
export const extractionLoopHelpers = {
  yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => {
      setImmediate(resolve);
    });
  },
  extractDocxRawText(mammoth: any, buffer: Buffer): Promise<{ value: string; messages: any[] }> {
    return mammoth.extractRawText({ buffer });
  },
};

export const yieldToEventLoop = extractionLoopHelpers.yieldToEventLoop;

/**
 * Uncompressed/compressed size metadata recorded by JSZip in its local file headers.
 * Used to guard against oversized slide XML before allocating decompressed strings.
 */
interface JSZipDataMetadata {
  uncompressedSize?: number;
  compressedSize?: number;
}

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
  _data?: JSZipDataMetadata | string;
}
interface JSZipInstance {
  files: Record<string, JSZipFileEntry>;
}

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
 *
 * Phase 11.3.3C: Bounded pre-buffer check. Checks the file size via storage
 * metadata (stat for LocalStorageService, headObject for S3StorageService)
 * BEFORE allocating the buffer in memory, rejecting files exceeding
 * MAX_DOCUMENT_EXTRACTION_BYTES.
 */
async function readStorageBuffer(storageKey: string, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  const storage = getStorageService();
  if (storage instanceof LocalStorageService) {
    const stats = await storage.readFileStats(storageKey);
    signal?.throwIfAborted();
    if (stats.size > MAX_DOCUMENT_EXTRACTION_BYTES) {
      throw new Error(
        `This document exceeds the maximum supported file size for text extraction (${Math.round(
          stats.size / (1024 * 1024)
        )} MB; limit is ${Math.round(MAX_DOCUMENT_EXTRACTION_BYTES / (1024 * 1024))} MB). The original file remains available for viewing and download.`
      );
    }
    return storage.readFile(storageKey, undefined, signal);
  }
  if (storage instanceof S3StorageService) {
    const head = await storage.headObject(storageKey);
    signal?.throwIfAborted();
    if (head && head.sizeBytes > MAX_DOCUMENT_EXTRACTION_BYTES) {
      throw new Error(
        `This document exceeds the maximum supported file size for text extraction (${Math.round(
          head.sizeBytes / (1024 * 1024)
        )} MB; limit is ${Math.round(MAX_DOCUMENT_EXTRACTION_BYTES / (1024 * 1024))} MB). The original file remains available for viewing and download.`
      );
    }
    return storage.getObjectBuffer(storageKey, signal);
  }
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

interface VisualPdfLine {
  y: number;
  height: number;
  items: PositionedPdfTextItem[];
}

/**
 * Reconstructs textual content from a single column of PositionedPdfTextItem
 * items using Phase 11.3.5A.2.2 baseline grouping, word spacing, and paragraph detection.
 */
export function reconstructSingleColumnText(
  validItems: PositionedPdfTextItem[],
  budget: WorkBudget
): string {
  // Visual line bucketing based on baseline Y coordinates and superscript/subscript detection
  const lines: VisualPdfLine[] = [];
  for (const item of validItems) {
    const tolerance = Math.max(2.5, item.h * 0.25);
    let matchedLine: VisualPdfLine | null = null;

    // Pass 1: Standard baseline tolerance match
    for (const line of lines) {
      budget.recordWork(1);
      if (Math.abs(line.y - item.y) <= tolerance) {
        matchedLine = line;
        break;
      }
    }

    // Pass 2: Superscript / Subscript association
    if (!matchedLine) {
      for (const line of lines) {
        budget.recordWork(1);
        // Condition A: item is a superscript or subscript to an existing line
        const isScript =
          item.h <= line.height * 0.85 &&
          ((item.y > line.y && item.y - line.y <= line.height * 0.7) ||
            (item.y < line.y && line.y - item.y <= line.height * 0.45)) &&
          line.items.some((it) => {
            budget.recordWork(1);
            return (
              Math.abs(item.x - (it.x + it.w)) <= line.height * 0.75 ||
              Math.abs(item.x - it.x) <= line.height * 0.75
            );
          });

        // Condition B: line was initialized with a script item, and item is the larger base text
        const isBaseOfScriptLine =
          line.items.every((it) => {
            budget.recordWork(1);
            return it.h <= item.h * 0.85;
          }) &&
          ((line.y > item.y && line.y - item.y <= item.h * 0.7) ||
            (line.y < item.y && item.y - line.y <= item.h * 0.45)) &&
          line.items.some((it) => {
            budget.recordWork(1);
            return (
              Math.abs(item.x - (it.x + it.w)) <= item.h * 0.75 ||
              Math.abs(item.x - it.x) <= item.h * 0.75 ||
              Math.abs(item.x + item.w - it.x) <= item.h * 0.75
            );
          });

        if (isScript) {
          matchedLine = line;
          break;
        } else if (isBaseOfScriptLine) {
          line.y = item.y; // anchor line baseline to base text
          line.height = item.h;
          matchedLine = line;
          break;
        }
      }
    }

    if (matchedLine) {
      matchedLine.items.push(item);
      if (item.h > matchedLine.height) {
        matchedLine.height = item.h;
      }
    } else {
      lines.push({
        y: item.y,
        height: item.h,
        items: [item],
      });
    }
  }

  // Sort lines top-to-bottom (Y descending in Cartesian PDF coordinates)
  lines.sort((a, b) => {
    budget.recordWork(1);
    return b.y - a.y;
  });

  const reconstructedLines: { text: string; y: number; height: number }[] = [];
  for (const line of lines) {
    // Only sort by X for LTR text; preserve stream order for RTL or mixed directions
    const hasRtl = line.items.some((it) => it.dir === "rtl");
    if (!hasRtl) {
      line.items.sort((a, b) => {
        budget.recordWork(1);
        return a.x - b.x;
      });
    }

    // Filter out faux-bold duplicate text items (double-strike runs drawn on top of each other)
    const filteredItems: PositionedPdfTextItem[] = [];
    for (const item of line.items) {
      if (filteredItems.length === 0) {
        filteredItems.push(item);
        continue;
      }
      const prev = filteredItems[filteredItems.length - 1]!;
      const isFauxBoldDuplicate =
        item.str === prev.str &&
        Math.abs(item.y - prev.y) <= 1.0 &&
        Math.abs(item.h - prev.h) <= 1.0 &&
        Math.abs(item.x - prev.x) <= Math.max(1.2, item.w * 0.08) &&
        prev.x + prev.w - item.x >= prev.w * 0.8;

      if (!isFauxBoldDuplicate) {
        filteredItems.push(item);
      }
    }

    let lineText = filteredItems[0]!.str;
    for (let i = 1; i < filteredItems.length; i++) {
      const prev = filteredItems[i - 1]!;
      const curr = filteredItems[i]!;

      const prevEndsWithSpace = /\s$/.test(lineText);
      const currStartsWithSpace = /^\s/.test(curr.str);

      if (prevEndsWithSpace || currStartsWithSpace) {
        lineText += curr.str;
      } else {
        const prevEnd = prev.x + prev.w;
        const gap = curr.x - prevEnd;
        const minHeight = Math.min(prev.h, curr.h);
        const spaceThreshold = Math.max(1.5, minHeight * 0.16);

        if (gap >= spaceThreshold) {
          lineText += " " + curr.str;
        } else {
          lineText += curr.str;
        }
      }
    }

    const trimmed = lineText.trim();
    if (trimmed.length > 0) {
      reconstructedLines.push({ text: trimmed, y: line.y, height: line.height });
    }
  }

  if (reconstructedLines.length === 0) return "";

  const positiveDeltas: number[] = [];
  for (let i = 1; i < reconstructedLines.length; i++) {
    const d = reconstructedLines[i - 1]!.y - reconstructedLines[i]!.y;
    if (d > 0) {
      positiveDeltas.push(d);
    }
  }

  let medianLineDelta: number | null = null;
  let minTwoDelta: number | null = null;

  if (positiveDeltas.length >= 3) {
    const sortedDeltas = [...positiveDeltas].sort((a, b) => {
      budget.recordWork(1);
      return a - b;
    });
    const mid = Math.floor(sortedDeltas.length / 2);
    medianLineDelta =
      sortedDeltas.length % 2 !== 0
        ? sortedDeltas[mid]!
        : (sortedDeltas[mid - 1]! + sortedDeltas[mid]!) / 2;
  } else if (positiveDeltas.length === 2) {
    minTwoDelta = Math.min(positiveDeltas[0]!, positiveDeltas[1]!);
  }

  let fullText = reconstructedLines[0]!.text;
  for (let i = 1; i < reconstructedLines.length; i++) {
    const prev = reconstructedLines[i - 1]!;
    const curr = reconstructedLines[i]!;

    const deltaY = prev.y - curr.y;
    const avgHeight = (prev.height + curr.height) / 2;

    let isParagraphBreak = false;
    if (deltaY > 0) {
      if (medianLineDelta !== null) {
        const paragraphThreshold = Math.max(avgHeight * 1.75, medianLineDelta * 1.4);
        isParagraphBreak = deltaY > paragraphThreshold;
      } else if (minTwoDelta !== null) {
        const paragraphThreshold = Math.max(avgHeight * 1.75, minTwoDelta * 1.4);
        isParagraphBreak = deltaY > paragraphThreshold;
      } else {
        isParagraphBreak = false;
      }
    }

    if (isParagraphBreak) {
      fullText += "\n\n" + curr.text;
    } else {
      fullText += "\n" + curr.text;
    }
  }

  return fullText;
}

let testingWorkBudgetLimit: number | null = null;

export function _setTestingWorkBudgetLimit(limit: number | null): void {
  testingWorkBudgetLimit = limit;
}

/**
 * Reconstructs clean textual content from PDF.js TextContent items using
 * spatial geometry (baselines, bounding dimensions, and multi-column reconstruction).
 */
export function reconstructPdfPageText(
  items: (TextItem | TextMarkedContent)[],
  pageView?: number[],
  pageRotate?: number
): string {
  // Pre-flight Guard 1: Raw extracted item ceiling
  if (items.length > MAX_RAW_ITEMS_PER_PAGE) {
    throw new LayoutAmbiguityError(
      `Page exceeds raw text item budget (${items.length} > ${MAX_RAW_ITEMS_PER_PAGE})`
    );
  }

  const validItems: PositionedPdfTextItem[] = [];

  for (const it of items) {
    if (!it || !("str" in it) || typeof it.str !== "string") continue;
    if (it.str.length === 0) continue;

    const transform = it.transform;
    const hasValidGeometry =
      Array.isArray(transform) &&
      transform.length >= 6 &&
      typeof transform[4] === "number" &&
      Number.isFinite(transform[4]) &&
      typeof transform[5] === "number" &&
      Number.isFinite(transform[5]);

    const x = hasValidGeometry ? transform[4] : 0;
    const y = hasValidGeometry ? transform[5] : 0;
    const w = typeof it.width === "number" && Number.isFinite(it.width) ? it.width : 0;
    const h =
      typeof it.height === "number" && Number.isFinite(it.height) && it.height > 0
        ? it.height
        : 12;

    validItems.push({
      id: validItems.length,
      str: it.str.normalize("NFC"),
      x,
      y,
      w,
      h,
      dir: it.dir || "ltr",
      hasEOL: Boolean(it.hasEOL),
      hasValidGeometry,
    });
  }

  // Pre-flight Guard 2: Valid extracted item ceiling
  if (validItems.length > MAX_VALID_ITEMS_PER_PAGE) {
    throw new LayoutAmbiguityError(
      `Page exceeds valid text item budget (${validItems.length} > ${MAX_VALID_ITEMS_PER_PAGE})`
    );
  }

  if (validItems.length === 0) return "";

  const budget = new WorkBudget(testingWorkBudgetLimit ?? MAX_PAGE_WORK_UNITS);

  // Missing-geometry fallback safety (Phase 11.3.5B.1 Final Safety Closure)
  const allHaveGeometry = validItems.every((it) => it.hasValidGeometry);
  if (!allHaveGeometry) {
    const itemsWithGeometry = validItems.filter((it) => it.hasValidGeometry);
    // Rule 1: A missing-geometry document must never be assumed to be single-column merely because geometry is unavailable.
    if (itemsWithGeometry.length === 0) {
      if (validItems.length === 1) {
        return validItems[0]!.str.trim();
      }
      throw new LayoutAmbiguityError(
        "Page items completely lack geometric transforms; cannot independently verify reading order"
      );
    }

    // Rule 2 & 3: A document with missing geometry and possible multi-column structure must fail closed.
    const bounds = getPageViewBounds(pageView, itemsWithGeometry, pageRotate);
    const minGutterWidth = computeMinGutterWidth(itemsWithGeometry);

    const projection = checkWholeBandProjectionVoid(
      itemsWithGeometry,
      budget,
      minGutterWidth
    );

    if (projection.hasVoid) {
      throw new LayoutAmbiguityError(
        "Missing geometry detected on a page with multi-column projection void evidence"
      );
    }

    const bands = partitionPageIntoBands(
      itemsWithGeometry,
      bounds.minX,
      bounds.maxX,
      minGutterWidth,
      budget
    );

    // Rule 4: Missing geometry in a full-width heading or band transition must fail closed.
    if (bands.length > 1 || bands.some((b) => b.type === "FULL_WIDTH")) {
      throw new LayoutAmbiguityError(
        "Missing geometry detected on a page with heading or band transitions"
      );
    }

    const singleBand = bands[0]!;
    decomposeBandColumns(
      singleBand,
      minGutterWidth,
      bounds.minX,
      bounds.maxX,
      bounds,
      budget
    );

    if (singleBand.type !== "SINGLE_COLUMN") {
      throw new LayoutAmbiguityError(
        "Missing geometry detected on a page with multi-column band evidence"
      );
    }

    // Rule 5: Stream-order fallback is permitted only when single-column safety has been
    // independently established for all items, including independent proof that every
    // geometry-missing item belongs to the proven single-column reading flow.
    const isSafeSingleColumnMissing = verifyMissingGeometrySingleColumnSafety(
      validItems,
      minGutterWidth
    );

    if (!isSafeSingleColumnMissing) {
      throw new LayoutAmbiguityError(
        "Partial missing geometry cannot be independently verified as belonging to the single-column reading flow"
      );
    }

    return reconstructSingleColumnStreamText(validItems, budget);
  }

  // Preserve stream order / single-column for RTL text
  const hasRtl = validItems.some((it) => it.dir === "rtl");
  if (hasRtl) {
    return reconstructSingleColumnText(validItems, budget);
  }

  // Bounded Page -> Bands -> Columns Hierarchical XY-Cut Layout Reconstruction
  return reconstructPageLayout(
    validItems,
    pageView,
    (colItems, b) => reconstructSingleColumnText(colItems, b),
    budget,
    pageRotate
  );
}

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
async function extractPdfText(
  buffer: Buffer,
  signal?: AbortSignal
): Promise<{ text: string; pages: { pageNumber: number; text: string }[] }> {
  signal?.throwIfAborted();
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Ships its own standard (non-embedded) font metrics; without this,
  // pdf.js still extracts text correctly but throws when a PDF references
  // one of the 14 standard fonts (Helvetica, Times, etc.) without
  // embedding it — extremely common in real-world PDFs.
  const standardFontDataUrl =
    path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;

  signal?.throwIfAborted();

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
    if (signal?.aborted) throw signal.reason;
    throw new Error(
      `Couldn't read this PDF — it may be corrupted or password-protected. (${err instanceof Error ? err.message : "unknown error"
      })`
    );
  }

  try {
    signal?.throwIfAborted();

    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `This PDF exceeds the maximum supported page limit for text extraction (${pdf.numPages} pages; limit is ${MAX_PDF_PAGES} pages).`
      );
    }

    const pages: { pageNumber: number; text: string }[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      signal?.throwIfAborted();

      let page: PDFPageProxy | null = null;
      try {
        page = await pdf.getPage(pageNumber);
        signal?.throwIfAborted();

        const content = await page.getTextContent();
        signal?.throwIfAborted();

        const pageText = reconstructPdfPageText(content.items, page?.view, page?.rotate);
        pages.push({ pageNumber, text: pageText });
      } finally {
        if (page && typeof page.cleanup === "function") {
          page.cleanup();
        }
      }

      if (pageNumber % EXTRACTION_YIELD_INTERVAL === 0 && pageNumber < pdf.numPages) {
        signal?.throwIfAborted();
        await extractionLoopHelpers.yieldToEventLoop();
        signal?.throwIfAborted();
      }
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
async function extractDocxText(buffer: Buffer, signal?: AbortSignal): Promise<{ text: string }> {
  signal?.throwIfAborted();
  const mammoth = await import("mammoth");
  signal?.throwIfAborted();
  try {
    const result = await extractionLoopHelpers.extractDocxRawText(mammoth, buffer);
    // Mandatory post-resolution check: if signal was aborted while Mammoth was executing,
    // discard output and throw the abort reason.
    signal?.throwIfAborted();
    return { text: result.value.trim() };
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw new Error(
      `Couldn't read this Word document — it may be corrupted or in an unsupported format. (${err instanceof Error ? err.message : "unknown error"
      })`
    );
  }
}

function createSafeXmlParser(): DOMParser {
  return new DOMParser({
    errorHandler: (level: string, msg: string) => {
      if (level === "error" || level === "fatalError" || (level === "warning" && /unclosed/i.test(msg))) {
        throw new Error(`XML parsing error: ${msg}`);
      }
    },
  });
}

/**
 * Extracts decoded text from an OpenXML DrawingML paragraph (<a:p>).
 * Concatenates text runs directly without artificial spaces, translating <a:br>
 * line breaks to newlines and preserving whitespace in <a:t> (including xml:space="preserve").
 */
function extractParagraphText(pNode: Element): string {
  let text = "";
  for (let i = 0; i < pNode.childNodes.length; i++) {
    const child = pNode.childNodes[i];
    if (child && child.nodeType === 1) {
      const element = child as Element;
      const localName = element.localName;

      if (localName === "r" || localName === "fld") {
        for (let j = 0; j < element.childNodes.length; j++) {
          const grandChild = element.childNodes[j];
          if (grandChild && grandChild.nodeType === 1 && (grandChild as Element).localName === "t") {
            text += grandChild.textContent ?? "";
          }
        }
      } else if (localName === "br") {
        text += "\n";
      } else if (localName === "t") {
        text += element.textContent ?? "";
      }
    }
  }
  return text;
}

/**
 * Extracts text from an OpenXML text body container (<p:txBody> or <a:txBody>),
 * preserving paragraph boundaries and separating them with newlines.
 */
function extractTxBodyText(txBodyNode: Element): string {
  const paragraphs: string[] = [];
  for (let i = 0; i < txBodyNode.childNodes.length; i++) {
    const child = txBodyNode.childNodes[i];
    if (child && child.nodeType === 1 && (child as Element).localName === "p") {
      paragraphs.push(extractParagraphText(child as Element));
    }
  }
  return paragraphs.join("\n");
}

/**
 * Extracts structured text from an OpenXML table (<a:tbl>),
 * separating cells with tabs, rows with newlines, and preserving intra-cell paragraphs.
 */
function extractTableText(tblNode: Element): string {
  const rows: string[] = [];
  for (let i = 0; i < tblNode.childNodes.length; i++) {
    const rowNode = tblNode.childNodes[i];
    if (!rowNode || rowNode.nodeType !== 1 || (rowNode as Element).localName !== "tr") continue;

    const cells: string[] = [];
    for (let j = 0; j < rowNode.childNodes.length; j++) {
      const cellNode = rowNode.childNodes[j];
      if (!cellNode || cellNode.nodeType !== 1 || (cellNode as Element).localName !== "tc") continue;

      let cellText = "";
      for (let k = 0; k < cellNode.childNodes.length; k++) {
        const txNode = cellNode.childNodes[k];
        if (txNode && txNode.nodeType === 1 && (txNode as Element).localName === "txBody") {
          cellText = extractTxBodyText(txNode as Element);
          break;
        }
      }
      cells.push(cellText);
    }
    if (cells.length > 0) {
      rows.push(cells.join("\t"));
    }
  }
  return rows.join("\n");
}

const MAX_SHAPE_GROUP_DEPTH = 20;

/**
 * Traverses shapes in XML document order within a shape tree (<p:spTree>)
 * or group shape (<p:grpSp>), extracting text blocks from shapes (<p:sp>),
 * tables (<a:tbl> inside <p:graphicFrame>), and nested group shapes.
 */
function extractShapeContainerBlocks(containerNode: Element, depth = 0): string[] {
  if (depth > MAX_SHAPE_GROUP_DEPTH) {
    throw new Error(
      `This presentation contains shape groupings that exceed the maximum supported nesting depth (limit is ${MAX_SHAPE_GROUP_DEPTH} levels).`
    );
  }
  const blocks: string[] = [];

  for (let i = 0; i < containerNode.childNodes.length; i++) {
    const child = containerNode.childNodes[i];
    if (!child || child.nodeType !== 1) continue;
    const element = child as Element;
    const localName = element.localName;

    if (localName === "sp") {
      for (let j = 0; j < element.childNodes.length; j++) {
        const txChild = element.childNodes[j];
        if (txChild && txChild.nodeType === 1 && (txChild as Element).localName === "txBody") {
          const text = extractTxBodyText(txChild as Element).trim();
          if (text.length > 0) {
            blocks.push(text);
          }
          break;
        }
      }
    } else if (localName === "grpSp") {
      const nestedBlocks = extractShapeContainerBlocks(element, depth + 1);
      blocks.push(...nestedBlocks);
    } else if (localName === "graphicFrame") {
      const tblList = element.getElementsByTagNameNS
        ? element.getElementsByTagNameNS("*", "tbl")
        : element.getElementsByTagName("a:tbl");
      if (tblList.length > 0 && tblList[0]) {
        const tableText = extractTableText(tblList[0]).trim();
        if (tableText.length > 0) {
          blocks.push(tableText);
        }
      }
    }
  }

  return blocks;
}

/**
 * Extracts structured presentation text from a single slide's XML.
 * Parses DrawingML shapes, group shapes, tables, paragraphs, and text runs in source order.
 *
 * Remaining Limitation (by design):
 * OpenXML shape tree order represents z-order (stacking sequence) and deterministic XML
 * document order, which does not necessarily match visual or semantic reading order
 * (e.g. multi-column layouts or titles created after body text).
 */
export function extractSlideText(xml: string): string {
  const parser = createSafeXmlParser();
  const doc = parser.parseFromString(xml, "text/xml");

  const spTreeList = doc.getElementsByTagNameNS
    ? doc.getElementsByTagNameNS("*", "spTree")
    : doc.getElementsByTagName("p:spTree");

  const spTree = spTreeList.length > 0 ? spTreeList[0] : null;
  if (spTree) {
    const blocks = extractShapeContainerBlocks(spTree);
    if (blocks.length > 0) {
      // Separate distinct text shapes with double newlines; collapse excessive blank lines (3+ to 2)
      return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    }
  }

  // Fallback for minimal XML or non-standard containers (e.g. test mocks without <p:spTree>)
  const pList = doc.getElementsByTagNameNS
    ? doc.getElementsByTagNameNS("*", "p")
    : doc.getElementsByTagName("a:p");
  if (pList.length > 0) {
    const paragraphs: string[] = [];
    for (let i = 0; i < pList.length; i++) {
      const p = pList[i];
      if (p) {
        const text = extractParagraphText(p);
        if (text.length > 0) {
          paragraphs.push(text);
        }
      }
    }
    if (paragraphs.length > 0) {
      return paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
  }

  const tList = doc.getElementsByTagNameNS
    ? doc.getElementsByTagNameNS("*", "t")
    : doc.getElementsByTagName("a:t");
  if (tList.length > 0) {
    const runs: string[] = [];
    for (let i = 0; i < tList.length; i++) {
      const t = tList[i];
      if (t) runs.push(t.textContent ?? "");
    }
    return runs.join("").trim();
  }

  return "";
}

async function readBoundedZipXmlEntry(
  file: JSZipFileEntry,
  label: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted();

  let uncompressedBytes: number | null = null;
  const rawData = file._data;
  if (rawData === "") {
    uncompressedBytes = 0;
  } else if (
    typeof rawData === "object" &&
    rawData !== null &&
    typeof rawData.uncompressedSize === "number" &&
    Number.isFinite(rawData.uncompressedSize) &&
    rawData.uncompressedSize >= 0
  ) {
    uncompressedBytes = rawData.uncompressedSize;
  }

  if (uncompressedBytes === null) {
    throw new Error(`${label} XML size could not be verified safely before decompression.`);
  }

  if (uncompressedBytes > maxBytes) {
    throw new Error(
      `${label} exceeds the maximum supported slide XML size (${Math.round(
        uncompressedBytes / 1024
      )} KB; limit is ${Math.round(maxBytes / 1024)} KB).`
    );
  }

  signal?.throwIfAborted();
  const xml = await file.async("string");
  signal?.throwIfAborted();

  const actualBytes = Buffer.byteLength(xml, "utf8");
  if (actualBytes > maxBytes) {
    throw new Error(
      `${label} exceeds the maximum supported slide XML size (${Math.round(
        actualBytes / 1024
      )} KB; limit is ${Math.round(maxBytes / 1024)} KB).`
    );
  }

  return xml;
}

/**
 * Helper to sort slide parts numerically by their slide(\d+).xml index
 * when authoritative presentation metadata is genuinely unavailable.
 */
function fallbackNumericSlideEntries(allEntries: string[]): { name: string }[] {
  return allEntries
    .map((name) => {
      const match = name.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
      return match ? { name, index: Number(match[1]) } : null;
    })
    .filter((entry): entry is { name: string; index: number } => entry !== null)
    .sort((a, b) => a.index - b.index)
    .map(({ name }) => ({ name }));
}

/**
 * Resolves authoritative presentation slide ordering by inspecting `ppt/presentation.xml`'s
 * <p:sldIdLst> and `ppt/_rels/presentation.xml.rels`. Follows presentation order rather than
 * filename order.
 *
 * Strict Fail-Closed Policy:
 * If presentation metadata is present but invalid, incomplete, or corrupted, this
 * function fails closed with a descriptive error. Fallback to numeric filename sorting
 * is permitted ONLY when authoritative presentation metadata is genuinely absent.
 */
async function resolveSlideEntries(
  zip: JSZipInstance,
  allEntries: string[],
  signal?: AbortSignal
): Promise<{ name: string }[]> {
  signal?.throwIfAborted();

  const presFile = zip.files["ppt/presentation.xml"];
  const relsFile = zip.files["ppt/_rels/presentation.xml.rels"];

  // Fallback policy: numeric filename fallback is permitted ONLY when both metadata files are absent.
  if (!presFile && !relsFile) {
    return fallbackNumericSlideEntries(allEntries);
  }

  // If either metadata file exists without its required counterpart, fail closed.
  if (!presFile) {
    throw new Error(
      "Couldn't read this PowerPoint file — presentation relationships exist but presentation.xml is missing."
    );
  }

  if (!relsFile) {
    throw new Error(
      "Couldn't read this PowerPoint file — presentation.xml is present but presentation relationships are missing."
    );
  }

  // Authoritative presentation metadata is present; must resolve completely or fail closed
  signal?.throwIfAborted();
  let presXml: string;
  try {
    presXml = await readBoundedZipXmlEntry(
      presFile,
      "presentation.xml",
      MAX_PPTX_SLIDE_XML_BYTES,
      signal
    );
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw new Error(
      `Couldn't read this PowerPoint file — presentation.xml could not be decompressed. (${
        err instanceof Error ? err.message : "unknown error"
      })`
    );
  }
  signal?.throwIfAborted();

  const parser = createSafeXmlParser();
  let presDoc: Document;
  try {
    presDoc = parser.parseFromString(presXml, "text/xml");
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw new Error(
      `Couldn't read this PowerPoint file — presentation.xml is malformed or corrupted. (${
        err instanceof Error ? err.message : "unknown error"
      })`
    );
  }

  const sldIdEls = presDoc.getElementsByTagNameNS
    ? presDoc.getElementsByTagNameNS("*", "sldId")
    : presDoc.getElementsByTagName("p:sldId");

  // If presentation.xml declares no slides, return empty list (caller throws "No slides were found")
  if (sldIdEls.length === 0) {
    return [];
  }

  signal?.throwIfAborted();
  let relsXml: string;
  try {
    relsXml = await readBoundedZipXmlEntry(
      relsFile,
      "presentation relationships",
      MAX_PPTX_SLIDE_XML_BYTES,
      signal
    );
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw new Error(
      `Couldn't read this PowerPoint file — presentation relationships could not be decompressed. (${
        err instanceof Error ? err.message : "unknown error"
      })`
    );
  }
  signal?.throwIfAborted();

  let relsDoc: Document;
  try {
    relsDoc = parser.parseFromString(relsXml, "text/xml");
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw new Error(
      `Couldn't read this PowerPoint file — presentation relationships XML is malformed or corrupted. (${err instanceof Error ? err.message : "unknown error"
      })`
    );
  }

  const relEls = relsDoc.getElementsByTagNameNS
    ? relsDoc.getElementsByTagNameNS("*", "Relationship")
    : relsDoc.getElementsByTagName("Relationship");

  interface RelTarget {
    target: string;
    isExternal: boolean;
    type: string;
  }
  const relationshipMap = new Map<string, RelTarget>();

  for (let i = 0; i < relEls.length; i++) {
    const rel = relEls[i];
    if (!rel) continue;
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    const type = rel.getAttribute("Type") ?? "";
    const targetMode = rel.getAttribute("TargetMode") ?? "";

    if (!id) {
      throw new Error(
        "Couldn't read this PowerPoint file — a presentation relationship is missing an Id attribute."
      );
    }

    if (relationshipMap.has(id)) {
      throw new Error(
        `Couldn't read this PowerPoint file — duplicate relationship ID "${id}" declared in presentation relationships.`
      );
    }

    relationshipMap.set(id, {
      target: target ?? "",
      isExternal: targetMode.trim().toLowerCase() === "external",
      type,
    });
  }

  const orderedSlides: { name: string }[] = [];
  const seenRIds = new Set<string>();
  const seenSlideTargets = new Set<string>();

  for (let i = 0; i < sldIdEls.length; i++) {
    const sld = sldIdEls[i];
    if (!sld) continue;
    const rId =
      sld.getAttribute("r:id") ||
      sld.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
      sld.getAttribute("id");

    if (!rId) {
      throw new Error(
        `Couldn't read this PowerPoint file — slide reference at index ${i + 1} is missing a relationship ID.`
      );
    }

    if (seenRIds.has(rId)) {
      throw new Error(
        `Couldn't read this PowerPoint file — duplicate slide reference "${rId}" declared in presentation slide list.`
      );
    }
    seenRIds.add(rId);

    if (!relationshipMap.has(rId)) {
      throw new Error(
        `Couldn't read this PowerPoint file — slide relationship "${rId}" declared in presentation.xml was not found in relationships.`
      );
    }

    const relInfo = relationshipMap.get(rId)!;

    if (
      relInfo.isExternal ||
      relInfo.target.startsWith("http://") ||
      relInfo.target.startsWith("https://")
    ) {
      throw new Error(
        `Couldn't read this PowerPoint file — slide relationship "${rId}" has an unsupported external target.`
      );
    }

    if (
      !relInfo.type.endsWith("/slide") &&
      !relInfo.type.includes("relationships/slide")
    ) {
      throw new Error(
        `Couldn't read this PowerPoint file — relationship "${rId}" is not a slide relationship (type: "${relInfo.type}").`
      );
    }

    if (!relInfo.target || relInfo.target.trim().length === 0) {
      throw new Error(
        `Couldn't read this PowerPoint file — slide relationship "${rId}" has an empty target.`
      );
    }

    // Path normalization and traversal protection
    let targetPath = relInfo.target.startsWith("/")
      ? relInfo.target.slice(1)
      : path.posix.join("ppt", relInfo.target);
    targetPath = path.posix.normalize(targetPath);

    // Security and existence checks
    if (!targetPath.startsWith("ppt/slides/") || targetPath.includes("..")) {
      throw new Error(
        `Couldn't read this PowerPoint file — slide relationship "${rId}" points to an invalid path "${relInfo.target}".`
      );
    }

    if (!zip.files[targetPath]) {
      throw new Error(
        `Couldn't read this PowerPoint file — slide part "${targetPath}" referenced by relationship "${rId}" does not exist in the archive.`
      );
    }

    if (seenSlideTargets.has(targetPath)) {
      throw new Error(
        `Couldn't read this PowerPoint file — duplicate slide target "${targetPath}" referenced in presentation slide list.`
      );
    }
    seenSlideTargets.add(targetPath);

    orderedSlides.push({ name: targetPath });
  }

  return orderedSlides;
}

/**
 * Extracts real text from a PPTX by reading its slide XML parts directly
 * with JSZip. Authoritative slide order is resolved via `ppt/presentation.xml`
 * and its relationships. Slide text is extracted hierarchically via DOMParser,
 * preserving shapes, tables, paragraphs, line breaks, and exact run text.
 */
async function extractPptxText(
  buffer: Buffer,
  signal?: AbortSignal
): Promise<{ text: string; pages: { pageNumber: number; text: string }[] }> {
  signal?.throwIfAborted();
  let zip: JSZipInstance;
  try {
    const JSZipModule = await import("jszip");
    const JSZip = JSZipModule.default as unknown as { loadAsync(data: Buffer): Promise<JSZipInstance> };
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw new Error(
      `Couldn't read this PowerPoint file — it may be corrupted or not a real .pptx file. (${err instanceof Error ? err.message : "unknown error"
      })`
    );
  }

  signal?.throwIfAborted();

  const allEntries = Object.keys(zip.files);
  if (allEntries.length > MAX_PPTX_TOTAL_ENTRIES) {
    throw new Error(
      `This presentation exceeds the maximum supported archive entry count (${allEntries.length} entries; limit is ${MAX_PPTX_TOTAL_ENTRIES} entries).`
    );
  }

  const slideEntries = await resolveSlideEntries(zip, allEntries, signal);

  if (slideEntries.length === 0) {
    throw new Error("No slides were found in this presentation file.");
  }

  if (slideEntries.length > MAX_PPTX_SLIDES) {
    throw new Error(
      `This presentation exceeds the maximum supported slide limit for text extraction (${slideEntries.length} slides; limit is ${MAX_PPTX_SLIDES} slides).`
    );
  }

  const pages: { pageNumber: number; text: string }[] = [];
  for (const [position, entry] of slideEntries.entries()) {
    signal?.throwIfAborted();

    const file = zip.files[entry.name];
    if (!file) continue;

    let xml: string;
    try {
      xml = await readBoundedZipXmlEntry(
        file,
        `Slide ${position + 1}`,
        MAX_PPTX_SLIDE_XML_BYTES,
        signal
      );
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.endsWith("XML size could not be verified safely before decompression.")
      ) {
        throw new Error(
          `Slide ${position + 1} XML size could not be verified safely before decompression.`
        );
      }
      if (err instanceof Error && err.message.includes("exceeds the maximum supported slide XML size")) {
        throw new Error(err.message.replace(/^Slide \d+ /, `Slide ${position + 1} `));
      }
      throw err;
    }

    let slideText: string;
    try {
      slideText = extractSlideText(xml);
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      if (err instanceof Error && err.message.includes("nesting depth")) {
        throw err;
      }
      throw new Error(
        `Couldn't read this PowerPoint file — slide ${position + 1} XML is malformed or corrupted. (${err instanceof Error ? err.message : "unknown error"
        })`
      );
    }

    pages.push({ pageNumber: position + 1, text: slideText });

    if ((position + 1) % EXTRACTION_YIELD_INTERVAL === 0 && position + 1 < slideEntries.length) {
      signal?.throwIfAborted();
      await extractionLoopHelpers.yieldToEventLoop();
      signal?.throwIfAborted();
    }
  }

  return { text: pages.map((p) => p.text).join("\n\n"), pages };
}

export class LocalDocumentProcessingService implements DocumentProcessingService {
  async extractText(input: { storageKey: string; mimeType: string; signal?: AbortSignal }): Promise<{
    text: string;
    pages?: { pageNumber: number; text: string }[];
  }> {
    const buffer = await readStorageBuffer(input.storageKey, input.signal);
    const mimeType = input.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

    let result: { text: string; pages?: { pageNumber: number; text: string }[] };
    if (PDF_MIME_TYPES.has(mimeType)) {
      result = await extractPdfText(buffer, input.signal);
    } else if (DOCX_MIME_TYPES.has(mimeType)) {
      result = await extractDocxText(buffer, input.signal);
    } else if (PPTX_MIME_TYPES.has(mimeType)) {
      result = await extractPptxText(buffer, input.signal);
    } else {
      throw new Error(`DocumentProcessingService cannot extract text from MIME type "${input.mimeType}".`);
    }

    if (result.text.length > MAX_EXTRACTED_TEXT_CHARS) {
      throw new Error(
        `This document exceeds the maximum supported text length for extraction (${result.text.length.toLocaleString(
          "en-US"
        )} characters; limit is ${MAX_EXTRACTED_TEXT_CHARS.toLocaleString(
          "en-US"
        )} characters). The original file remains available for viewing and download.`
      );
    }

    return result;
  }
}
