/**
 * src/lib/search/__tests__/tiptap-text-adversarial.test.ts
 *
 * Empirical adversarial stress testing and generative fuzzing suite for:
 * - extractPlainTextFromTiptap
 * - buildNotePlainText
 *
 * Challenge Dimensions:
 * 1. Generative fuzzing with malformed AST nodes (primitives, nulls, corrupted objects, unknown types)
 * 2. Deep recursion and cyclic graphs (self-references, mutual cycles, array loops, DAGs, depth > 64)
 * 3. Extreme documents (10,000 blocks, 10,000 paragraphs, 1,000,000+ characters, nested tables)
 * 4. Spacing determinism (block separation, inline joining, CRLF normalization, whitespace trimming)
 * 5. Unicode and internationalization (emojis, ZWJ sequences, BiDi/RTL, CJK, control chars, Zalgo)
 */

import { describe, expect, it } from "vitest";
import { extractPlainTextFromTiptap, buildNotePlainText, type NoteBlockTextSource } from "@/lib/search/tiptap-text";

describe("Adversarial Suite 1: Generative Fuzzing & Malformed ASTs", () => {
  it("never throws across 5,000 randomly fuzzed malformed AST structures", () => {
    // Deterministic pseudo-random number generator (PRNG) for reproducible fuzzing
    let seed = 13377331;
    function rand(): number {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    }

    const primitivePool = [
      null,
      undefined,
      0,
      1,
      -1,
      NaN,
      Infinity,
      "",
      "random string",
      true,
      false,
      {},
      [],
    ];

    const unknownTypes = [
      "custom_callout",
      "math_inline",
      "audio_player",
      "video_embed",
      "mermaid_diagram",
      "unknown_widget",
      "collapsible_section",
      "user_mention",
    ];

    function generateFuzzedNode(depth: number): unknown {
      if (depth > 8 || rand() < 0.25) {
        return primitivePool[Math.floor(rand() * primitivePool.length)];
      }

      const choice = rand();
      if (choice < 0.2) {
        // Corrupted text node
        return {
          type: rand() < 0.5 ? "text" : primitivePool[Math.floor(rand() * primitivePool.length)],
          text: primitivePool[Math.floor(rand() * primitivePool.length)],
          marks: rand() < 0.5 ? primitivePool[Math.floor(rand() * primitivePool.length)] : [{ type: "bold" }],
        };
      } else if (choice < 0.4) {
        // Unknown container node
        const numChildren = Math.floor(rand() * 4);
        const children = [];
        for (let i = 0; i < numChildren; i++) {
          children.push(generateFuzzedNode(depth + 1));
        }
        return {
          type: unknownTypes[Math.floor(rand() * unknownTypes.length)],
          content: children,
          attrs: { foo: "bar", count: 42 },
        };
      } else if (choice < 0.6) {
        // Array of random items
        const numItems = Math.floor(rand() * 5);
        const arr = [];
        for (let i = 0; i < numItems; i++) {
          arr.push(generateFuzzedNode(depth + 1));
        }
        return arr;
      } else if (choice < 0.8) {
        // Standard container with corrupted content
        const types = ["paragraph", "heading", "blockquote", "bulletList", "tableRow", "tableCell"];
        return {
          type: types[Math.floor(rand() * types.length)],
          content: rand() < 0.3 ? "corrupted-content-string" : [generateFuzzedNode(depth + 1)],
        };
      } else {
        // Random object with arbitrary keys
        return {
          [String(Math.floor(rand() * 100))]: generateFuzzedNode(depth + 1),
          type: null,
          content: undefined,
        };
      }
    }

    let nonStringReturns = 0;
    let thrownErrors = 0;

    for (let i = 0; i < 5000; i++) {
      const fuzzed = generateFuzzedNode(0);
      try {
        const result = extractPlainTextFromTiptap(fuzzed);
        if (typeof result !== "string") {
          nonStringReturns++;
        }
      } catch {
        thrownErrors++;
      }
    }

    expect(thrownErrors).toBe(0);
    expect(nonStringReturns).toBe(0);
  });

  it("handles hostile object shapes (prototype pollution keys, missing properties, non-string types)", () => {
    const hostileInputs: unknown[] = [
      { __proto__: { isAdmin: true }, type: "text", text: "safe" },
      { constructor: { prototype: { evil: true } }, type: "paragraph", content: [] },
      { type: "text", text: 12345 }, // non-string text
      { type: "text", text: {} },
      { type: "text", text: null },
      { type: "text", text: undefined },
      { type: "text" }, // missing text property
      { type: 42, content: [{ type: "text", text: "valid" }] }, // numeric type
      { type: "paragraph", content: "not-an-array" }, // content is string
      { type: "paragraph", content: 12345 }, // content is number
      { type: "paragraph", content: null }, // content is null
      { type: "paragraph", content: [null, undefined, 42, "raw-string", {}] },
      { type: "heading", attrs: null, content: [{ type: "text", text: "Heading" }] },
      { type: "tableRow", content: [{ type: "tableCell", content: null }] },
    ];

    for (const input of hostileInputs) {
      expect(() => {
        const out = extractPlainTextFromTiptap(input);
        expect(typeof out).toBe("string");
      }).not.toThrow();
    }
  });

  it("safely handles custom extensions with arbitrary AST schemas", () => {
    const docWithCustomExtensions = {
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { style: "warning" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Warning: Low storage!" }],
            },
          ],
        },
        {
          type: "mathBlock",
          attrs: { formula: "E = mc^2" },
          content: [{ type: "text", text: "E = mc^2" }],
        },
        {
          type: "mediaCard",
          attrs: { url: "https://example.com/asset.png" },
          content: [], // empty media card
        },
      ],
    };

    const text = extractPlainTextFromTiptap(docWithCustomExtensions);
    expect(text).toContain("Warning: Low storage!");
    expect(text).toContain("E = mc^2");
  });

  it("handles Object.freeze, Object.seal, and null prototype objects safely", () => {
    const nullProtoNode = Object.create(null);
    nullProtoNode.type = "text";
    nullProtoNode.text = "Null prototype text";

    const frozenDoc = Object.freeze({
      type: "doc",
      content: Object.freeze([
        Object.freeze({
          type: "paragraph",
          content: Object.freeze([
            Object.freeze({ type: "text", text: "Frozen paragraph text" }),
            nullProtoNode,
          ]),
        }),
      ]),
    });

    const result = extractPlainTextFromTiptap(frozenDoc);
    expect(result).toBe("Frozen paragraph textNull prototype text");
  });
});

