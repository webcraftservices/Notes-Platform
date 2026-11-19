import crypto from "crypto";
import type { NoteBlockKind } from "@prisma/client";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { extractPlainTextFromTiptap } from "@/lib/search/tiptap-text";
import { GoogleDriveService } from "./google-drive";
import { MAX_EXTRACTED_TEXT_CHARS } from "./document-processing-local";
import {
  GoogleApiError,
  GoogleRevisionConflictError,
  GOOGLE_RECONNECT_REQUIRED,
  GOOGLE_TEMPORARILY_UNAVAILABLE,
} from "./google-errors";

/**
 * Maximum response byte ceiling for exported Google Doc text (10 MB).
 * Protects server memory during Drive export streaming.
 */
export const GOOGLE_DOCS_EXPORT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const DOCS_API_TIMEOUT_MS = 25_000;

/**
 * Extracts a Google Doc's text content via the real Google Docs export
 * mechanism (Drive's `files.export` with `mimeType=text/plain`) — this is
 * Google's own supported operation for turning a Google Doc into plain
 * text, not a webpage scrape (spec §13).
 */
export async function extractGoogleDocText(input: {
  accessToken: string;
  documentId: string;
  maxBytes?: number;
}): Promise<string> {
  const drive = new GoogleDriveService();
  const buffer = await drive.exportFile({
    accessToken: input.accessToken,
    fileId: input.documentId,
    mimeType: "text/plain",
    maxBytes: input.maxBytes ?? GOOGLE_DOCS_EXPORT_MAX_BYTES,
  });
  const text = buffer.toString("utf8");
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new Error(
      `This document exceeds the maximum supported text length for extraction (${text.length.toLocaleString(
        "en-US"
      )} characters; limit is ${MAX_EXTRACTED_TEXT_CHARS.toLocaleString(
        "en-US"
      )} characters). The original file remains available for viewing and download.`
    );
  }
  return text;
}

// ----------------------------------------------------------------------------
// Phase 14 (Task 14-03) — Google Docs v1 REST API & Bidirectional Note Mapping
// ----------------------------------------------------------------------------

export interface GoogleDocTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  link?: { url?: string };
}

export interface GoogleDocTextRun {
  content?: string;
  textStyle?: GoogleDocTextStyle;
}

export interface GoogleDocParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: GoogleDocTextRun;
}

export interface GoogleDocParagraphStyle {
  namedStyleType?:
    | "NORMAL_TEXT"
    | "TITLE"
    | "SUBTITLE"
    | "HEADING_1"
    | "HEADING_2"
    | "HEADING_3"
    | "HEADING_4"
    | "HEADING_5"
    | "HEADING_6"
    | string;
}

export interface GoogleDocBullet {
  listId?: string;
  nestingLevel?: number;
}

export interface GoogleDocParagraph {
  elements?: GoogleDocParagraphElement[];
  paragraphStyle?: GoogleDocParagraphStyle;
  bullet?: GoogleDocBullet;
}

export interface GoogleDocTableCell {
  content?: GoogleDocStructuralElement[];
}

export interface GoogleDocTableRow {
  tableCells?: GoogleDocTableCell[];
}

export interface GoogleDocTable {
  rows?: number;
  columns?: number;
  tableRows?: GoogleDocTableRow[];
}

export interface GoogleDocStructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: GoogleDocParagraph;
  table?: GoogleDocTable;
  sectionBreak?: Record<string, unknown>;
}

export interface GoogleDocDocument {
  documentId: string;
  title: string;
  revisionId?: string;
  body?: {
    content?: GoogleDocStructuralElement[];
  };
}

export type GoogleDocBatchUpdateRequest =
  | {
      insertText: {
        location: { index: number };
        text: string;
      };
    }
  | {
      deleteContentRange: {
        range: { startIndex: number; endIndex: number };
      };
    }
  | {
      updateParagraphStyle: {
        range: { startIndex: number; endIndex: number };
        paragraphStyle: { namedStyleType: string };
        fields: string;
      };
    };

export interface GoogleDocBatchUpdateResponse {
  documentId: string;
  writeControl?: {
    requiredRevisionId?: string;
  };
  replies?: Record<string, unknown>[];
}

