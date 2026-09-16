import { describe, expect, it } from "vitest";
import {
  buildContextBlock,
  chunksToSources,
  formatChunkLabel,
  toChatMessages,
  TUTOR_SYSTEM_INSTRUCTION,
} from "@/lib/ai-chat";
import type { RetrievedChunk } from "@/lib/retrieval";

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "chunk_1",
    materialId: "material_1",
    materialTitle: "Lecture 12",
    content: "The zeroth law states that if two systems are in thermal equilibrium...",
    pageNumber: null,
    startSeconds: null,
    endSeconds: null,
    similarity: 0.87,
    ...overrides,
  };
}

describe("formatChunkLabel", () => {
  it("formats a timestamped (audio/video) chunk with mm:ss", () => {
    expect(formatChunkLabel(makeChunk({ startSeconds: 765 }))).toBe("Lecture 12 — 12:45");
  });

  it("formats a paginated (document) chunk with a page number", () => {
    expect(formatChunkLabel(makeChunk({ materialTitle: "Thermodynamics.pdf", pageNumber: 8 }))).toBe(
      "Thermodynamics.pdf — Page 8"
    );
  });

  it("falls back to just the material title when neither is present", () => {
    expect(formatChunkLabel(makeChunk({ materialTitle: "Notes.txt" }))).toBe("Notes.txt");
  });

  it("prefers the timestamp over the page number when both are somehow present", () => {
    expect(formatChunkLabel(makeChunk({ startSeconds: 60, pageNumber: 3 }))).toBe("Lecture 12 — 1:00");
  });
});

describe("chunksToSources", () => {
  it("returns an empty array for no chunks", () => {
    expect(chunksToSources([])).toEqual([]);
  });

  it("maps a timestamped chunk to a source with timestampSeconds and no page", () => {
    const sources = chunksToSources([makeChunk({ startSeconds: 45 })]);
    expect(sources).toEqual([{ materialId: "material_1", label: "Lecture 12 — 0:45", timestampSeconds: 45 }]);
  });

  it("maps a paginated chunk to a source with page and no timestampSeconds", () => {
    const sources = chunksToSources([makeChunk({ pageNumber: 4, materialTitle: "Notes.pdf" })]);
    expect(sources).toEqual([{ materialId: "material_1", label: "Notes.pdf — Page 4", page: 4 }]);
  });
});

describe("buildContextBlock", () => {
  it("returns null (not an empty string) when there are no chunks", () => {
    expect(buildContextBlock([])).toBeNull();
  });

  it("numbers each chunk and includes its source label and content", () => {
    const block = buildContextBlock([
      makeChunk({ startSeconds: 30, content: "First chunk text." }),
      makeChunk({ id: "chunk_2", startSeconds: 90, content: "Second chunk text." }),
    ]);
    expect(block).toContain("[1] Source: Lecture 12 — 0:30");
    expect(block).toContain("First chunk text.");
    expect(block).toContain("[2] Source: Lecture 12 — 1:30");
    expect(block).toContain("Second chunk text.");
  });
});

describe("TUTOR_SYSTEM_INSTRUCTION", () => {
  it("meaningfully distinguishes Tutor from a general-purpose assistant", () => {
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/tutor/i);
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/not a general-purpose assistant/i);
  });

  it("instructs teaching progressively rather than dumping answers", () => {
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/teach/i);
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/progressively/i);
  });

  it("instructs using the supplied material as the primary factual source and never inventing facts", () => {
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/primary factual source/i);
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/do not invent facts/i);
  });

  it("instructs admitting when the material is insufficient, rather than fabricating", () => {
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/doesn't contain enough information/i);
  });

  it("instructs asking check-understanding questions where appropriate", () => {
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/check-understanding question/i);
  });

  it("instructs never claiming unsupported information came from the student's own materials", () => {
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/never claim something came from the student's own materials/i);
  });

  it("instructs staying scoped to the Topic and declining to act as an unrestricted assistant", () => {
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/stay scoped to this topic/i);
    expect(TUTOR_SYSTEM_INSTRUCTION).toMatch(/decline requests to act as an unrestricted assistant/i);
  });
});

describe("toChatMessages", () => {
  it("lowercases roles to match AIChatMessage's expected shape", () => {
    expect(
      toChatMessages([
        { role: "USER", content: "What is the zeroth law?" },
        { role: "ASSISTANT", content: "It states..." },
        { role: "SYSTEM", content: "You are a helpful tutor." },
      ])
    ).toEqual([
      { role: "user", content: "What is the zeroth law?" },
      { role: "assistant", content: "It states..." },
      { role: "system", content: "You are a helpful tutor." },
    ]);
  });
});
