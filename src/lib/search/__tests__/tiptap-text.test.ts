/**
 * src/lib/search/__tests__/tiptap-text.test.ts
 *
 * Unit tests for Tiptap plain-text extraction and Note plain text composition.
 */

import { describe, expect, it } from "vitest";
import { extractPlainTextFromTiptap, buildNotePlainText } from "@/lib/search/tiptap-text";

describe("extractPlainTextFromTiptap", () => {
  it("returns empty string for null, undefined, and non-object inputs", () => {
    expect(extractPlainTextFromTiptap(null)).toBe("");
    expect(extractPlainTextFromTiptap(undefined)).toBe("");
    expect(extractPlainTextFromTiptap(123)).toBe("");
    expect(extractPlainTextFromTiptap(true)).toBe("");
  });

  it("returns trimmed string if passed a plain string", () => {
    expect(extractPlainTextFromTiptap("  simple text  ")).toBe("simple text");
  });

  it("handles empty doc or empty paragraph without error", () => {
    expect(extractPlainTextFromTiptap({ type: "doc" })).toBe("");
    expect(extractPlainTextFromTiptap({ type: "doc", content: [] })).toBe("");
    expect(extractPlainTextFromTiptap({ type: "doc", content: [{ type: "paragraph" }] })).toBe("");
    expect(extractPlainTextFromTiptap({ type: "doc", content: [{ type: "paragraph", content: [] }] })).toBe("");
  });

  it("extracts text from standard paragraphs and inline marks (bold, italic, link)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", marks: [{ type: "bold" }], text: "world" },
            { type: "text", marks: [{ type: "link", attrs: { href: "https://example.com" } }], text: "!" },
          ],
        },
      ],
    };
    expect(extractPlainTextFromTiptap(doc)).toBe("Hello world!");
  });

  it("separates multiple paragraphs with double newlines", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First paragraph." }] },
        { type: "paragraph", content: [{ type: "text", text: "Second paragraph." }] },
      ],
    };
    expect(extractPlainTextFromTiptap(doc)).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("handles headings, blockquotes, and code blocks with preserved newlines", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Overview" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "A wise quote." }] }] },
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const x = 1;\nconst y = 2;" }],
        },
      ],
    };
    expect(extractPlainTextFromTiptap(doc)).toBe("Overview\n\nA wise quote.\n\nconst x = 1;\nconst y = 2;");
  });

  it("handles nested bullet and ordered lists", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item 1" }] }] },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Item 2" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", content: [{ type: "text", text: "Sub-item 2.1" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractPlainTextFromTiptap(doc)).toBe("Item 1\nItem 2\nSub-item 2.1");
  });

  it("handles hardBreak and tables", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Line 1" },
            { type: "hardBreak" },
            { type: "text", text: "Line 2" },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Col A" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Col B" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Val 1" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Val 2" }] }] },
              ],
            },
          ],
        },
      ],
    };
    expect(extractPlainTextFromTiptap(doc)).toBe("Line 1\nLine 2\n\nCol A  Col B\nVal 1  Val 2");
  });

  it("is resilient to circular references and excessive nesting", () => {
    const circular: Record<string, unknown> = { type: "doc" };
    circular.content = [circular];
    expect(extractPlainTextFromTiptap(circular)).toBe("");
  });
});

describe("buildNotePlainText", () => {
  it("combines title and sorted blocks with headings and content", () => {
    const title = "Cell Biology";
    const blocks = [
      {
        order: 1,
        heading: "Mitochondria",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Powerhouse of the cell." }] }],
        },
      },
      {
        order: 0,
        heading: "Introduction",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Overview of cell anatomy." }] }],
        },
      },
      {
        order: 2,
        heading: null,
        content: { type: "doc", content: [{ type: "paragraph" }] }, // empty block
      },
    ];

    const result = buildNotePlainText(title, blocks);
    expect(result).toBe(
      "Cell Biology\n\nIntroduction\nOverview of cell anatomy.\n\nMitochondria\nPowerhouse of the cell."
    );
  });

  it("handles note with only title", () => {
    expect(buildNotePlainText("Empty Note", [])).toBe("Empty Note");
  });

  it("handles blocks without title", () => {
    const blocks = [
      {
        order: 0,
        heading: "Note Section",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Section details." }] }],
        },
      },
    ];
    expect(buildNotePlainText(null, blocks)).toBe("Note Section\nSection details.");
  });

  it("handles null and undefined title and empty blocks array cleanly", () => {
    expect(buildNotePlainText(undefined, [])).toBe("");
    expect(buildNotePlainText(null, [])).toBe("");
  });
});