function docsError(status: number, body: string): GoogleApiError | GoogleRevisionConflictError {
  if (status === 401) {
    return new GoogleApiError(GOOGLE_RECONNECT_REQUIRED, {
      status,
      publicMessage: GOOGLE_RECONNECT_REQUIRED,
    });
  }
  if (
    (status === 400 || status === 409) &&
    /writeControl|requiredRevisionId|revision|changed since/i.test(body)
  ) {
    return new GoogleRevisionConflictError();
  }
  if (status === 403) {
    const message = "Google temporarily limited this request or Google Docs write access is not granted.";
    return new GoogleApiError(message, { status, publicMessage: message });
  }
  if (status === 404) {
    const message = "This Google Doc is no longer accessible.";
    return new GoogleApiError(message, { status, publicMessage: message });
  }
  return new GoogleApiError(`Google Docs request failed (${status}): ${body.slice(0, 300)}`, {
    status,
    publicMessage: GOOGLE_TEMPORARILY_UNAVAILABLE,
  });
}

async function docsFetch(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<Response> {
  return fetchWithTimeout(
    `https://docs.googleapis.com/v1/documents${path}`,
    {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: DOCS_API_TIMEOUT_MS, label: "Google Docs request" }
  );
}

/**
 * Fetches a Google Doc's full structured representation (`body.content`, `revisionId`, `title`)
 * from the Google Docs v1 REST API.
 */
export async function getGoogleDocument(input: {
  accessToken: string;
  documentId: string;
}): Promise<GoogleDocDocument> {
  const res = await docsFetch(`/${encodeURIComponent(input.documentId)}`, input.accessToken);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw docsError(res.status, body);
  }
  return (await res.json()) as GoogleDocDocument;
}

/**
 * Creates a new blank Google Doc with the specified title via the Google Docs v1 REST API.
 */
export async function createGoogleDocument(input: {
  accessToken: string;
  title: string;
}): Promise<GoogleDocDocument> {
  const res = await docsFetch("", input.accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: input.title }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw docsError(res.status, body);
  }
  return (await res.json()) as GoogleDocDocument;
}

/**
 * Applies atomic `batchUpdate` requests to a Google Doc, optionally guarded by
 * `writeControl.requiredRevisionId` so concurrent remote edits cannot be silently overwritten.
 */
export async function batchUpdateGoogleDocument(input: {
  accessToken: string;
  documentId: string;
  requests: GoogleDocBatchUpdateRequest[];
  requiredRevisionId?: string;
}): Promise<GoogleDocBatchUpdateResponse> {
  const payload: Record<string, unknown> = {
    requests: input.requests,
  };
  if (input.requiredRevisionId) {
    payload.writeControl = { requiredRevisionId: input.requiredRevisionId };
  }
  const res = await docsFetch(
    `/${encodeURIComponent(input.documentId)}:batchUpdate`,
    input.accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw docsError(res.status, body);
  }
  return (await res.json()) as GoogleDocBatchUpdateResponse;
}

const KIND_TO_DEFAULT_HEADING: Record<NoteBlockKind, string> = {
  OVERVIEW: "Overview",
  DEFINITION: "Key Definitions",
  CORE_CONCEPT: "Core Concepts",
  EXPLANATION: "Detailed Explanation",
  IMPORTANT_POINTS: "Important Points",
  EXAMPLE: "Examples",
  FORMULA: "Formulas",
  DERIVATION: "Derivations",
  APPLICATION: "Applications",
  COMMON_MISTAKE: "Common Mistakes",
  EXAM_IMPORTANT: "Exam Important",
  QUESTION: "Practice Questions",
  REFERENCE: "References",
  SUMMARY: "Summary",
  AGENDA: "Agenda",
  DECISION: "Decisions",
  ACTION_ITEM: "Action Items",
  CUSTOM: "Section",
};

const HEADING_TO_KIND: ReadonlyMap<string, NoteBlockKind> = new Map(
  Object.entries(KIND_TO_DEFAULT_HEADING).map(([kind, label]) => [
    label.toLowerCase(),
    kind as NoteBlockKind,
  ])
);

export function resolveBlockKindFromHeading(
  heading: string,
  fallback: NoteBlockKind = "CUSTOM"
): NoteBlockKind {
  const normalized = heading.trim().toLowerCase();
  const exact = HEADING_TO_KIND.get(normalized);
  if (exact) return exact;
  if (normalized.includes("overview") || normalized.includes("introduction")) return "OVERVIEW";
  if (normalized.includes("definition")) return "DEFINITION";
  if (normalized.includes("concept")) return "CORE_CONCEPT";
  if (normalized.includes("formula") || normalized.includes("equation")) return "FORMULA";
  if (normalized.includes("example")) return "EXAMPLE";
  if (normalized.includes("summary") || normalized.includes("takeaway")) return "SUMMARY";
  if (normalized.includes("mistake") || normalized.includes("pitfall")) return "COMMON_MISTAKE";
  if (normalized.includes("exam")) return "EXAM_IMPORTANT";
  if (normalized.includes("action")) return "ACTION_ITEM";
  if (normalized.includes("decision")) return "DECISION";
  if (normalized.includes("agenda")) return "AGENDA";
  return fallback;
}

