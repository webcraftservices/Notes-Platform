import { describe, expect, it } from "vitest";
import { chunkPagedText, chunkText, chunkTranscriptSegments, parseExtractedPages } from "@/lib/chunking";

/** Indexes into an array and asserts the element exists (tsconfig has noUncheckedIndexedAccess on). */
function nth<T>(arr: T[], i: number): T {
  const value = arr[i];
  expect(value).toBeDefined();
  return value as T;
}

describe("chunkText", () => {
  it("returns no chunks for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\t  ")).toEqual([]);
  });

  it("returns a single chunk when text is shorter than the chunk window", () => {
    const chunks = chunkText("one two three", { chunkWords: 220, overlapWords: 40 });
    expect(chunks).toHaveLength(1);
    const chunk = nth(chunks, 0);
    expect(chunk.content).toBe("one two three");
    expect(chunk.order).toBe(0);
    expect(chunk.tokenCount).toBe(3);
  });

  it("splits long text into multiple ordered chunks", () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
    const chunks = chunkText(words.join(" "), { chunkWords: 100, overlapWords: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => expect(chunk.order).toBe(i));
    // Every chunk except possibly the last is exactly the requested size.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.tokenCount).toBe(100);
    }
  });

  it("overlaps consecutive chunks by the configured word count", () => {
    const words = Array.from({ length: 300 }, (_, i) => `w${i}`);
    const chunks = chunkText(words.join(" "), { chunkWords: 100, overlapWords: 20 });

    const firstChunkWords = nth(chunks, 0).content.split(" ");
    const secondChunkWords = nth(chunks, 1).content.split(" ");
    // Last 20 words of chunk 0 should equal first 20 words of chunk 1.
    expect(firstChunkWords.slice(-20)).toEqual(secondChunkWords.slice(0, 20));
  });

  it("never loses or reorders words at the very start and end of the text", () => {
    const words = Array.from({ length: 733 }, (_, i) => `token${i}`);
    const text = words.join(" ");
    const chunks = chunkText(text, { chunkWords: 220, overlapWords: 40 });

    expect(words.length).toBeGreaterThan(0);
    expect(nth(chunks, chunks.length - 1).content.endsWith(`token${words.length - 1}`)).toBe(true);
    expect(nth(chunks, 0).content.startsWith("token0")).toBe(true);
  });

  it("throws on invalid chunkWords/overlapWords configuration", () => {
    expect(() => chunkText("hello world", { chunkWords: 0 })).toThrow(/chunkWords/);
    expect(() => chunkText("hello world", { chunkWords: 10, overlapWords: 10 })).toThrow(/overlapWords/);
    expect(() => chunkText("hello world", { chunkWords: 10, overlapWords: -1 })).toThrow(/overlapWords/);
  });

  it("is deterministic — same input always produces the same output", () => {
    const text = "the quick brown fox jumps over the lazy dog ".repeat(50);
    expect(chunkText(text)).toEqual(chunkText(text));
  });
});