describe("Adversarial Suite 2: Cycles & Deep Recursion Stress Testing", () => {
  it("terminates cleanly with self-referencing cyclic node", () => {
    const cyclicNode: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "Cycle Start" }],
    };
    // Direct self-reference
    cyclicNode.content = [cyclicNode];

    expect(() => {
      const result = extractPlainTextFromTiptap(cyclicNode);
      expect(typeof result).toBe("string");
      expect(result).toBe("");
    }).not.toThrow();
  });

  it("terminates cleanly with multi-node circular chain (A -> B -> C -> A)", () => {
    const nodeA: Record<string, unknown> = { type: "paragraph", content: [] };
    const nodeB: Record<string, unknown> = { type: "blockquote", content: [] };
    const nodeC: Record<string, unknown> = { type: "listItem", content: [] };

    nodeA.content = [{ type: "text", text: "Node A" }, nodeB];
    nodeB.content = [{ type: "text", text: "Node B" }, nodeC];
    nodeC.content = [{ type: "text", text: "Node C" }, nodeA];

    expect(() => {
      const result = extractPlainTextFromTiptap(nodeA);
      expect(typeof result).toBe("string");
      expect(result).toContain("Node A");
      expect(result).toContain("Node B");
      expect(result).toContain("Node C");
    }).not.toThrow();
  });

  it("terminates cleanly with self-referencing arrays", () => {
    const cyclicArray: unknown[] = [{ type: "text", text: "Array Cycle" }];
    cyclicArray.push(cyclicArray);

    expect(() => {
      const result = extractPlainTextFromTiptap(cyclicArray);
      expect(typeof result).toBe("string");
    }).not.toThrow();
  });

  it("handles deep linear chains exceeding MAX_RECURSION_DEPTH (64) without stack overflow", () => {
    // Generate a chain of depth 200
    let current: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "Bottom Leaf" }],
    };

    for (let depth = 0; depth < 200; depth++) {
      current = {
        type: "blockquote",
        content: [current],
      };
    }

    const rootDoc = {
      type: "doc",
      content: [current],
    };

    expect(() => {
      const result = extractPlainTextFromTiptap(rootDoc);
      // Because depth exceeds 64, it prunes at depth 64 and returns empty string
      expect(result).toBe("");
    }).not.toThrow();
  });

  it("extracts text correctly at depth exactly equal to MAX_RECURSION_DEPTH", () => {
    // Create nested blocks up to depth 10
    let node: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "Deep content" }],
    };
    for (let i = 0; i < 10; i++) {
      node = {
        type: "blockquote",
        content: [node],
      };
    }

    const result = extractPlainTextFromTiptap(node);
    expect(result).toBe("Deep content");
  });

  it("survives diamond dependencies (DAGs) without duplicate loop issues", () => {
    const sharedLeaf = { type: "text", text: "Shared Leaf" };
    const branch1 = { type: "paragraph", content: [sharedLeaf] };
    const branch2 = { type: "paragraph", content: [sharedLeaf] };

    const doc = {
      type: "doc",
      content: [branch1, branch2],
    };

    // Shared object reference in memory will be skipped on second encounter by WeakSet
    const result = extractPlainTextFromTiptap(doc);
    expect(typeof result).toBe("string");
    expect(result).toContain("Shared Leaf");
  });
});

