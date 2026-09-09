/**
 * Deterministic, dependency-free chunking for RAG (spec §22).
 *
 * Chunking strategy: whitespace word-splitting with a fixed word-count
 * window and a fixed word-count overlap between consecutive chunks. No
 * tokenizer library is used — see "Known limitations" below for exactly
 * what that trades away. This module has no dependency on any AI/embedding
 * provider and is fully testable without network or DB access.
 *
 * ---- Known limitations (by design, not oversights) ----------------------
 *
 * 1. "Word count" is not "token count". `tokenCount` on MaterialChunk is
 *    populated with a WORD count here, not a real tokenizer's token count
 *    (e.g. BPE). This is an approximation — real tokenizers typically
 *    produce 1.2-1.5x more tokens than words for English text, and a
 *    different ratio entirely for other languages/scripts. The field is
 *    still useful as a rough size signal, but code must not treat it as
 *    an exact token count for provider context-window budgeting. A real
 *    tokenizer can be introduced later once a concrete AI/embedding
 *    provider is chosen (different providers use different tokenizers,
 *    so picking one now would bias toward a provider Phase 5 explicitly
 *    isn't selecting).
 * 2. Whitespace splitting assumes a space-delimited language. It will
 *    under-chunk (produce one enormous "word") for languages that don't
 *    use spaces between words (e.g. Chinese, Japanese, Thai). Not
 *    addressed in this pass.
 * 3. Chunk boundaries are purely positional (every N words), not
 *    sentence- or paragraph-aware. A chunk can start or end mid-sentence.
 *    The fixed word overlap between chunks exists specifically to reduce
 *    (not eliminate) the chance that a fact gets fully severed across a
 *    boundary.
 * 4. No semantic chunking (e.g. splitting on topic shifts). Chunking is
 *    purely mechanical.
 */

export interface ChunkOptions {
  /** Target number of words per chunk. */
  chunkWords?: number;
  /** Number of words repeated at the start of each chunk after the first. */
  overlapWords?: number;
}

export interface TextChunk {
  content: string;
  order: number;
  /** Word count of this chunk — see limitation #1 above; not a real token count. */
  tokenCount: number;
}

const DEFAULT_CHUNK_WORDS = 220;
const DEFAULT_OVERLAP_WORDS = 40;

/**
 * Splits plain text into ordered, overlapping word-count-bounded chunks.
 * Pure function — no I/O, no randomness, same input always produces the
 * same output (needed for the ingestion job to be safely re-run).
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const chunkWords = options.chunkWords ?? DEFAULT_CHUNK_WORDS;
  const overlapWords = options.overlapWords ?? DEFAULT_OVERLAP_WORDS;

  if (chunkWords <= 0) throw new Error("chunkWords must be a positive number.");
  if (overlapWords < 0 || overlapWords >= chunkWords) {
    throw new Error("overlapWords must be >= 0 and less than chunkWords.");
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const step = chunkWords - overlapWords;
  const chunks: TextChunk[] = [];

  for (let start = 0, order = 0; start < words.length; start += step, order += 1) {
    const slice = words.slice(start, start + chunkWords);
    chunks.push({ content: slice.join(" "), order, tokenCount: slice.length });
    if (start + chunkWords >= words.length) break;
  }

  return chunks;
}

export interface TimedWordSource {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface TimedTextChunk extends TextChunk {
  startSeconds: number;
  endSeconds: number;
}

/**
 * Chunks a transcript's segments into TimedTextChunks: each chunk's
 * startSeconds/endSeconds spans from the first to the last transcript
 * segment whose words landed in that chunk, so a citation can still jump
 * playback to (approximately) the right moment even though chunk
 * boundaries don't align with segment boundaries.
 */
