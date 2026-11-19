/**
 * Tier 1 — Feature 16: Authenticated Search API
 *
 * Verifies GET /api/search endpoint security, Zod input validation, query length rules,
 * mode selection, pagination parameter clamping, and SearchApiResponse contract fidelity.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, isSearchApiResponse } from "../harness/contracts";

describe("Tier 1 — Feat 16: Authenticated Search API", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("returns 401 Unauthorized when no authenticated session is present", async () => {
    const res = await harness.dispatchSearchApiJson({ q: "helicase" }, null);

    expect(res.status).toBe(401);
    expect(res.data).toBeDefined();
    expect(res.data.error).toBe("Unauthorized");
  });

  it("validates query parameter 'q' length: rejects < 2 chars and > 200 chars with 400", async () => {
    // Missing query
    const resMissing = await harness.dispatchSearchApiJson({}, alice);
    expect(resMissing.status).toBe(400);

    // Empty query
    const resEmpty = await harness.dispatchSearchApiJson({ q: "" }, alice);
    expect(resEmpty.status).toBe(400);

    // 1 char query
    const resTooShort = await harness.dispatchSearchApiJson({ q: "a" }, alice);
    expect(resTooShort.status).toBe(400);
    expect(resTooShort.data.error).toContain("at least 2 characters");

    // 201 char query
    const resTooLong = await harness.dispatchSearchApiJson({ q: "x".repeat(201) }, alice);
    expect(resTooLong.status).toBe(400);
    expect(resTooLong.data.error).toContain("not exceed 200 characters");

    // Exact bounds: 2 chars and 200 chars should be accepted
    const resMinValid = await harness.dispatchSearchApiJson({ q: "ab" }, alice);
    expect(resMinValid.status).toBe(200);

    const resMaxValid = await harness.dispatchSearchApiJson({ q: "a".repeat(200) }, alice);
    expect(resMaxValid.status).toBe(200);
  });

  it("validates search mode parameter: accepts hybrid, lexical, semantic, rejects others with 400", async () => {
    const validModes = ["hybrid", "lexical", "semantic"] as const;
    for (const mode of validModes) {
      const res = await harness.dispatchSearchApiJson({ q: "helicase", mode }, alice);
      expect(res.status).toBe(200);
      expect(res.data.mode).toBe(mode);
    }

    const resInvalid = await harness.dispatchSearchApiJson(
      { q: "helicase", mode: "fulltext-magic" },
      alice
    );
    expect(resInvalid.status).toBe(400);
    expect(resInvalid.data.error).toContain("Invalid mode");
  });

  it("validates pagination parameters: clamps limit to 1..50, requires non-negative offset", async () => {
    // Default limit should be 20, default offset 0
    const resDefault = await harness.dispatchSearchApiJson({ q: "helicase" }, alice);
    expect(resDefault.status).toBe(200);
    expect(resDefault.data.limit).toBe(20);
    expect(resDefault.data.offset).toBe(0);

    // Custom valid limit and offset
    const resCustom = await harness.dispatchSearchApiJson(
      { q: "helicase", limit: 10, offset: 5 },
      alice
    );
    expect(resCustom.status).toBe(200);
    expect(resCustom.data.limit).toBe(10);
    expect(resCustom.data.offset).toBe(5);

    // Negative limit -> 400
    const resNegLimit = await harness.dispatchSearchApiJson({ q: "helicase", limit: -5 }, alice);
    expect(resNegLimit.status).toBe(400);

    // Limit = 0 -> 400
    const resZeroLimit = await harness.dispatchSearchApiJson({ q: "helicase", limit: 0 }, alice);
    expect(resZeroLimit.status).toBe(400);

    // Limit > 50 -> 400
    const resOverLimit = await harness.dispatchSearchApiJson({ q: "helicase", limit: 51 }, alice);
    expect(resOverLimit.status).toBe(400);

    // Negative offset -> 400
    const resNegOffset = await harness.dispatchSearchApiJson({ q: "helicase", offset: -1 }, alice);
    expect(resNegOffset.status).toBe(400);
  });

  it("validates entity types parameter and rejects unauthorized types like 'quiz'", async () => {
    const resValid = await harness.dispatchSearchApiJson(
      { q: "helicase", types: "note,material,subject" },
      alice
    );
    expect(resValid.status).toBe(200);

    const resQuiz = await harness.dispatchSearchApiJson(
      { q: "helicase", types: "quiz" },
      alice
    );
    expect(resQuiz.status).toBe(400);
    expect(resQuiz.data.error).toContain("quiz");

    const resUnknown = await harness.dispatchSearchApiJson(
      { q: "helicase", types: "unknown_entity" },
      alice
    );
    expect(resUnknown.status).toBe(400);
  });

  it("produces valid JSON response complying 100% with SearchApiResponse interface contract", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "DNA replication", mode: "hybrid", limit: 5, offset: 0 },
      alice
    );

    expect(res.status).toBe(200);
    expect(isSearchApiResponse(res.data)).toBe(true);
    assertSearchApiResponse(res.data);

    expect(typeof res.data.query).toBe("string");
    expect(typeof res.data.total).toBe("number");
    expect(Array.isArray(res.data.hits)).toBe(true);
    expect(typeof res.data.counts).toBe("object");

    for (const hit of res.data.hits) {
      expect(typeof hit.id).toBe("string");
      expect(typeof hit.title).toBe("string");
      expect(typeof hit.score).toBe("number");
      expect(typeof hit.navigation.href).toBe("string");
      expect(hit.navigation.href.startsWith("/")).toBe(true);
    }
  });
});
