/**
 * Tier 2: Boundary Value Analysis — Special Characters & Encoding
 *
 * Comprehensive adversarial and boundary testing of special characters in `q`:
 * - Whitespace variations (tabs, spaces, mixed whitespace, non-breaking spaces)
 * - Punctuation-only and symbol sequences (`!@#$%^&*()_+-=~`, `[]{};:'",.<>/?|\\`)
 * - SQL Injection payloads (`' OR 1=1 --`, `"; DROP TABLE "Note"; --`, `UNION SELECT`)
 * - PostgreSQL tsquery syntax (`& | ! :* <->`, unclosed quotes, unbalanced parens)
 * - Unicode extremes (emojis with ZWJ, skin tones, RTL scripts, zero-width characters)
 * - Delimiters, backslashes, quotes, and HTML/XSS injection patterns
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, assertNoEntityLeak } from "../harness/contracts";

describe("Tier 2: Special Characters & Encoding Boundaries", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  // ==========================================================================
  // 1. PUNCTUATION & SYMBOLS
  // ==========================================================================
  describe("Punctuation & Symbols Handling", () => {
    it("handles common punctuation query '!@#$%^&*' safely with 200 OK and 0 hits", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "!@#$%^&*" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBe(0);
    });

    it("handles bracket and delimiter sequence '()[]{};:,.<>/?' safely with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "()[]{};:,.<>/?" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.total).toBeGreaterThanOrEqual(0);

      // In pure lexical mode, stripped punctuation yields 0 tokens and 0 hits
      const resLex = await harness.dispatchSearchApiJson({ q: "()[]{};:,.<>/?", mode: "lexical" });
      expect(resLex.status).toBe(200);
      expect(resLex.data.total).toBe(0);
    });

    it("handles backslash and quote sequence '\\\\\"\"\'\'|' safely with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: '\\\\""\'\'|' });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.total).toBeGreaterThanOrEqual(0);

      const resLex = await harness.dispatchSearchApiJson({ q: '\\\\""\'\'|', mode: "lexical" });
      expect(resLex.status).toBe(200);
      expect(resLex.data.total).toBe(0);
    });

    it("handles mathematical symbols '∑ ∏ √ ∫ ≈ ≠ ≤ ≥' safely with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "∑ ∏ √ ∫ ≈" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("matches terms embedded with punctuation 'DNA-polymerase' to relevant biological entities", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "DNA-polymerase" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.total).toBeGreaterThanOrEqual(1);
    });

    it("normalizes hyphen-separated terms 'dna-replication' to match multi-token items in lexical search", async () => {
      const resHyphen = await harness.dispatchSearchApiJson({ q: "dna-replication", mode: "lexical" });
      const resSpace = await harness.dispatchSearchApiJson({ q: "dna replication", mode: "lexical" });
      expect(resHyphen.status).toBe(200);
      expect(resSpace.status).toBe(200);
      expect(resHyphen.data.total).toBe(resSpace.data.total);
      expect(resHyphen.data.total).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // 2. SQL INJECTION ADVERSARIAL PAYLOADS
  // ==========================================================================
  describe("SQL Injection Adversarial Resilience", () => {
    it("safely handles classic SQL injection \"' OR '1'='1\" without leaking data", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "' OR '1'='1" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      // Must not match everything or leak unauthorized workspaces
      assertNoEntityLeak(res.data, ["ws-bob", "ws-charlie", "group-2"]);
    });

    it("safely handles SQL injection with comment \"admin' --\" without crash", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "admin' --" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      assertNoEntityLeak(res.data, ["ws-bob", "ws-charlie"]);
    });

    it("safely handles DROP TABLE injection \"; DROP TABLE \\\"Note\\\"; --\" without error", async () => {
      const res = await harness.dispatchSearchApiJson({ q: '; DROP TABLE "Note"; --' });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      // Verify store was not dropped or corrupted
      const noteCount = harness.store.getData().notes.length;
      expect(noteCount).toBeGreaterThan(0);
    });

    it("safely handles UNION SELECT injection payload \"' UNION SELECT * FROM \\\"User\\\" --\"", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "' UNION SELECT * FROM \"User\" --" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      // No user passwords or unauthorized records leaked
      for (const hit of res.data.hits) {
        expect(hit.entityType).not.toBe("user" as any);
      }
    });

    it("safely handles boolean-based blind SQLi \"1' AND (SELECT COUNT(*) FROM \\\"Note\\\") > 0 --\"", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "1' AND (SELECT COUNT(*) FROM \"Note\") > 0 --" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });
  });

  // ==========================================================================
  // 3. POSTGRESQL FULL-TEXT SEARCH (TSQUERY) OPERATORS
  // ==========================================================================
  describe("PostgreSQL tsquery Operator Boundaries", () => {
    it("handles lone '&' and '|' boolean operators without syntax crash", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna & | rna" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.total).toBeGreaterThanOrEqual(1);
    });

    it("handles negation operator '!dna' safely", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "!dna" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles prefix wildcard operator 'bio:*' without syntax error", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "bio:*" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles phrase search syntax with quotes '\"dna replication\"'", async () => {
      const res = await harness.dispatchSearchApiJson({ q: '"dna replication"' });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.total).toBeGreaterThanOrEqual(1);
    });

    it("handles unbalanced quotes '\"dna replication' without crashing", async () => {
      const res = await harness.dispatchSearchApiJson({ q: '"dna replication' });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles unbalanced parentheses '(dna & (replication' safely", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "(dna & (replication" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles follow-by proximity operator '<->' safely", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna <-> replication" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });
  });

  // ==========================================================================
  // 4. EMOJIS & EXTREME UNICODE
  // ==========================================================================
  describe("Emoji & Unicode Boundaries", () => {
    it("handles complex ZWJ emoji sequence (family emoji '👨‍👩‍👧‍👦')", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "👨‍👩‍👧‍👦" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles skin tone modifier emojis '👍🏽 thumbs up'", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "👍🏽 thumbs up" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles Right-to-Left (RTL) Arabic query 'علم الأحياء' (Biology)", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "علم الأحياء" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles Right-to-Left (RTL) Hebrew query 'ביולוגיה' (Biology)", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "ביולוגיה" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles zero-width space characters embedded between words 'dna\\u200Breplication'", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna\u200Breplication" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles bidirectional override characters safely '\\u202Edna'", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "\u202Edna" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });
  });

  // ==========================================================================
  // 5. XSS & HTML INJECTION PAYLOADS
  // ==========================================================================
  describe("XSS & HTML Injection Resilience", () => {
    it("safely handles script tag injection '<script>alert(\"xss\")</script>'", async () => {
      const res = await harness.dispatchSearchApiJson({ q: '<script>alert("xss")</script>' });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.query).toBe('<script>alert("xss")</script>');
    });

    it("safely handles img onerror injection '<img src=x onerror=alert(1)>'", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "<img src=x onerror=alert(1)>" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("safely handles svg onload payload '\"><svg/onload=alert(document.cookie)>'", async () => {
      const res = await harness.dispatchSearchApiJson({ q: '"><svg/onload=alert(document.cookie)>' });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });
  });

  // ==========================================================================
  // 6. CONTROL CHARACTERS & URL ENCODING BOUNDARIES
  // ==========================================================================
  describe("Control Characters & URL Encoding", () => {
    it("handles null byte embedded in query 'bio\\0logy'", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "bio\0logy" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles percent-encoded strings 'dna%20replication'", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna%20replication" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });

    it("handles multiple consecutive quote characters '\"\"\"'''\"\"'", async () => {
      const res = await harness.dispatchSearchApiJson({ q: '"""\'\'\'"""' });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
    });
  });
});