export interface SyncableNoteBlockInput {
  kind: NoteBlockKind;
  heading: string | null;
  content: unknown;
  order: number;
  metadata?: unknown;
}

interface TiptapNodeLike {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNodeLike[];
}

function serializeInlineContent(nodes: TiptapNodeLike[] | undefined): string {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text ?? "";
      if (node.type === "hardBreak") return "\n";
      if (Array.isArray(node.content)) return serializeInlineContent(node.content);
      return "";
    })
    .join("");
}

/**
 * Converts a Tiptap JSON document into structured lines preserving paragraphs,
 * subheadings (`### `), bullet lists (`- `), and ordered lists (`1. `).
 */
export function serializeTiptapContentToLines(content: unknown): Array<{
  text: string;
  style: "NORMAL_TEXT" | "HEADING_3";
}> {
  if (!content || typeof content !== "object") return [];
  const doc = content as TiptapNodeLike;
  if (!Array.isArray(doc.content)) {
    const plain = extractPlainTextFromTiptap(content).trim();
    return plain ? [{ text: plain, style: "NORMAL_TEXT" }] : [];
  }

  const lines: Array<{ text: string; style: "NORMAL_TEXT" | "HEADING_3" }> = [];

  for (const node of doc.content) {
    if (!node || typeof node !== "object") continue;

    if (node.type === "heading") {
      const text = serializeInlineContent(node.content).trim();
      if (text) lines.push({ text, style: "HEADING_3" });
      continue;
    }

    if (node.type === "bulletList" && Array.isArray(node.content)) {
      for (const item of node.content) {
        const itemText = extractPlainTextFromTiptap(item).replace(/\n+/g, " ").trim();
        if (itemText) {
          lines.push({ text: `- ${itemText}`, style: "NORMAL_TEXT" });
        }
      }
      continue;
    }

    if (node.type === "orderedList" && Array.isArray(node.content)) {
      let idx = 1;
      for (const item of node.content) {
        const itemText = extractPlainTextFromTiptap(item).replace(/\n+/g, " ").trim();
        if (itemText) {
          lines.push({ text: `${idx}. ${itemText}`, style: "NORMAL_TEXT" });
          idx += 1;
        }
      }
      continue;
    }

    const paragraphText = extractPlainTextFromTiptap(node).trim();
    if (paragraphText) {
      for (const line of paragraphText.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          lines.push({ text: trimmed, style: "NORMAL_TEXT" });
        }
      }
    }
  }

  return lines;
}

/**
 * Computes the last valid body index in a Google Doc (`endIndex` of the final
 * structural element). An empty Google Doc has a single newline at index 1..2.
 */
export function getGoogleDocBodyEndIndex(doc: GoogleDocDocument): number {
  const content = doc.body?.content;
  if (!Array.isArray(content) || content.length === 0) return 2;
  const last = content[content.length - 1];
  return typeof last?.endIndex === "number" && last.endIndex >= 2 ? last.endIndex : 2;
}

/**
 * Builds deterministic Google Docs `batchUpdate` requests that replace the body
 * of `existingDoc` with the structured Title + ordered `NoteBlock`s of a Zenote Note.
 */
