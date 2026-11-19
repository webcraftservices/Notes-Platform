/**
 * Phase 14 (Task 14-02) — Native Google Slides v1 REST API Client & Parser.
 *
 * Extracts structured slide text, shape hierarchies, tables, and speaker notes
 * directly from the Google Slides v1 REST API
 * (`GET https://slides.googleapis.com/v1/presentations/{presentationId}`)
 * without downloading or converting the presentation through PPTX.
 *
 * Output format (`text` and 1-based `pages: [{ pageNumber, text, ... }]`) is
 * structurally compatible with:
 * - Phase 11 AI note generation (`formatDelimitedSourceText(pages, "slide")`)
 * - Phase 12 hybrid search indexing (`chunkPagedText(pages)` -> `MaterialChunk.pageNumber`)
 * - Material preview (`GoogleDocViewer` / slide-by-slide preview)
 */

import { fetchWithTimeout } from "@/lib/fetch-timeout";
import {
  GoogleApiError,
  GOOGLE_RECONNECT_REQUIRED,
  GOOGLE_TEMPORARILY_UNAVAILABLE,
} from "./google-errors";

const SLIDES_API_TIMEOUT_MS = 30_000;

/** Matches MAX_PPTX_SLIDES and MAX_SHAPE_GROUP_DEPTH in document-processing-local.ts. */
export const MAX_GOOGLE_SLIDES_COUNT = 250;
export const MAX_SLIDES_SHAPE_GROUP_DEPTH = 20;
export const MAX_SLIDES_EXTRACTED_TEXT_CHARS = 500_000;

export interface GoogleSlidesTextRun {
  content?: string;
}

export interface GoogleSlidesAutoText {
  type?: string;
  content?: string;
}

export interface GoogleSlidesParagraphMarker {
  bullet?: {
    listId?: string;
    nestingLevel?: number;
    glyph?: string;
  };
}

export interface GoogleSlidesTextElement {
  startIndex?: number;
  endIndex?: number;
  paragraphMarker?: GoogleSlidesParagraphMarker;
  textRun?: GoogleSlidesTextRun;
  autoText?: GoogleSlidesAutoText;
}

export interface GoogleSlidesTextContent {
  textElements?: GoogleSlidesTextElement[];
}

export interface GoogleSlidesPlaceholder {
  type?: string;
  index?: number;
  parentObjectId?: string;
}

export interface GoogleSlidesShape {
  shapeType?: string;
  text?: GoogleSlidesTextContent;
  placeholder?: GoogleSlidesPlaceholder;
}

export interface GoogleSlidesTableCell {
  text?: GoogleSlidesTextContent;
}

export interface GoogleSlidesTableRow {
  tableCells?: GoogleSlidesTableCell[];
}

export interface GoogleSlidesTable {
  rows?: number;
  columns?: number;
  tableRows?: GoogleSlidesTableRow[];
}

export interface GoogleSlidesElementGroup {
  children?: GoogleSlidesPageElement[];
}

export interface GoogleSlidesPageElement {
  objectId?: string;
  title?: string;
  description?: string;
  shape?: GoogleSlidesShape;
  table?: GoogleSlidesTable;
  elementGroup?: GoogleSlidesElementGroup;
  image?: Record<string, unknown>;
  video?: Record<string, unknown>;
  line?: Record<string, unknown>;
  sheetsChart?: Record<string, unknown>;
  wordArt?: Record<string, unknown>;
}

export interface GoogleSlidesNotesProperties {
  speakerNotesObjectId?: string;
}

export interface GoogleSlidesNotesPage {
  objectId?: string;
  pageElements?: GoogleSlidesPageElement[];
  notesProperties?: GoogleSlidesNotesProperties;
}

export interface GoogleSlidesSlideProperties {
  layoutObjectId?: string;
  masterObjectId?: string;
  notesPage?: GoogleSlidesNotesPage;
  isSkipped?: boolean;
}

export interface GoogleSlidesPage {
  objectId?: string;
  pageType?: string;
  pageElements?: GoogleSlidesPageElement[];
  slideProperties?: GoogleSlidesSlideProperties;
}

export interface GoogleSlidesPresentationResponse {
  presentationId: string;
  title?: string;
  locale?: string;
  revisionId?: string;
  slides?: GoogleSlidesPage[];
}

export interface ExtractedGoogleSlidePage {
  /** 1-based slide index in presentation order. */
  pageNumber: number;
  /** Combined slide text (including speaker notes when present) for RAG/search/AI notes. */
  text: string;
  /** Google Slides objectId for this slide. */
  slideObjectId?: string;
  /** Slide body/shape/table text excluding speaker notes. */
  slideText?: string;
  /** Extracted speaker notes text for this slide, if any. */
  speakerNotes?: string;
  /** Whether the slide is marked hidden/skipped in Google Slides. */
  isSkipped?: boolean;
}