describe("chunkTranscriptSegments", () => {
  it("returns no chunks for an empty segment list", () => {
    expect(chunkTranscriptSegments([])).toEqual([]);
  });

  it("carries a single segment's timestamps through when everything fits in one chunk", () => {
    const chunks = chunkTranscriptSegments(
      [{ text: "thermal equilibrium means equal temperature", startSeconds: 10, endSeconds: 20 }],
      { chunkWords: 220, overlapWords: 40 }
    );
    expect(chunks).toHaveLength(1);
    const chunk = nth(chunks, 0);
    expect(chunk.startSeconds).toBe(10);
    expect(chunk.endSeconds).toBe(20);
  });

  it("spans startSeconds/endSeconds across the segments a chunk's words came from", () => {
    const segments = [
      { text: "one two three four five", startSeconds: 0, endSeconds: 5 },
      { text: "six seven eight nine ten", startSeconds: 5, endSeconds: 10 },
      { text: "eleven twelve thirteen fourteen fifteen", startSeconds: 10, endSeconds: 15 },
    ];
    const chunks = chunkTranscriptSegments(segments, { chunkWords: 15, overlapWords: 0 });
    expect(chunks).toHaveLength(1);
    const chunk = nth(chunks, 0);
    expect(chunk.startSeconds).toBe(0);
    expect(chunk.endSeconds).toBe(15);
  });

  it("splits across multiple chunks and each chunk's timestamps reflect only its own words", () => {
    const segments = [
      { text: Array.from({ length: 100 }, (_, i) => `a${i}`).join(" "), startSeconds: 0, endSeconds: 100 },
      { text: Array.from({ length: 100 }, (_, i) => `b${i}`).join(" "), startSeconds: 100, endSeconds: 200 },
    ];
    const chunks = chunkTranscriptSegments(segments, { chunkWords: 80, overlapWords: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    const firstChunk = nth(chunks, 0);
    expect(firstChunk.startSeconds).toBe(0);
    expect(firstChunk.endSeconds).toBe(100);
    // A later chunk whose words are entirely from the second segment
    // should carry that segment's timestamps, not the first's.
    const lastChunk = nth(chunks, chunks.length - 1);
    expect(lastChunk.endSeconds).toBe(200);
  });
});

describe("chunkPagedText", () => {
  it("returns no chunks for an empty page list", () => {
    expect(chunkPagedText([])).toEqual([]);
  });

  it("a single page produces chunks with the correct pageNumber", () => {
    const chunks = chunkPagedText([{ pageNumber: 1, text: "thermal equilibrium means equal temperature" }]);
    expect(chunks).toHaveLength(1);
    const chunk = nth(chunks, 0);
    expect(chunk.pageNumber).toBe(1);
    expect(chunk.content).toBe("thermal equilibrium means equal temperature");
    expect(chunk.order).toBe(0);
  });

  it("a large page produces multiple chunks and every chunk retains the same pageNumber", () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
    const chunks = chunkPagedText([{ pageNumber: 5, text: words.join(" ") }], { chunkWords: 100, overlapWords: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.pageNumber).toBe(5);
    }
  });

  it("multiple pages produce chunks with correct page provenance and preserved ordering", () => {
    const page1Words = Array.from({ length: 300 }, (_, i) => `p1w${i}`);
    const page2Words = Array.from({ length: 300 }, (_, i) => `p2w${i}`);
    const chunks = chunkPagedText(
      [
        { pageNumber: 1, text: page1Words.join(" ") },
        { pageNumber: 2, text: page2Words.join(" ") },
      ],
      { chunkWords: 100, overlapWords: 0 }
    );

    // No chunk mixes words from both pages.
    for (const chunk of chunks) {
      const isPage1 = chunk.content.includes("p1w") && !chunk.content.includes("p2w");
      const isPage2 = chunk.content.includes("p2w") && !chunk.content.includes("p1w");
      expect(isPage1 || isPage2).toBe(true);
      if (isPage1) expect(chunk.pageNumber).toBe(1);
      if (isPage2) expect(chunk.pageNumber).toBe(2);
    }

    // All page-1 chunks precede all page-2 chunks, and `order` is
    // continuous (not reset per page).
    const page1Chunks = chunks.filter((c) => c.pageNumber === 1);
    const page2Chunks = chunks.filter((c) => c.pageNumber === 2);
    expect(page1Chunks.length).toBeGreaterThan(0);
    expect(page2Chunks.length).toBeGreaterThan(0);
    chunks.forEach((chunk, i) => expect(chunk.order).toBe(i));
    expect(Math.max(...page1Chunks.map((c) => c.order))).toBeLessThan(Math.min(...page2Chunks.map((c) => c.order)));
  });

  it("empty or whitespace-only pages contribute zero chunks without throwing", () => {
    const chunks = chunkPagedText([
      { pageNumber: 1, text: "real content on page one" },
      { pageNumber: 2, text: "   \n\t  " },
      { pageNumber: 3, text: "" },
      { pageNumber: 4, text: "real content on page four" },
    ]);

    expect(chunks.every((c) => c.pageNumber === 1 || c.pageNumber === 4)).toBe(true);
    expect(chunks.some((c) => c.pageNumber === 1)).toBe(true);
    expect(chunks.some((c) => c.pageNumber === 4)).toBe(true);
  });

  it("preserves page ordering as given, not sorted", () => {
    // Pages are always produced already sorted by the extractor, but the
    // function itself shouldn't silently re-sort — it should chunk in
    // the order it's given.
    const chunks = chunkPagedText([
      { pageNumber: 2, text: "second page text" },
      { pageNumber: 1, text: "first page text" },
    ]);
    expect(chunks.map((c) => c.pageNumber)).toEqual([2, 1]);
  });

  it("is deterministic — same input always produces the same output", () => {
    const pages = [
      { pageNumber: 1, text: "the quick brown fox jumps over the lazy dog ".repeat(30) },
      { pageNumber: 2, text: "pack my box with five dozen liquor jugs ".repeat(30) },
    ];
    expect(chunkPagedText(pages)).toEqual(chunkPagedText(pages));
  });
});
describe("parseExtractedPages", () => {
  it("parses a well-formed pages array from Material.extractedPages", () => {
    const value = [
      { pageNumber: 1, text: "first" },
      { pageNumber: 2, text: "second" },
    ];
    expect(parseExtractedPages(value)).toEqual(value);
  });

  it("returns null for null/undefined (Material.extractedPages not set)", () => {
    expect(parseExtractedPages(null)).toBeNull();
    expect(parseExtractedPages(undefined)).toBeNull();
  });

  it("returns null for a non-array value", () => {
    expect(parseExtractedPages({ pageNumber: 1, text: "not wrapped in an array" })).toBeNull();
    expect(parseExtractedPages("just a string")).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(parseExtractedPages([])).toBeNull();
  });

  it("returns null when an entry is missing pageNumber or text, or has the wrong type", () => {
    expect(parseExtractedPages([{ pageNumber: 1 }])).toBeNull();
    expect(parseExtractedPages([{ text: "no page number" }])).toBeNull();
    expect(parseExtractedPages([{ pageNumber: "1", text: "pageNumber is a string" }])).toBeNull();
    expect(parseExtractedPages([{ pageNumber: 1, text: "ok" }, { pageNumber: 2 }])).toBeNull();
  });
});
