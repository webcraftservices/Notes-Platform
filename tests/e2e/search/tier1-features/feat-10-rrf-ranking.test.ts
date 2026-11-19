/**
 * Tier 1 — Feature 10: Unified RRF Ranking
 *
 * Verifies Reciprocal Rank Fusion (RRF with k=60 constant) for blending lexical
 * and semantic candidate channels into a single unified relevance ranking.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { calculateRRFScore } from "../harness/contracts";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse } from "../harness/contracts";

describe("Tier 1 — Feat 10: Unified RRF Ranking", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("calculates RRF score accurately matching formula sum(1 / (k + rank_i)) with k=60", () => {
    // Rank 1 lexical, Rank 1 semantic
    // score = 1/(60+1) + 1/(60+1) = 2/61 ≈ 0.032786885
    const dualRank1 = calculateRRFScore(1, 1, 60);
    expect(dualRank1).toBeCloseTo(2 / 61, 6);

    // Rank 1 lexical, null semantic
    const lexOnly1 = calculateRRFScore(1, null, 60);
    expect(lexOnly1).toBeCloseTo(1 / 61, 6);

    // Null lexical, Rank 1 semantic
    const semOnly1 = calculateRRFScore(null, 1, 60);
    expect(semOnly1).toBeCloseTo(1 / 61, 6);
  });

  it("ensures dual-channel matches always outrank single-channel matches at equivalent ranks", () => {
    const dualScoreRank1 = calculateRRFScore(1, 1, 60);
    const lexOnlyScoreRank1 = calculateRRFScore(1, null, 60);
    const semOnlyScoreRank1 = calculateRRFScore(null, 1, 60);

    expect(dualScoreRank1).toBeGreaterThan(lexOnlyScoreRank1);
    expect(dualScoreRank1).toBeGreaterThan(semOnlyScoreRank1);
    expect(dualScoreRank1).toBeCloseTo(lexOnlyScoreRank1 + semOnlyScoreRank1, 6);

    // Dual match at rank 2 outranks single match at rank 1:
    // dual rank 2: 1/62 + 1/62 = 2/62 = 1/31 ≈ 0.032258
    // single rank 1: 1/61 ≈ 0.016393
    const dualScoreRank2 = calculateRRFScore(2, 2, 60);
    expect(dualScoreRank2).toBeGreaterThan(lexOnlyScoreRank1);
  });

  it("strictly preserves monotonic ordering where better ranks produce strictly higher scores", () => {
    const rank1 = calculateRRFScore(1, 1, 60);
    const rank2 = calculateRRFScore(2, 2, 60);
    const rank5 = calculateRRFScore(5, 5, 60);
    const rank20 = calculateRRFScore(20, 20, 60);

    expect(rank1).toBeGreaterThan(rank2);
    expect(rank2).toBeGreaterThan(rank5);
    expect(rank5).toBeGreaterThan(rank20);
  });

  it("verifies k=60 prevents low-ranked outliers from disproportionately skewing scores", () => {
    // Score ratio between rank 1 and rank 10 with k=60:
    // (1/(60+1)) / (1/(60+10)) = 70 / 61 ≈ 1.147 (smooth transition)
    const scoreRank1 = calculateRRFScore(1, null, 60);
    const scoreRank10 = calculateRRFScore(10, null, 60);
    const ratio = scoreRank1 / scoreRank10;

    expect(ratio).toBeLessThan(1.5); // Graceful degradation rather than catastrophic drop-off
    expect(scoreRank1).toBeGreaterThan(scoreRank10);
  });

  it("handles missing ranks, null values, and edge conditions without division by zero or NaN", () => {
    expect(calculateRRFScore(null, null, 60)).toBe(0);
    expect(calculateRRFScore(0, 0, 60)).toBe(0);
    expect(calculateRRFScore(-1, null, 60)).toBe(0);
    expect(isNaN(calculateRRFScore(1, 1, 60))).toBe(false);
  });

  it("verifies search API returns hits sorted in strictly descending order of RRF score", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "helicase replication fork", mode: "hybrid" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    const hits = res.data.hits;
    expect(hits.length).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < hits.length - 1; i++) {
      const current = hits[i];
      const next = hits[i + 1];
      expect(current).toBeDefined();
      expect(next).toBeDefined();
      if (current && next) {
        expect(current.score).toBeGreaterThanOrEqual(next.score);
      }
    }
  });
});