export interface ExtractedGoogleSlidesResult {
  presentationId: string;
  title: string;
  revisionId?: string;
  text: string;
  pages: ExtractedGoogleSlidePage[];
}

function slidesError(status: number, body: string): GoogleApiError {
  if (status === 401) {
    return new GoogleApiError(GOOGLE_RECONNECT_REQUIRED, {
      status,
      publicMessage: GOOGLE_RECONNECT_REQUIRED,
    });
  }
  if (status === 403) {
    const message = "Google temporarily limited this request or Google Slides access is not granted.";
    return new GoogleApiError(message, { status, publicMessage: message });
  }
  if (status === 404) {
    const message = "This Google Slides presentation is no longer accessible.";
    return new GoogleApiError(message, { status, publicMessage: message });
  }
  return new GoogleApiError(`Google Slides request failed (${status}): ${body.slice(0, 300)}`, {
    status,
    publicMessage: GOOGLE_TEMPORARILY_UNAVAILABLE,
  });
}

/**
 * Extracts normalized paragraph text from a Google Slides `TextContent` block.
 * Preserves paragraph boundaries while stripping empty lines and normalizing
 * whitespace.
 */
export function extractTextFromSlidesTextContent(
  textContent: GoogleSlidesTextContent | undefined
): string {
  const elements = textContent?.textElements;
  if (!Array.isArray(elements) || elements.length === 0) {
    return "";
  }

  let raw = "";
  for (const el of elements) {
    if (typeof el.textRun?.content === "string") {
      raw += el.textRun.content;
    } else if (typeof el.autoText?.content === "string") {
      raw += el.autoText.content;
    }
  }

  if (!raw) return "";

  const paragraphs = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter((line) => line.length > 0);

  return paragraphs.join("\n");
}

/**
 * Extracts tabular text from a Google Slides `Table` element.
 * Cells within a row are joined with `\t`; non-empty rows are joined with `\n`,
 * matching `extractTableText` in `document-processing-local.ts`.
 */
function extractTableText(table: GoogleSlidesTable | undefined): string {
  const rows = table?.tableRows;
  if (!Array.isArray(rows) || rows.length === 0) return "";

  const rowTexts: string[] = [];
  for (const row of rows) {
    const cells = row.tableCells;
    if (!Array.isArray(cells) || cells.length === 0) continue;

    const cellTexts = cells.map((cell) => {
      // Join multi-paragraph cell content with a single space so TSV row layout stays intact.
      const cellParagraphs = extractTextFromSlidesTextContent(cell.text);
      return cellParagraphs.replace(/\n+/g, " ").trim();
    });

    if (cellTexts.some((t) => t.length > 0)) {
      rowTexts.push(cellTexts.join("\t"));
    }
  }

  return rowTexts.join("\n");
}

const TITLE_PLACEHOLDER_TYPES = new Set(["TITLE", "CENTERED_TITLE", "SUBTITLE"]);

/**
 * Recursively extracts text blocks from an array of `PageElement`s (shapes,
 * tables, and nested `elementGroup`s), enforcing `MAX_SLIDES_SHAPE_GROUP_DEPTH`.
 */
function extractPageElementsText(
  pageElements: GoogleSlidesPageElement[] | undefined,
  depth: number = 0
): string[] {
  if (depth > MAX_SLIDES_SHAPE_GROUP_DEPTH) {
    throw new Error(
      `Presentation has shape groups nested deeper than ${MAX_SLIDES_SHAPE_GROUP_DEPTH} levels and cannot be safely processed.`
    );
  }
  if (!Array.isArray(pageElements) || pageElements.length === 0) {
    return [];
  }

  const titleBlocks: string[] = [];
  const bodyBlocks: string[] = [];

  for (const element of pageElements) {
    if (!element || typeof element !== "object") continue;

    if (element.shape) {
      const shapeText = extractTextFromSlidesTextContent(element.shape.text);
      if (shapeText.length > 0) {
        const placeholderType = element.shape.placeholder?.type ?? "";
        if (depth === 0 && TITLE_PLACEHOLDER_TYPES.has(placeholderType)) {
          titleBlocks.push(shapeText);
        } else {
          bodyBlocks.push(shapeText);
        }
      }
    }

    if (element.table) {
      const tableText = extractTableText(element.table);
      if (tableText.length > 0) {
        bodyBlocks.push(tableText);
      }
    }

    if (element.elementGroup?.children) {
      const groupBlocks = extractPageElementsText(element.elementGroup.children, depth + 1);
      bodyBlocks.push(...groupBlocks);
    }
  }

  return [...titleBlocks, ...bodyBlocks];
}