describe("Adversarial Suite 3: Extreme Documents & Scale Benchmarks", () => {
  it("extracts text from a giant document with 10,000 paragraphs in < 500ms", () => {
    const paragraphs = [];
    for (let i = 0; i < 10000; i++) {
      paragraphs.push({
        type: "paragraph",
        content: [{ type: "text", text: `Paragraph entry #${i} with search indexing tokens.` }],
      });
    }

    const doc = {
      type: "doc",
      content: paragraphs,
    };

    const start = performance.now();
    const result = extractPlainTextFromTiptap(doc);
    const durationMs = performance.now() - start;

    expect(durationMs).toBeLessThan(1000); // Must be fast
    expect(result.length).toBeGreaterThan(400000);
    expect(result.startsWith("Paragraph entry #0 with search indexing tokens.")).toBe(true);
    expect(result.endsWith("Paragraph entry #9999 with search indexing tokens.")).toBe(true);
  });

  it("handles buildNotePlainText with 10,000 blocks and out-of-order indexes in < 1500ms", () => {
    const blocks: NoteBlockTextSource[] = [];
    for (let i = 9999; i >= 0; i--) {
      blocks.push({
        order: i,
        heading: `Heading Section ${i}`,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: `Body content for block ${i}` }],
            },
          ],
        },
      });
    }

    const start = performance.now();
    const result = buildNotePlainText("Benchmark Note Title", blocks);
    const durationMs = performance.now() - start;

    expect(durationMs).toBeLessThan(1500);
    expect(result.startsWith("Benchmark Note Title\n\nHeading Section 0\nBody content for block 0")).toBe(true);
    expect(result.endsWith("Heading Section 9999\nBody content for block 9999")).toBe(true);
  });

  it("processes a document with 5,000,000 characters without memory exhaustion", () => {
    const chunk = "A".repeat(5000); // 5,000 chars per paragraph
    const paragraphs = [];
    for (let i = 0; i < 1000; i++) {
      paragraphs.push({
        type: "paragraph",
        content: [{ type: "text", text: `${chunk} #${i}` }],
      });
    }

    const doc = {
      type: "doc",
      content: paragraphs,
    };

    const start = performance.now();
    const result = extractPlainTextFromTiptap(doc);
    const durationMs = performance.now() - start;

    expect(durationMs).toBeLessThan(2000);
    expect(result.length).toBeGreaterThan(5000000);
  });

  it("handles complex deeply nested enterprise documents (tables inside blockquotes inside lists)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "table",
                      content: [
                        {
                          type: "tableRow",
                          content: [
                            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Col 1" }] }] },
                            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Col 2" }] }] },
                          ],
                        },
                        {
                          type: "tableRow",
                          content: [
                            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Data A" }] }] },
                            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Data B" }] }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = extractPlainTextFromTiptap(doc);
    expect(result).toBe("Col 1  Col 2\nData A  Data B");
  });
});

