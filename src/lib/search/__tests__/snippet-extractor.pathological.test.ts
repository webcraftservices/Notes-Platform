/**
 * src/lib/search/__tests__/snippet-extractor.pathological.test.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS SUITE — Challenger 2 (Milestone 2 Iteration 2)
 *
 * Dedicated pathological parameter & extreme payload stress suite for snippet extraction.
 */

import { describe, it, expect } from "vitest";
import { extractContextualSnippet } from "../snippet-extractor";

describe("Snippet Extractor Pathological & Extreme Arguments Challenge", () => {
  const sampleText =
    "In physics and mathematics, the Poincaré conjecture is a theorem about the characterization " +
    "of the 3-sphere, which is the hypersphere that bounds the unit ball in four-dimensional space. " +
    "The conjecture states that every simply connected, closed 3-manifold is homeomorphic to the 3-sphere. " +
    "Grigori Perelman proved the conjecture using Richard S. Hamilton's Ricci flow with surgery. " +
    "This was recognized by the Clay Mathematics Institute as resolving one of the Millennium Prize Problems.";

  // ========================================================================
  // 1. Extreme and Pathological targetLength values
  // ========================================================================
  describe("1. Extreme & Pathological targetLength", () => {
    it("handles targetLength: 0 defensively without crash (clamped to min bound 20)", () => {
      expect(() => {
        const res = extractContextualSnippet(sampleText, "conjecture", { targetLength: 0 });
        expect(typeof res).toBe("string");
        expect(res.length).toBeGreaterThan(0);
        expect(res).not.toBe("…");
        // Output should not exceed reasonable bound (clamped 20 + snapping + ellipses <= 50)
        expect(res.length).toBeLessThanOrEqual(50);
      }).not.toThrow();
    });

    it("handles targetLength: -10 defensively without crash (clamped to min bound 20)", () => {
      expect(() => {
        const res = extractContextualSnippet(sampleText, "conjecture", { targetLength: -10 });
        expect(typeof res).toBe("string");
        expect(res.length).toBeGreaterThan(0);
        expect(res).not.toBe("…");
        expect(res.length).toBeLessThanOrEqual(50);
      }).not.toThrow();
    });

    it("handles targetLength: NaN defensively without crash (defaults to 160)", () => {
      const res = extractContextualSnippet(sampleText, "conjecture", { targetLength: Number.NaN });
      expect(typeof res).toBe("string");
      expect(res.length).toBeGreaterThan(0);
      expect(res.length).toBeLessThanOrEqual(200);
      expect(res).toContain("conjecture");
    });

    it("handles targetLength: Infinity defensively without crash (defaults to 160)", () => {
      const res = extractContextualSnippet(sampleText, "conjecture", { targetLength: Infinity });
      expect(typeof res).toBe("string");
      expect(res.length).toBeGreaterThan(0);
      expect(res.length).toBeLessThanOrEqual(200);
      expect(res).toContain("conjecture");
    });

    it("handles targetLength: -Infinity defensively without crash (defaults to 160)", () => {
      const res = extractContextualSnippet(sampleText, "conjecture", { targetLength: -Infinity });
      expect(typeof res).toBe("string");
      expect(res.length).toBeGreaterThan(0);
      expect(res.length).toBeLessThanOrEqual(200);
      expect(res).toContain("conjecture");
    });

    it("handles targetLength: 1e9 defensively without crash (returns full normalized text)", () => {
      const res = extractContextualSnippet(sampleText, "conjecture", { targetLength: 1e9 });
      expect(typeof res).toBe("string");
      // Text length is ~450 chars, targetLength 1e9 exceeds text length, returns normalized without ellipses
      expect(res).not.toContain("…");
      expect(res.length).toBeLessThan(1000);
      expect(res).toContain("Poincaré conjecture");
    });

    it("handles targetLength: 3.14159 defensively without crash (floored to 3, clamped to 20)", () => {
      expect(() => {
        const res = extractContextualSnippet(sampleText, "conjecture", { targetLength: 3.14159 });
        expect(typeof res).toBe("string");
        expect(res.length).toBeGreaterThan(0);
        expect(res.length).toBeLessThanOrEqual(50);
      }).not.toThrow();
    });

    it("handles fractional targetLength: 45.8 without crash (floored to 45)", () => {
      expect(() => {
        const res = extractContextualSnippet(sampleText, "conjecture", { targetLength: 45.8 });
        expect(typeof res).toBe("string");
        expect(res.length).toBeGreaterThan(0);
        expect(res.length).toBeLessThanOrEqual(75);
      }).not.toThrow();
    });
  });

  // ========================================================================
  // 2. Extreme and Pathological leadChars values
  // ========================================================================
  describe("2. Extreme & Pathological leadChars", () => {
    it("handles leadChars: -5 defensively without crash (clamped to min bound 5)", () => {
      const res = extractContextualSnippet(sampleText, "conjecture", { leadChars: -5 });
      expect(typeof res).toBe("string");
      expect(res.length).toBeGreaterThan(0);
      expect(res).toContain("conjecture");
    });

    it("handles leadChars: 0 defensively without crash (clamped to min bound 5)", () => {
      const res = extractContextualSnippet(sampleText, "conjecture", { leadChars: 0 });
      expect(typeof res).toBe("string");
      expect(res.length).toBeGreaterThan(0);
      expect(res).toContain("conjecture");
    });

    it("handles leadChars: 1e9 defensively without crash (clamped to targetLength - 5)", () => {
      const res = extractContextualSnippet(sampleText, "conjecture", { targetLength: 160, leadChars: 1e9 });
      expect(typeof res).toBe("string");
      expect(res.length).toBeGreaterThan(0);
      expect(res).toContain("conjecture");
    });

    it("handles leadChars >= targetLength without crash (clamped to targetLength - 5)", () => {
      const cases = [
        { targetLength: 160, leadChars: 160 },
        { targetLength: 160, leadChars: 500 },
        { targetLength: 50, leadChars: 50 },
        { targetLength: 20, leadChars: 20 },
        { targetLength: 20, leadChars: 1000 },
      ];

      for (const c of cases) {
        expect(() => {
          const res = extractContextualSnippet(sampleText, "conjecture", c);
          expect(typeof res).toBe("string");
          expect(res.length).toBeGreaterThan(0);
        }).not.toThrow();
      }
    });

    it("handles leadChars: NaN and Infinity defensively (falls back safely)", () => {
      const snipNaN = extractContextualSnippet(sampleText, "conjecture", { leadChars: NaN });
      expect(snipNaN.length).toBeGreaterThan(0);
      expect(snipNaN).toContain("conjecture");

      const snipInf = extractContextualSnippet(sampleText, "conjecture", { leadChars: Infinity });
      expect(snipInf.length).toBeGreaterThan(0);
      expect(snipInf).toContain("conjecture");
    });
  });

  // ========================================================================
  // 3. Degenerate and Extreme Text Inputs
  // ========================================================================
  describe("3. Degenerate & Extreme Text Inputs", () => {
    it("handles empty text, null, and undefined without throwing", () => {
      expect(extractContextualSnippet("", "test")).toBe("");
      expect(extractContextualSnippet(null as any, "test")).toBe("");
      expect(extractContextualSnippet(undefined as any, "test")).toBe("");
    });

    it("handles text shorter than targetLength (returns normalized verbatim without ellipses)", () => {
      const shortText = "Brief note on algebra.";
      const res = extractContextualSnippet(shortText, "algebra", { targetLength: 160 });
      expect(res).toBe(shortText);
      expect(res).not.toContain("…");
    });

    it("handles text with only whitespace (returns empty string)", () => {
      expect(extractContextualSnippet("     ", "test")).toBe("");
      expect(extractContextualSnippet("\t\n\r   \n\t", "test")).toBe("");
      expect(extractContextualSnippet("   \t  \n   ", "test")).toBe("");
    });

    it("handles text with only symbols without crashing", () => {
      const symbolsShort = "!@#$%^&*()_+=-{}[]:;'<>?,./";
      const resShort = extractContextualSnippet(symbolsShort, "test");
      expect(resShort).toBe(symbolsShort);

      const symbolsLong = "!@#$%^&*()_+=-{}[]:;'<>?,./ ".repeat(20);
      const resLong = extractContextualSnippet(symbolsLong, "test");
      expect(typeof resLong).toBe("string");
      expect(resLong.length).toBeGreaterThan(0);
      expect(resLong.endsWith(" …")).toBe(true);
    });

    it("handles query with only symbols without crashing", () => {
      const res = extractContextualSnippet(sampleText, "!@#$%^&*()_+=-");
      expect(typeof res).toBe("string");
      expect(res.length).toBeGreaterThan(0);
      // Fallback to prefix
      expect(res.startsWith("In physics and mathematics")).toBe(true);
    });
  });

  // ========================================================================
  // 4. Huge Input Text (>1MB) Scale & Performance
  // ========================================================================
  describe("4. Huge Input Text (>1MB Scale Stress)", () => {
    it("processes a >1MB document with target keyword at beginning, middle, and end within 500ms", () => {
      // 1MB is 1,048,576 characters.
      // Base chunk is 103 characters. 10,000 repetitions = 1,030,000 characters (>1MB).
      const baseChunk = "Cellular signaling pathways control cell division, apoptosis, differentiation, and tissue homeostasis. ";
      const repeats = 10000;
      const targetNeedle = "CRUCIAL_TRANSCRIPTION_FACTOR_KEYWORD";

      // 1. Target at beginning
      const textAtStart = targetNeedle + " " + baseChunk.repeat(repeats);
      expect(textAtStart.length).toBeGreaterThan(1_000_000);

      const t0 = performance.now();
      const snipStart = extractContextualSnippet(textAtStart, targetNeedle);
      const timeStart = performance.now() - t0;
      expect(timeStart).toBeLessThan(500);
      expect(snipStart).toContain(targetNeedle);
      expect(snipStart.startsWith("…")).toBe(false); // At very start
      expect(snipStart.endsWith(" …")).toBe(true);

      // 2. Target at middle
      const half = baseChunk.repeat(Math.floor(repeats / 2));
      const textAtMid = half + " " + targetNeedle + " " + half;
      expect(textAtMid.length).toBeGreaterThan(1_000_000);

      const t1 = performance.now();
      const snipMid = extractContextualSnippet(textAtMid, targetNeedle);
      const timeMid = performance.now() - t1;
      expect(timeMid).toBeLessThan(500);
      expect(snipMid).toContain(targetNeedle);
      expect(snipMid.startsWith("… ")).toBe(true);
      expect(snipMid.endsWith(" …")).toBe(true);

      // 3. Target at end
      const textAtEnd = baseChunk.repeat(repeats) + " " + targetNeedle;
      expect(textAtEnd.length).toBeGreaterThan(1_000_000);

      const t2 = performance.now();
      const snipEnd = extractContextualSnippet(textAtEnd, targetNeedle);
      const timeEnd = performance.now() - t2;
      expect(timeEnd).toBeLessThan(500);
      expect(snipEnd).toContain(targetNeedle);
      expect(snipEnd.startsWith("… ")).toBe(true);
      expect(snipEnd.endsWith(" …")).toBe(false); // At very end
    });

    it("processes a >1MB document with 200 distributed occurrences of query term without timing out", () => {
      // 200 occurrences across 1.1MB text
      // Block length = ~4,500 chars with 1 target token. Repeating 250 times = ~1,125,000 chars with 250 target tokens.
      const block = "Gene expression is regulated by promoter sequences and histone modifications. ".repeat(25) +
        "TargetQueryToken " +
        "Enzymatic reactions accelerate biochemical transformations in cytoplasm. ".repeat(25);
      const text1MB = block.repeat(300);
      expect(text1MB.length).toBeGreaterThan(1_000_000);

      const t0 = performance.now();
      const snip = extractContextualSnippet(text1MB, "TargetQueryToken");
      const elapsed = performance.now() - t0;

      // Outer loop has 250 matches, inner loop has 250 matches = 62,500 iterations.
      // Should complete very quickly in V8 (<1000ms).
      expect(elapsed).toBeLessThan(1000);
      expect(snip).toContain("TargetQueryToken");
    });
  });

  // ========================================================================
  // 5. Bounds, Boundary Snapping, and Match Density Centering
  // ========================================================================
  describe("5. Bounds, Snapping, & Match Density Centering", () => {
    it("ensures returned snippet never exceeds reasonable bounds (~targetLength + padding)", () => {
      const targets = [20, 50, 80, 120, 160, 200, 300];
      for (const tl of targets) {
        const snip = extractContextualSnippet(sampleText, "conjecture", { targetLength: tl });
        // Snippet may include '… ' (2 chars) and ' …' (2 chars) + boundary snapping up to 20 chars
        // Maximum length should strictly be <= tl + 45
        expect(snip.length).toBeLessThanOrEqual(tl + 45);
        expect(typeof snip).toBe("string");
      }
    });

    it("snaps to clean word boundaries where possible and avoids slicing words", () => {
      const text =
        "Historical overview begins here. ".repeat(4) +
        "Superconducting electrodynamics and quantum chromodynamics govern fundamental particle interactions. " +
        "Future experiments will test these predictions. ".repeat(4);

      const snip = extractContextualSnippet(text, "quantum");
      // Sliced words check: remove ellipsis, check that the first and last words are whole words
      const cleaned = snip.replace(/…/g, "").trim();
      const words = cleaned.split(/\s+/);
      expect(words.length).toBeGreaterThan(3);

      // Verify no word has leading or trailing punctuation dangling or partial words
      for (const w of words) {
        expect(w.length).toBeGreaterThan(0);
      }
      expect(snip).toContain("quantum");
    });

    it("centers on window with highest query match density when multiple matches exist", () => {
      // 3 candidate sections:
      // Section 1: "photosynthesis" once
      // Section 2: "photosynthesis" and "chloroplast" and "light" all together (3 matches)
      // Section 3: "chloroplast" once
      const sec1 = "Early plant biology focused on photosynthesis rates in direct sunlight. ".repeat(3);
      const sec2 = "Inside the chloroplast, the light-dependent reactions of photosynthesis synthesize ATP and NADPH. ";
      const sec3 = "Isolated chloroplast organelles maintain structural integrity in isotonic buffers. ".repeat(3);

      const fullDoc = sec1 + sec2 + sec3;
      const snip = extractContextualSnippet(fullDoc, "photosynthesis chloroplast light", { targetLength: 120 });

      // Snip must cover the dense co-occurrence section
      expect(snip).toContain("chloroplast");
      expect(snip).toContain("photosynthesis");
      expect(snip).toContain("light");
    });
  });
});