/**
 * Extracts speaker notes from a slide's `notesPage` definition.
 * First checks `notesProperties.speakerNotesObjectId` for the canonical
 * speaker-notes shape; falls back to `BODY` placeholder shapes on `notesPage`
 * if `speakerNotesObjectId` is omitted.
 */
function extractSpeakerNotes(slideProperties: GoogleSlidesSlideProperties | undefined): string {
  const notesPage = slideProperties?.notesPage;
  if (!notesPage || !Array.isArray(notesPage.pageElements) || notesPage.pageElements.length === 0) {
    return "";
  }

  const targetId = notesPage.notesProperties?.speakerNotesObjectId;
  if (targetId) {
    const matchingShape = notesPage.pageElements.find((el) => el.objectId === targetId);
    if (matchingShape?.shape) {
      return extractTextFromSlidesTextContent(matchingShape.shape.text);
    }
  }

  const fallbackNotes: string[] = [];
  for (const el of notesPage.pageElements) {
    const placeholderType = el.shape?.placeholder?.type;
    if (placeholderType === "BODY") {
      const text = extractTextFromSlidesTextContent(el.shape?.text);
      if (text.length > 0) {
        fallbackNotes.push(text);
      }
    }
  }

  return fallbackNotes.join("\n").trim();
}

/**
 * Parses a Google Slides v1 presentation JSON object into 1-based slide pages
 * and combined presentation text.
 */
export function parseGoogleSlidesPresentation(
  presentation: GoogleSlidesPresentationResponse
): ExtractedGoogleSlidesResult {
  if (!presentation || typeof presentation !== "object" || typeof presentation.presentationId !== "string") {
    throw new Error("Invalid Google Slides presentation response.");
  }

  const slides = Array.isArray(presentation.slides) ? presentation.slides : [];
  if (slides.length > MAX_GOOGLE_SLIDES_COUNT) {
    throw new Error(
      `Presentation has ${slides.length} slides, which exceeds the ${MAX_GOOGLE_SLIDES_COUNT}-slide processing limit.`
    );
  }

  const pages: ExtractedGoogleSlidePage[] = [];
  let totalChars = 0;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!;
    const pageNumber = i + 1;
    const elementBlocks = extractPageElementsText(slide.pageElements, 0);
    const slideText = elementBlocks.join("\n").trim();
    const speakerNotes = extractSpeakerNotes(slide.slideProperties);

    const combinedParts: string[] = [];
    if (slideText.length > 0) {
      combinedParts.push(slideText);
    }
    if (speakerNotes.length > 0) {
      combinedParts.push(`Speaker Notes:\n${speakerNotes}`);
    }

    const text = combinedParts.join("\n\n").trim();
    totalChars += text.length;
    if (totalChars > MAX_SLIDES_EXTRACTED_TEXT_CHARS) {
      throw new Error(
        `Extracted presentation text exceeds the ${MAX_SLIDES_EXTRACTED_TEXT_CHARS.toLocaleString()}-character limit.`
      );
    }

    pages.push({
      pageNumber,
      text,
      ...(slide.objectId ? { slideObjectId: slide.objectId } : {}),
      ...(slideText.length > 0 ? { slideText } : {}),
      ...(speakerNotes.length > 0 ? { speakerNotes } : {}),
      ...(slide.slideProperties?.isSkipped ? { isSkipped: true } : {}),
    });
  }

  const fullText = pages
    .map((p) => p.text)
    .filter((t) => t.length > 0)
    .join("\n\n");

  return {
    presentationId: presentation.presentationId,
    title: (presentation.title ?? "").trim() || "Untitled presentation",
    revisionId: presentation.revisionId,
    text: fullText,
    pages,
  };
}

/**
 * Fetches a Google Slides presentation directly from the Google Slides v1 REST API
 * and extracts structured slide text, tables, group hierarchies, and speaker notes.
 */
export async function extractGoogleSlidesPresentation(input: {
  accessToken: string;
  presentationId: string;
}): Promise<ExtractedGoogleSlidesResult> {
  const res = await fetchWithTimeout(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(input.presentationId)}`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    },
    { timeoutMs: SLIDES_API_TIMEOUT_MS, label: "Google Slides presentation fetch" }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw slidesError(res.status, body);
  }

  const data = (await res.json()) as GoogleSlidesPresentationResponse;
  return parseGoogleSlidesPresentation(data);
}