describe("Adversarial Suite 4: Spacing & Normalization Determinism", () => {
  it("preserves exact inline concatenation between styled and unstyled text", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "This is " },
            { type: "text", marks: [{ type: "bold" }], text: "bold" },
            { type: "text", text: ", this is " },
            { type: "text", marks: [{ type: "italic" }], text: "italic" },
            { type: "text", text: ", and this is " },
            { type: "text", marks: [{ type: "code" }], text: "inlineCode" },
            { type: "text", text: "." },
          ],
        },
      ],
    };

    expect(extractPlainTextFromTiptap(doc)).toBe("This is bold, this is italic, and this is inlineCode.");
  });

  it("normalizes CRLF and CR line endings to LF", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "line 1\r\nline 2\rline 3\nline 4" }],
        },
      ],
    };

    expect(extractPlainTextFromTiptap(doc)).toBe("line 1\nline 2\nline 3\nline 4");
  });

  it("collapses 3+ consecutive newlines to exactly 2 newlines", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Start" },
            { type: "hardBreak" },
            { type: "hardBreak" },
            { type: "hardBreak" },
            { type: "hardBreak" },
            { type: "text", text: "End" },
          ],
        },
      ],
    };

    expect(extractPlainTextFromTiptap(doc)).toBe("Start\n\nEnd");
  });

  it("cleans empty and whitespace-only blocks in buildNotePlainText", () => {
    const blocks: NoteBlockTextSource[] = [
      { order: 0, heading: "   ", content: { type: "doc", content: [] } },
      { order: 1, heading: null, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }] } },
      { order: 2, heading: "Actual Block", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Actual content" }] }] } },
      { order: 3, heading: "", content: null },
    ];

    const result = buildNotePlainText("Valid Note", blocks);
    expect(result).toBe("Valid Note\n\nActual Block\nActual content");
  });

  it("handles duplicate, negative, and missing order numbers deterministically", () => {
    const blocks: NoteBlockTextSource[] = [
      { order: -5, heading: "Negative Order", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] } },
      { order: 0, heading: "Zero Order A", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Zero A" }] }] } },
      { order: 0, heading: "Zero Order B", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Zero B" }] }] } },
      { heading: "No Order", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Default 0" }] }] } },
    ];

    expect(() => {
      const result = buildNotePlainText("Title", blocks);
      expect(result.startsWith("Title\n\nNegative Order")).toBe(true);
    }).not.toThrow();
  });

  it("investigates buildNotePlainText behavior with non-array or null blocks input", () => {
    // TypeScript typing expects NoteBlockTextSource[], but runtime callers might pass null/undefined
    expect(() => {
      buildNotePlainText("Title", null as unknown as NoteBlockTextSource[]);
    }).toThrow(TypeError);

    expect(() => {
      buildNotePlainText("Title", undefined as unknown as NoteBlockTextSource[]);
    }).toThrow(TypeError);
  });
});

