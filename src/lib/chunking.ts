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

/**
 * A single source unit chunking can draw text from — currently only
 * TranscriptSegment rows (audio/video). DocumentProcessingService (PDF/
 * DOCX/PPTX text extraction) has no concrete implementation yet (see
 * ARCHITECTURE.md), so there is no page-based source to chunk from in
 * this codebase state — extending this to page-based sources later only
 * requires a sibling function, not a change to chunkText itself.
 */
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
