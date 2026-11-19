/**
 * Tier 1 — Feature 4: Text Normalization & FTS Syntax
 *
 * Verifies text normalization across case variations, punctuation stripping,
 * whitespace collapsing, multi-token phrases, and resilience against SQL/FTS syntax injection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse } from "../harness/contracts";

describe("Tier 1 — Feat 04: Text Normalization & FTS Syntax", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("normalizes case differences: uppercase, lowercase, and mixed-case yield identical results", async () => {
    const resLower = await harness.dispatchSearchApiJson({ q: "helicase", mode: "lexical" }, alice);
    const resUpper = await harness.dispatchSearchApiJson({ q: "HELICASE", mode: "lexical" }, alice);
    const resMixed = await harness.dispatchSearchApiJson({ q: "HeLiCaSe", mode: "lexical" }, alice);

    expect(resLower.status).toBe(200);
    expect(resUpper.status).toBe(200);
    expect(resMixed.status).toBe(200);

    assertSearchApiResponse(resLower.data);
    assertSearchApiResponse(resUpper.data);
    assertSearchApiResponse(resMixed.data);

    expect(resLower.data.hits.map((h) => h.id)).toEqual(resUpper.data.hits.map((h) => h.id));
    expect(resLower.data.hits.map((h) => h.id)).toEqual(resMixed.data.hits.map((h) => h.id));
    expect(resLower.data.total).toBe(resUpper.data.total);
    expect(resLower.data.total).toBe(resMixed.data.total);
  });

  it("strips punctuation characters without preventing matches", async () => {
    // Normal query
    const resClean = await harness.dispatchSearchApiJson({ q: "DNA helicase", mode: "lexical" }, alice);
    // Punctuation variations
    const resPunct1 = await harness.dispatchSearchApiJson({ q: "DNA-helicase!", mode: "lexical" }, alice);
    const resPunct2 = await harness.dispatchSearchApiJson({ q: "DNA, helicase?", mode: "lexical" }, alice);
    const resPunct3 = await harness.dispatchSearchApiJson({ q: '"DNA" (helicase);', mode: "lexical" }, alice);

    expect(resClean.status).toBe(200);
    expect(resPunct1.status).toBe(200);
    expect(resPunct2.status).toBe(200);
    expect(resPunct3.status).toBe(200);

    const cleanIds = resClean.data.hits.map((h: any) => h.id);
    expect(cleanIds).toContain("note-dna-helicase");
    expect(resPunct1.data.hits.map((h: any) => h.id)).toContain("note-dna-helicase");
    expect(resPunct2.data.hits.map((h: any) => h.id)).toContain("note-dna-helicase");
    expect(resPunct3.data.hits.map((h: any) => h.id)).toContain("note-dna-helicase");
  });

  it("collapses multiple consecutive spaces and leading/trailing whitespace", async () => {
    const resSingle = await harness.dispatchSearchApiJson({ q: "replication fork", mode: "lexical" }, alice);
    const resMulti = await harness.dispatchSearchApiJson(
      { q: "   replication    fork   ", mode: "lexical" },
      alice
    );
    const resTabs = await harness.dispatchSearchApiJson(
      { q: "\treplication\t\tfork\t", mode: "lexical" },
      alice
    );

    expect(resSingle.status).toBe(200);
    expect(resMulti.status).toBe(200);
    expect(resTabs.status).toBe(200);

    expect(resSingle.data.hits.map((h: any) => h.id)).toEqual(resMulti.data.hits.map((h: any) => h.id));
    expect(resSingle.data.hits.map((h: any) => h.id)).toEqual(resTabs.data.hits.map((h: any) => h.id));
  });

  it("supports multi-token queries and phrase matches across title and body content", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "unwinds the double helix at the replication fork", mode: "lexical" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    const topHit = res.data.hits[0];
    expect(topHit).toBeDefined();
    if (!topHit) return;
    expect(topHit.id).toBe("note-dna-helicase");
    expect(topHit.snippet).toBeDefined();
    expect(topHit.title).toContain("Helicase");
  });

  it("safely handles PostgreSQL FTS operator characters and SQL injection payloads", async () => {
    // Malicious or raw FTS operators that could break poorly sanitized SQL:
    const dangerousQueries = [
      "helicase & polymerase | !dna",
      "helicase:*",
      "helicase' OR '1'='1",
      "helicase; DROP TABLE users;--",
      "<script>alert('xss')</script> helicase",
    ];

    for (const q of dangerousQueries) {
      const res = await harness.dispatchSearchApiJson({ q, mode: "lexical" }, alice);
      // Must not crash with 500 error; either safely finds helicase or handles cleanly
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits.some((h) => h.id === "note-dna-helicase")).toBe(true);
    }
  });

  it("handles non-ASCII and Unicode characters safely without throwing errors", async () => {
    const unicodeQueries = [
      "hélicase polymérase", // Accents
      "DNA 螺旋酶",           // CJK
      "репликация ДНК",       // Cyrillic
      "🔥 helicase 🔥",       // Emoji
    ];

    for (const q of unicodeQueries) {
      const res = await harness.dispatchSearchApiJson({ q, mode: "lexical" }, alice);
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        assertSearchApiResponse(res.data);
      }
    }
  });
});