export function chunkTranscriptSegments(
  segments: TimedWordSource[],
  options: ChunkOptions = {}
): TimedTextChunk[] {
  // Flatten to one entry per word, each remembering which segment (and
  // thus which timestamp range) it came from.
  const words: { word: string; startSeconds: number; endSeconds: number }[] = [];
  for (const segment of segments) {
    const segmentWords = segment.text.trim().split(/\s+/).filter(Boolean);
    for (const word of segmentWords) {
      words.push({ word, startSeconds: segment.startSeconds, endSeconds: segment.endSeconds });
    }
  }
  if (words.length === 0) return [];

  const chunkWords = options.chunkWords ?? DEFAULT_CHUNK_WORDS;
  const overlapWords = options.overlapWords ?? DEFAULT_OVERLAP_WORDS;
  if (chunkWords <= 0) throw new Error("chunkWords must be a positive number.");
  if (overlapWords < 0 || overlapWords >= chunkWords) {
    throw new Error("overlapWords must be >= 0 and less than chunkWords.");
  }

  const step = chunkWords - overlapWords;
  const chunks: TimedTextChunk[] = [];

  for (let start = 0, order = 0; start < words.length; start += step, order += 1) {
    const slice = words.slice(start, start + chunkWords);
    const first = slice[0];
    const last = slice[slice.length - 1];
    // Unreachable in practice: `start < words.length` guarantees
    // `slice` has at least one element every iteration. The check exists
    // only to satisfy noUncheckedIndexedAccess without a bare `!`
    // assertion, and to fail loudly (not silently mis-chunk) if that
    // invariant is ever broken by a future edit.
    if (!first || !last) throw new Error("chunkTranscriptSegments: produced an empty slice unexpectedly.");
    chunks.push({
      content: slice.map((w) => w.word).join(" "),
      order,
      tokenCount: slice.length,
      startSeconds: first.startSeconds,
      endSeconds: last.endSeconds,
    });
    if (start + chunkWords >= words.length) break;
  }

  return chunks;
}

/** One page's (or slide's) worth of extracted text — DocumentProcessingService's `pages` result. */
export interface PageSource {
  pageNumber: number;
  text: string;
}

export interface PagedTextChunk extends TextChunk {
  pageNumber: number;
}

/**
 * Chunks page-level extracted text (currently: PDF pages, PPTX slides —
 * see Material.extractedPages / document-processing-local.ts) into
 * PagedTextChunks, each carrying the pageNumber of the page it came from.
 *
 * Chunking happens PER PAGE, reusing chunkText() as-is for each page's
 * text — a chunk never spans two pages, so page attribution is always
 * exact rather than approximated. This is a deliberate tradeoff: a fact
 * split across a page boundary in the source PDF can end up split across
 * two chunks with no overlap between them (chunkText's overlapWords only
 * applies within a page), same as it can already be split across two
 * pages in the source document itself. The alternative — flattening all
 * pages into one text blob and chunking across the concatenation — would
 * make citations point at the wrong page for any chunk that happens to
 * straddle a page boundary, which is strictly worse for a "PDF • Page X"
 * citation than an occasional missed cross-page overlap.
 *
 * `order` is assigned continuously across the whole document (not reset
 * per page), matching chunkText/chunkTranscriptSegments's existing
 * "one ascending order per material" convention that runEmbeddingJob's
 * insert relies on.
 *
 * Pages with no extractable text (e.g. a blank page) simply contribute
 * zero chunks — chunkText already returns [] for empty/whitespace-only
 * input — rather than needing special-case handling here. Page order in
 * the output follows the order pages are given in `pages`; callers pass
 * Material.extractedPages, which DocumentProcessingService always
 * produces already sorted by pageNumber (see document-processing-local.ts).
 */
export function chunkPagedText(pages: PageSource[], options: ChunkOptions = {}): PagedTextChunk[] {
  const chunks: PagedTextChunk[] = [];
  let order = 0;

  for (const page of pages) {
    for (const chunk of chunkText(page.text, options)) {
      chunks.push({ ...chunk, order, pageNumber: page.pageNumber });
      order += 1;
    }
  }

  return chunks;
}

/**
 * Validates Material.extractedPages (a raw, untyped Prisma JsonValue) into
 * a real PageSource[] before handing it to chunkPagedText. Defensive
 * rather than trusting the column's shape at the type level — the field
 * is only ever written by runDocumentExtractionJob (document-
 * extraction.ts) today, but a Json column has no schema-level guarantee,
 * and a malformed/foreign value here should make the caller fall back to
 * plain-text chunking rather than crash the embedding job or silently
 * produce garbage chunks. Pure and DB-free, so it's directly unit
 * testable — same convention as the rest of this module.
 */
export function parseExtractedPages(value: unknown): PageSource[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const pages: PageSource[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).pageNumber !== "number" ||
      typeof (entry as Record<string, unknown>).text !== "string"
    ) {
      return null;
    }
    pages.push({
      pageNumber: (entry as { pageNumber: number }).pageNumber,
      text: (entry as { text: string }).text,
    });
  }
  return pages;
}