export function buildGoogleDocReplaceRequests(input: {
  title: string;
  blocks: SyncableNoteBlockInput[];
  existingDocEndIndex?: number;
}): {
  requests: GoogleDocBatchUpdateRequest[];
  canonicalSections: Array<{ heading: string; bodyText: string }>;
} {
  const requests: GoogleDocBatchUpdateRequest[] = [];
  const endIndex = input.existingDocEndIndex ?? 2;

  // Delete existing body content if the doc is non-empty (Google Docs forbids
  // deleting the trailing newline at endIndex - 1).
  if (endIndex > 2) {
    requests.push({
      deleteContentRange: {
        range: { startIndex: 1, endIndex: endIndex - 1 },
      },
    });
  }

  const orderedBlocks = [...input.blocks].sort((a, b) => a.order - b.order);
  const styleRanges: Array<{ startIndex: number; endIndex: number; namedStyleType: string }> = [];
  const canonicalSections: Array<{ heading: string; bodyText: string }> = [];

  let fullText = "";
  let cursor = 1; // Google Docs body starts at UTF-16 index 1

  const cleanTitle = (input.title || "Untitled Note").replace(/\r?\n/g, " ").trim();
  const titleLine = `${cleanTitle}\n`;
  styleRanges.push({
    startIndex: cursor,
    endIndex: cursor + titleLine.length,
    namedStyleType: "HEADING_1",
  });
  fullText += titleLine;
  cursor += titleLine.length;

  for (const block of orderedBlocks) {
    const headingText = (block.heading?.trim() || KIND_TO_DEFAULT_HEADING[block.kind] || "Section")
      .replace(/\r?\n/g, " ")
      .trim();
    const headingLine = `${headingText}\n`;
    styleRanges.push({
      startIndex: cursor,
      endIndex: cursor + headingLine.length,
      namedStyleType: "HEADING_2",
    });
    fullText += headingLine;
    cursor += headingLine.length;

    const lines = serializeTiptapContentToLines(block.content);
    const bodyLines: string[] = [];

    for (const line of lines) {
      const lineStr = `${line.text}\n`;
      styleRanges.push({
        startIndex: cursor,
        endIndex: cursor + lineStr.length,
        namedStyleType: line.style,
      });
      fullText += lineStr;
      cursor += lineStr.length;
      bodyLines.push(line.text);
    }

    canonicalSections.push({
      heading: headingText,
      bodyText: bodyLines.join("\n").trim(),
    });
  }

  if (fullText.length > 0) {
    requests.push({
      insertText: {
        location: { index: 1 },
        text: fullText,
      },
    });

    for (const range of styleRanges) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: range.startIndex, endIndex: range.endIndex },
          paragraphStyle: { namedStyleType: range.namedStyleType },
          fields: "namedStyleType",
        },
      });
    }
  }

  return { requests, canonicalSections };
}

function linesToTiptapDoc(
  lines: Array<{ text: string; isHeading3?: boolean; isBullet?: boolean; isOrdered?: boolean }>
): Record<string, unknown> {
  const content: Record<string, unknown>[] = [];
  let currentBulletItems: Record<string, unknown>[] = [];
  let currentOrderedItems: Record<string, unknown>[] = [];

  const flushLists = () => {
    if (currentBulletItems.length > 0) {
      content.push({ type: "bulletList", content: currentBulletItems });
      currentBulletItems = [];
    }
    if (currentOrderedItems.length > 0) {
      content.push({ type: "orderedList", content: currentOrderedItems });
      currentOrderedItems = [];
    }
  };

  for (const line of lines) {
    const raw = line.text.trim();
    if (!raw) continue;

    const bulletMatch = /^[-*•]\s+(.+)$/.exec(raw);
    const orderedMatch = /^\d+\.\s+(.+)$/.exec(raw);

    if (line.isBullet || bulletMatch) {
      if (currentOrderedItems.length > 0) flushLists();
      const itemText = bulletMatch ? bulletMatch[1]!.trim() : raw;
      currentBulletItems.push({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: itemText }] }],
      });
      continue;
    }

    if (line.isOrdered || orderedMatch) {
      if (currentBulletItems.length > 0) flushLists();
      const itemText = orderedMatch ? orderedMatch[1]!.trim() : raw;
      currentOrderedItems.push({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: itemText }] }],
      });
      continue;
    }

    flushLists();

    if (line.isHeading3) {
      content.push({
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: raw }],
      });
    } else {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: raw }],
      });
    }
  }

  flushLists();

  if (content.length === 0) {
    content.push({ type: "paragraph" });
  }

  return { type: "doc", content };
}

function extractParagraphText(paragraph: GoogleDocParagraph): string {
  const elements = paragraph.elements;
  if (!Array.isArray(elements)) return "";
  let text = "";
  for (const el of elements) {
    if (typeof el.textRun?.content === "string") {
      text += el.textRun.content;
    }
  }
  return text.replace(/\r?\n/g, " ").trim();
}

/**
 * Parses a Google Docs v1 `GoogleDocDocument` into a Zenote note title, ordered
 * `NoteBlock` inputs, and canonical sections for content hashing.
 */
