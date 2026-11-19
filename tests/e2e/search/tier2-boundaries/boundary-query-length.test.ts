/**
 * Tier 2: Boundary Value Analysis — Query Length Boundaries
 *
 * Systematic boundary testing of the `q` query parameter:
 * - Length 0 (empty string `""`, whitespace-only strings that trim to 0)
 * - Length 1 (sub-minimum single characters, single characters with padding)
 * - Length 2 (exact lower boundary: minimum valid query)
 * - Nominal lengths (3 to 199 characters)
 * - Length 200 (exact upper boundary: maximum valid query)
 * - Length 201+ (over maximum limit: 201, 250, 500, 1000, extreme buffer)
 * - Multi-byte UTF-8 character lengths (emojis, CJK, Cyrillic, combining diacritics)
 * - Missing / null query parameter edge cases
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { validateSearchApiResponse, assertSearchApiResponse } from "../harness/contracts";

describe("Tier 2: Query Length Boundary Tests", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  // ==========================================================================
  // 1. LENGTH 0: EMPTY & TRUNCATED STRINGS (< 2 CHARS)
  // ==========================================================================
  describe("Length 0 Boundaries (Empty & Whitespace-Only)", () => {
    it("rejects an empty query string '' with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("rejects a single space query ' ' with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: " " });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("rejects multiple spaces '     ' trimming to length 0 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "     " });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("rejects tab characters '\\t\\t' trimming to length 0 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "\t\t" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("rejects newline characters '\\n\\r\\n' trimming to length 0 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "\n\r\n" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("rejects non-breaking spaces '\\u00A0\\u00A0' trimming to length 0 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "\u00A0\u00A0" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });
  });

  // ==========================================================================
  // 2. LENGTH 1: BELOW MINIMUM VALID THRESHOLD
  // ==========================================================================
  describe("Length 1 Boundaries (Single Character)", () => {
    it("rejects a single ASCII character 'a' with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "a" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("rejects a single digit '1' with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "1" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("rejects a single punctuation mark '?' with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "?" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("rejects a single character padded with spaces '  x  ' that trims to length 1 with 400", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "  x  " });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("rejects a single character padded with tabs and newlines '\\t\\nz\\n\\t' with 400", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "\t\nz\n\t" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });
  });

  // ==========================================================================
  // 3. LENGTH 2: EXACT MINIMUM VALID QUERY BOUNDARY
  // ==========================================================================
  describe("Length 2 Boundaries (Exact Minimum Valid Query)", () => {
    it("accepts exactly 2 ASCII characters 'ab' with 200 OK and valid response contract", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "ab" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe("ab");
    });

    it("accepts 2-character chemical abbreviation 'pH' with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "pH" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe("pH");
    });

    it("accepts 2-character biological abbreviation 'ox' (oxidation) with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "ox" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe("ox");
    });

    it("accepts 2 characters with leading and trailing spaces '  ab  ' trimming to exactly 2 with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "  ab  " });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe("ab");
    });

    it("accepts 2 punctuation characters '++' with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "++" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe("++");
    });
  });

  // ==========================================================================
  // 4. NOMINAL LENGTHS (3 TO 199 CHARACTERS)
  // ==========================================================================
  describe("Nominal Query Length Boundaries (3 to 199 Characters)", () => {
    it("accepts 3-character query 'dna' with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe("dna");
    });

    it("accepts 10-character query 'replication' with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "replication" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe("replication");
    });

    it("accepts 50-character query with 200 OK", async () => {
      const q50 = "a".repeat(50);
      const res = await harness.dispatchSearchApiJson({ q: q50 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe(q50);
    });

    it("accepts 100-character query with 200 OK", async () => {
      const q100 = "molecular biology biochemistry cellular respiration ".repeat(2).substring(0, 100);
      const res = await harness.dispatchSearchApiJson({ q: q100 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query.length).toBe(100);
    });

    it("accepts 199-character query (one below maximum) with 200 OK", async () => {
      const q199 = "x".repeat(199);
      const res = await harness.dispatchSearchApiJson({ q: q199 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query.length).toBe(199);
    });
  });

  // ==========================================================================
  // 5. LENGTH 200: EXACT MAXIMUM VALID QUERY BOUNDARY
  // ==========================================================================
  describe("Length 200 Boundaries (Exact Maximum Valid Query)", () => {
    it("accepts exactly 200 characters with 200 OK", async () => {
      const q200 = "z".repeat(200);
      const res = await harness.dispatchSearchApiJson({ q: q200 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query.length).toBe(200);
    });

    it("accepts a 200-character query with surrounding whitespace that trims to 200 chars with 200 OK", async () => {
      const q200 = "  " + "w".repeat(200) + "  ";
      const res = await harness.dispatchSearchApiJson({ q: q200 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query.length).toBe(200);
    });

    it("accepts 200 characters containing multiple space-separated words with 200 OK", async () => {
      const words = "dna rna helicase polymerase ligase transcription translation ";
      // Ensure the 200-char string starts and ends with a non-space character
      const base = words.repeat(4).substring(0, 199);
      const q200 = base + "x";
      expect(q200.length).toBe(200);
      const res = await harness.dispatchSearchApiJson({ q: q200 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query.length).toBe(200);
    });
  });

  // ==========================================================================
  // 6. LENGTH 201+: OVER MAXIMUM QUERY LIMIT
  // ==========================================================================
  describe("Length 201+ Boundaries (Exceeding Maximum Limit)", () => {
    it("rejects 201 characters (one char over limit) with 400 Bad Request", async () => {
      const q201 = "a".repeat(201);
      const res = await harness.dispatchSearchApiJson({ q: q201 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/must not exceed 200 characters/i);
    });

    it("rejects 202 characters with 400 Bad Request", async () => {
      const q202 = "b".repeat(202);
      const res = await harness.dispatchSearchApiJson({ q: q202 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/must not exceed 200 characters/i);
    });

    it("rejects 250 characters with 400 Bad Request", async () => {
      const q250 = "c".repeat(250);
      const res = await harness.dispatchSearchApiJson({ q: q250 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/must not exceed 200 characters/i);
    });

    it("rejects 500 characters with 400 Bad Request", async () => {
      const q500 = "d".repeat(500);
      const res = await harness.dispatchSearchApiJson({ q: q500 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/must not exceed 200 characters/i);
    });

    it("rejects 1000 characters with 400 Bad Request", async () => {
      const q1000 = "e".repeat(1000);
      const res = await harness.dispatchSearchApiJson({ q: q1000 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/must not exceed 200 characters/i);
    });

    it("rejects 10,000 characters (buffer overflow attempt) safely with 400 Bad Request", async () => {
      const qExtreme = "f".repeat(10000);
      const res = await harness.dispatchSearchApiJson({ q: qExtreme });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/must not exceed 200 characters/i);
    });

    it("rejects a 201-character query even when it has leading spaces that were trimmed", async () => {
      const qUntrimmed = "  " + "g".repeat(201) + "  ";
      const res = await harness.dispatchSearchApiJson({ q: qUntrimmed });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/must not exceed 200 characters/i);
    });
  });

  // ==========================================================================
  // 7. MULTI-BYTE UTF-8 STRING LENGTHS & ENCODING
  // ==========================================================================
  describe("Multi-byte UTF-8 String Length Boundaries", () => {
    it("handles single emoji with UTF-16 length of 2 (surrogate pair) as 200 OK", async () => {
      // In JS, '🧬' has length 2
      const emoji = "🧬";
      expect(emoji.length).toBe(2);
      const res = await harness.dispatchSearchApiJson({ q: emoji });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("accepts 2 CJK characters '細胞' (length 2) with 200 OK", async () => {
      const cjk2 = "細胞";
      expect(cjk2.length).toBe(2);
      const res = await harness.dispatchSearchApiJson({ q: cjk2 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe(cjk2);
    });

    it("rejects 1 CJK character '生' (length 1) with 400 Bad Request", async () => {
      const cjk1 = "生";
      expect(cjk1.length).toBe(1);
      const res = await harness.dispatchSearchApiJson({ q: cjk1 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("accepts 3 Cyrillic characters 'ДНК' (DNA) with 200 OK", async () => {
      const cyrillic = "ДНК";
      expect(cyrillic.length).toBe(3);
      const res = await harness.dispatchSearchApiJson({ q: cyrillic });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe(cyrillic);
    });

    it("rejects 1 Cyrillic character 'Д' with 400 Bad Request", async () => {
      const cyrillic1 = "Д";
      expect(cyrillic1.length).toBe(1);
      const res = await harness.dispatchSearchApiJson({ q: cyrillic1 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("accepts exactly 200 CJK characters with 200 OK", async () => {
      const cjk200 = "細胞".repeat(100);
      expect(cjk200.length).toBe(200);
      const res = await harness.dispatchSearchApiJson({ q: cjk200 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query.length).toBe(200);
    });

    it("rejects 201 CJK characters with 400 Bad Request", async () => {
      const cjk201 = "細胞".repeat(100) + "生";
      expect(cjk201.length).toBe(201);
      const res = await harness.dispatchSearchApiJson({ q: cjk201 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/must not exceed 200 characters/i);
    });

    it("handles accented latin characters with combining diacritics", async () => {
      // 'e\u0301' has length 2
      const combined = "e\u0301";
      expect(combined.length).toBe(2);
      const res = await harness.dispatchSearchApiJson({ q: combined });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });
  });

  // ==========================================================================
  // 8. MISSING & NULL PARAMETER DEFENSIVE BOUNDARIES
  // ==========================================================================
  describe("Missing Parameter Boundaries", () => {
    it("rejects a request with completely missing 'q' parameter with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({});
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/at least 2 characters/i);
    });

    it("treats string literal 'null' as a 4-character valid query with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "null" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe("null");
    });

    it("treats string literal 'undefined' as a 9-character valid query with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "undefined" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe("undefined");
    });
  });
});