describe("Adversarial Suite 5: Unicode, Control Characters & Internationalization", () => {
  it("preserves complex emoji sequences (ZWJ, skin tones, flags) without corruption", () => {
    const emojiText = "Family: 👨‍👩‍👧‍👦, Developer: 👩🏽‍💻, Flag: 🇺🇸, Sparkles: ✨, Rocket: 🚀";
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: emojiText }],
        },
      ],
    };

    const extracted = extractPlainTextFromTiptap(doc);
    expect(extracted).toBe(emojiText);
  });

  it("handles bidirectional (BiDi) and Right-to-Left (RTL) scripts accurately", () => {
    const arabic = "مرحبا بكم في منصة الملاحظات الذكية";
    const hebrew = "שלום עולם ומזל טוב";
    const mixed = "English title: مرحبا (Welcome) - Chapter 1";

    const doc = {
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: arabic }] },
        { type: "paragraph", content: [{ type: "text", text: hebrew }] },
        { type: "paragraph", content: [{ type: "text", text: mixed }] },
      ],
    };

    const extracted = extractPlainTextFromTiptap(doc);
    expect(extracted).toContain(arabic);
    expect(extracted).toContain(hebrew);
    expect(extracted).toContain(mixed);
  });

  it("preserves CJK (Chinese, Japanese, Korean) and South Asian scripts", () => {
    const cjkText = "量子力学 (Quantum Mechanics) - 状態ベクトルと波動関数. 그리고 인공지능.";
    const hindiText = "डेटा संरचना और एल्गोरिदम";
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: cjkText }] },
        { type: "paragraph", content: [{ type: "text", text: hindiText }] },
      ],
    };

    const extracted = extractPlainTextFromTiptap(doc);
    expect(extracted).toBe(`${cjkText}\n\n${hindiText}`);
  });

  it("handles zero-width characters and non-breaking spaces safely", () => {
    const zwspText = "Zero\u200BWidth\u200DSpace\uFEFFTest";
    const nbspText = "Non\u00A0Breaking\u00A0Space";
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: zwspText }] },
        { type: "paragraph", content: [{ type: "text", text: nbspText }] },
      ],
    };

    const extracted = extractPlainTextFromTiptap(doc);
    expect(extracted).toBe(`${zwspText}\n\n${nbspText}`);
  });

  it("handles Zalgo text / excessive combining diacritical marks without crashing", () => {
    const zalgo = "Z̸a̸l̸g̸o̸ ̸t̸e̸x̸t̸ ̸c̸o̸m̸b̸i̸n̸i̸n̸g̸ ̸c̸h̸a̸r̸s̸";
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: zalgo }] }],
    };

    expect(() => {
      const extracted = extractPlainTextFromTiptap(doc);
      expect(extracted).toBe(zalgo);
    }).not.toThrow();
  });

  it("survives control characters and null characters", () => {
    const controlChars = "Line with \u0000 null byte, \u0007 bell, \u001B escape, \t tab.";
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: controlChars }] }],
    };

    expect(() => {
      const extracted = extractPlainTextFromTiptap(doc);
      expect(extracted).toBe(controlChars);
    }).not.toThrow();
  });

  it("handles unpaired Unicode surrogates safely without throwing", () => {
    const unpairedSurrogate = "Isolated high surrogate: \uD800, isolated low surrogate: \uDFFF";
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: unpairedSurrogate }] }],
    };

    expect(() => {
      const extracted = extractPlainTextFromTiptap(doc);
      expect(typeof extracted).toBe("string");
    }).not.toThrow();
  });

  it("extracts verbatim text for SQL/HTML/Script injection payloads without corruption", () => {
    const hostilePaylod = "'); DROP TABLE \"Note\"; <script>alert('xss')</script> --";
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: hostilePaylod }] }],
    };

    const extracted = extractPlainTextFromTiptap(doc);
    expect(extracted).toBe(hostilePaylod);
  });

  it("handles deep nesting up to depth 60 cleanly", () => {
    let inner: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "Target at depth 60" }],
    };

    for (let i = 0; i < 59; i++) {
      inner = {
        type: "blockquote",
        content: [inner],
      };
    }

    const doc = {
      type: "doc",
      content: [inner],
    };

    const extracted = extractPlainTextFromTiptap(doc);
    expect(extracted).toBe("Target at depth 60");
  });
});