export function parseGoogleDocToNoteBlocks(
  doc: GoogleDocDocument,
  existingBlocks: SyncableNoteBlockInput[] = []
): {
  title: string;
  blocks: SyncableNoteBlockInput[];
  canonicalSections: Array<{ heading: string; bodyText: string }>;
} {
  const structuralElements = doc.body?.content ?? [];
  let parsedTitle = (doc.title || "Untitled Note").trim();
  let titleConsumedFromHeading1 = false;

  interface ParsedSection {
    heading: string;
    lines: Array<{ text: string; isHeading3?: boolean; isBullet?: boolean }>;
  }

  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;

  for (const el of structuralElements) {
    if (el.paragraph) {
      const text = extractParagraphText(el.paragraph);
      if (!text) continue;

      const style = el.paragraph.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT";
      const hasBullet = Boolean(el.paragraph.bullet);

      if ((style === "HEADING_1" || style === "TITLE") && !titleConsumedFromHeading1 && sections.length === 0 && !currentSection) {
        parsedTitle = text;
        titleConsumedFromHeading1 = true;
        continue;
      }

      if (style === "HEADING_2" || /^##\s+/.test(text)) {
        const headingText = text.replace(/^##\s+/, "").trim();
        currentSection = { heading: headingText || "Section", lines: [] };
        sections.push(currentSection);
        continue;
      }

      if (!currentSection) {
        const fallbackHeading =
          existingBlocks[0]?.heading?.trim() ||
          (existingBlocks[0]?.kind ? KIND_TO_DEFAULT_HEADING[existingBlocks[0].kind] : "Overview");
        currentSection = { heading: fallbackHeading, lines: [] };
        sections.push(currentSection);
      }

      currentSection.lines.push({
        text: hasBullet && !/^[-*•]\s+/.test(text) ? `- ${text}` : text,
        isHeading3: style === "HEADING_3",
        isBullet: hasBullet,
      });
    } else if (el.table?.tableRows) {
      if (!currentSection) {
        currentSection = { heading: "Overview", lines: [] };
        sections.push(currentSection);
      }
      for (const row of el.table.tableRows) {
        const cellTexts = (row.tableCells ?? [])
          .map((cell) =>
            (cell.content ?? [])
              .map((cellEl) => (cellEl.paragraph ? extractParagraphText(cellEl.paragraph) : ""))
              .filter(Boolean)
              .join(" ")
          )
          .filter(Boolean);
        if (cellTexts.length > 0) {
          currentSection.lines.push({ text: cellTexts.join(" | ") });
        }
      }
    }
  }

  if (sections.length === 0) {
    sections.push({
      heading: existingBlocks[0]?.heading?.trim() || "Overview",
      lines: [],
    });
  }

  const existingByHeading = new Map<string, SyncableNoteBlockInput>();
  for (const b of existingBlocks) {
    const key = (b.heading?.trim() || KIND_TO_DEFAULT_HEADING[b.kind] || "").toLowerCase();
    if (key && !existingByHeading.has(key)) {
      existingByHeading.set(key, b);
    }
  }

  const blocks: SyncableNoteBlockInput[] = [];
  const canonicalSections: Array<{ heading: string; bodyText: string }> = [];

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]!;
    const matchedExisting = existingByHeading.get(sec.heading.toLowerCase()) ?? existingBlocks[i];
    const kind = matchedExisting
      ? resolveBlockKindFromHeading(sec.heading, matchedExisting.kind)
      : resolveBlockKindFromHeading(sec.heading, i === 0 ? "OVERVIEW" : "CUSTOM");

    const tiptapContent = linesToTiptapDoc(sec.lines);
    blocks.push({
      kind,
      heading: sec.heading,
      content: tiptapContent,
      order: i,
      metadata: matchedExisting?.metadata ?? null,
    });

    canonicalSections.push({
      heading: sec.heading,
      bodyText: sec.lines.map((l) => l.text.trim()).filter(Boolean).join("\n").trim(),
    });
  }

  return { title: parsedTitle, blocks, canonicalSections };
}

/**
 * Computes a deterministic SHA-256 hash of a Note's canonical title and ordered
 * sections so local Zenote notes and remote Google Docs produce the exact same
 * digest when their synchronized content is identical.
 */
export function computeCanonicalNoteSyncHash(input: {
  title: string;
  sections: Array<{ heading: string; bodyText: string }>;
}): string {
  const normalizedTitle = (input.title || "Untitled Note").replace(/\s+/g, " ").trim();
  const normalizedSections = input.sections.map((s) => ({
    heading: s.heading.replace(/\s+/g, " ").trim(),
    body: s.bodyText
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n"),
  }));
  const payload = JSON.stringify({ title: normalizedTitle, sections: normalizedSections });
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Computes the canonical sync hash directly from a Zenote Note's `title` and `NoteBlock[]`.
 */
export function computeLocalNoteSyncHash(
  title: string,
  blocks: SyncableNoteBlockInput[]
): string {
  const { canonicalSections } = buildGoogleDocReplaceRequests({ title, blocks });
  return computeCanonicalNoteSyncHash({ title, sections: canonicalSections });
}
