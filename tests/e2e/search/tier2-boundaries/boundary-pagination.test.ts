/**
 * Tier 2: Boundary Value Analysis — Pagination Parameters
 *
 * Systematic boundary testing of `limit` and `offset`:
 * - `limit`: 0, 1 (min valid), 20 (default), 50 (max valid), 51 (exceeds max), 100+, negative values, decimals, non-integers
 * - `offset`: 0 (min valid, default), 1, deep pagination (100, 1000+ exceeding total), negative values, decimals, non-integers
 * - Invariants: Total counts and facet counts invariance across pages
 * - Successive page stability and disjointness
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, SearchHit } from "../harness/contracts";

describe("Tier 2: Pagination Boundaries (`limit` & `offset`)", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  // ==========================================================================
  // 1. LIMIT BOUNDARIES
  // ==========================================================================
  describe("Limit Boundaries", () => {
    it("rejects limit=0 with 400 Bad Request (below min limit 1)", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: 0 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/limit must be an integer between 1 and 50/i);
    });

    it("accepts limit=1 (exact minimum valid limit) with 200 OK and at most 1 hit", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: 1 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.limit).toBe(1);
      expect(res.data.hits.length).toBeLessThanOrEqual(1);
    });

    it("defaults to limit=20 when limit parameter is omitted", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.limit).toBe(20);
    });

    it("accepts limit=50 (exact maximum valid limit) with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: 50 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.limit).toBe(50);
      expect(res.data.hits.length).toBeLessThanOrEqual(50);
    });

    it("rejects limit=51 (one above maximum limit 50) with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: 51 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/limit must be an integer between 1 and 50/i);
    });

    it("rejects limit=100 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: 100 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/limit must be an integer between 1 and 50/i);
    });

    it("rejects negative limit=-1 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: -1 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/limit must be an integer between 1 and 50/i);
    });

    it("rejects large negative limit=-100 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: -100 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/limit must be an integer between 1 and 50/i);
    });

    it("rejects decimal limit=10.5 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: 10.5 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/limit must be an integer between 1 and 50/i);
    });

    it("rejects non-numeric string limit='twenty' with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: "twenty" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/limit must be an integer between 1 and 50/i);
    });

    it("rejects non-numeric string limit='NaN' with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: "NaN" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/limit must be an integer between 1 and 50/i);
    });
  });

  // ==========================================================================
  // 2. OFFSET BOUNDARIES
  // ==========================================================================
  describe("Offset Boundaries", () => {
    it("defaults to offset=0 when offset parameter is omitted", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.offset).toBe(0);
    });

    it("accepts offset=0 (exact minimum valid offset) with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", offset: 0 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.offset).toBe(0);
    });

    it("accepts nominal offset=1 with 200 OK", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", offset: 1 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.offset).toBe(1);
    });

    it("handles deep offset=1000 beyond total hits without crashing, returning empty hits", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", offset: 1000 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.offset).toBe(1000);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBeGreaterThan(0);
    });

    it("handles extreme deep offset=1,000,000 safely returning empty hits", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", offset: 1000000 });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });

    it("rejects negative offset=-1 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", offset: -1 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/offset must be a non-negative integer/i);
    });

    it("rejects large negative offset=-50 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", offset: -50 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/offset must be a non-negative integer/i);
    });

    it("rejects decimal offset=3.14 with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", offset: 3.14 });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/offset must be a non-negative integer/i);
    });

    it("rejects non-numeric string offset='page2' with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", offset: "page2" });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/offset must be a non-negative integer/i);
    });
  });

  // ==========================================================================
  // 3. PAGINATION INVARIANTS & INTEGRITY
  // ==========================================================================
  describe("Pagination Invariants & Integrity", () => {
    it("maintains identical 'total' across varying limits (1, 5, 20, 50)", async () => {
      const res1 = await harness.dispatchSearchApiJson({ q: "dna", limit: 1 });
      const res5 = await harness.dispatchSearchApiJson({ q: "dna", limit: 5 });
      const res20 = await harness.dispatchSearchApiJson({ q: "dna", limit: 20 });
      const res50 = await harness.dispatchSearchApiJson({ q: "dna", limit: 50 });

      expect(res1.data.total).toBe(res5.data.total);
      expect(res5.data.total).toBe(res20.data.total);
      expect(res20.data.total).toBe(res50.data.total);
      expect(res1.data.total).toBeGreaterThan(0);
    });

    it("maintains identical 'total' across varying offsets (0, 1, 10, 1000)", async () => {
      const res0 = await harness.dispatchSearchApiJson({ q: "dna", offset: 0 });
      const res1 = await harness.dispatchSearchApiJson({ q: "dna", offset: 1 });
      const res1000 = await harness.dispatchSearchApiJson({ q: "dna", offset: 1000 });

      expect(res0.data.total).toBe(res1.data.total);
      expect(res1.data.total).toBe(res1000.data.total);
    });

    it("maintains identical facet 'counts' across varying offsets", async () => {
      const res0 = await harness.dispatchSearchApiJson({ q: "dna", offset: 0 });
      const resDeep = await harness.dispatchSearchApiJson({ q: "dna", offset: 500 });

      expect(res0.data.counts).toEqual(resDeep.data.counts);
    });

    it("ensures successive pages (limit=1, offset=0 and limit=1, offset=1) are disjoint and match limit=2, offset=0", async () => {
      const page1 = await harness.dispatchSearchApiJson({ q: "dna", limit: 1, offset: 0 });
      const page2 = await harness.dispatchSearchApiJson({ q: "dna", limit: 1, offset: 1 });
      const combined = await harness.dispatchSearchApiJson({ q: "dna", limit: 2, offset: 0 });

      if (combined.data.total >= 2) {
        expect(page1.data.hits[0].id).not.toBe(page2.data.hits[0].id);
        expect(combined.data.hits[0].id).toBe(page1.data.hits[0].id);
        expect(combined.data.hits[1].id).toBe(page2.data.hits[0].id);
      }
    });

    it("handles exact dataset boundary: offset equal to total returns empty hits without error", async () => {
      const allHits = await harness.dispatchSearchApiJson({ q: "dna", limit: 50 });
      const total = allHits.data.total;
      expect(total).toBeGreaterThan(0);

      const atBoundary = await harness.dispatchSearchApiJson({ q: "dna", limit: 10, offset: total });
      expect(atBoundary.status).toBe(200);
      assertSearchApiResponse(atBoundary.data);
      expect(atBoundary.data.hits).toEqual([]);
      expect(atBoundary.data.total).toBe(total);
    });

    it("returns monotonically non-increasing scores across paginated traversal", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna", limit: 50, offset: 0 });
      const hits: SearchHit[] = res.data.hits;

      for (let i = 0; i < hits.length - 1; i++) {
        const currentScore = hits[i]?.score ?? 0;
        const nextScore = hits[i + 1]?.score ?? 0;
        expect(currentScore).toBeGreaterThanOrEqual(nextScore);
      }
    });
  });
});
