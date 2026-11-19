/**
 * Tier 1 — Feature 6: Note Plain-Text Extraction
 *
 * Verifies deterministic plain-text extraction from ProseMirror / Tiptap block ASTs
 * into Note.plainText for PostgreSQL full-text search indexing (GIN) and vector chunking.
 */

import { describe, it, expect } from "vitest";
import { extractPlainTextFromTiptap } from "@/lib/search/tiptap-text";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse } from "../harness/contracts";

describe("Tier 1 — Feat 06: Note Plain-Text Extraction", () => {
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };

  it("extracts text from standard ProseMirror paragraphs and headings with clean newline separation", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Introduction to DNA Helicase" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Helicase enzymes unwind double-stranded DNA during replication.",
            },
          ],
        },
      ],
    };

    const extracted = extractPlainTextFromTiptap(doc);
    expect(extracted).toContain("Introduction to DNA Helicase");
    expect(extracted).toContain("Helicase enzymes unwind double-stranded DNA during replication.");
    expect(extracted).toBe(
      "Introduction to DNA Helicase\n\nHelicase enzymes unwind double-stranded DNA during replication."
    );
  });

  it("handles nested structures like bullet lists, ordered lists, and blockquotes", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Important rule of replication" }],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Requires ATP hydrolysis" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Moves in 5' to 3' polarity" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const extracted = extractPlainTextFromTiptap(doc);
    expect(extracted).toContain("Important rule of replication");
    expect(extracted).toContain("Requires ATP hydrolysis");
    expect(extracted).toContain("Moves in 5' to 3' polarity");
  });

  it("strips inline mark formatting (bold, italic, code, links) while seamlessly retaining inner text", () => {
    const doc = {
      type: "paragraph",
      content: [
        {
          type: "text",
          marks: [{ type: "bold" }],
          text: "DNA Polymerase III",
        },
        {
          type: "text",
          text: " has high ",
        },
        {
          type: "text",
          marks: [{ type: "italic" }],
          text: "processivity",
        },
        {
          type: "text",
          text: " due to the ",
        },
        {
          type: "text",
          marks: [{ type: "code" }],
          text: "beta-clamp",
        },
        {
          type: "text",
          text: " subunit.",
        },
      ],
    };

    const extracted = extractPlainTextFromTiptap(doc);
    expect(extracted).toBe("DNA Polymerase III has high processivity due to the beta-clamp subunit.");
  });

  it("defensively handles malformed ASTs, null, undefined, primitives, and empty objects without crashing", () => {
    expect(extractPlainTextFromTiptap(null)).toBe("");
    expect(extractPlainTextFromTiptap(undefined)).toBe("");
    expect(extractPlainTextFromTiptap("")).toBe("");
    expect(extractPlainTextFromTiptap(12345)).toBe("");
    expect(extractPlainTextFromTiptap({})).toBe("");
    expect(extractPlainTextFromTiptap({ type: "doc", content: [] })).toBe("");
    expect(
      extractPlainTextFromTiptap({
        type: "doc",
        content: [{ type: "unknownCustomBlock", content: [{ type: "text", text: "Fallback text" }] }],
      })
    ).toBe("Fallback text");
  });

  it("normalizes excessive whitespace, collapses multiple blank lines, and trims ends", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "   Leading spaces and    multiple    internal spaces.   " }],
        },
        {
          type: "paragraph",
          content: [], // empty paragraph
        },
        {
          type: "paragraph",
          content: [], // another empty paragraph
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Follow up text." }],
        },
      ],
    };

    const extracted = extractPlainTextFromTiptap(doc);
    expect(extracted).not.toMatch(/\n{3,}/); // Never more than 2 consecutive newlines
    expect(extracted).toContain("Leading spaces and    multiple    internal spaces.");
    expect(extracted).toContain("Follow up text.");
    expect(extracted.startsWith(" ")).toBe(false);
    expect(extracted.endsWith(" ")).toBe(false);
  });

  it("verifies Note entities with extracted plainText are retrievable via lexical search", async () => {
    const harness = new SearchTestHarness();
    harness.reset();

    // Query terms that only exist in the extracted Note plainText (not in title)
    // Seed note-dna-helicase plainText has "hydrogen bonds between base pairs"
    const res = await harness.dispatchSearchApiJson(
      { q: "breaking hydrogen bonds between base pairs", mode: "lexical", types: "note" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    const hit = res.data.hits.find((h) => h.id === "note-dna-helicase");
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe("note");
    expect(hit?.snippet).toContain("hydrogen bonds");
  });
});
