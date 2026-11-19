/**
 * Tier 3: Pairwise Cross-Feature Interactions — Lexical + Semantic + RRF Ranking
 *
 * Systematic combinatorial testing of Features F1, F5/F7, and F10:
 * - Pure lexical candidates (keyword match in title/body, zero semantic match)
 * - Pure semantic candidates (high cosine similarity, zero keyword overlap)
 * - Dual-channel candidates (matching both lexical keywords and vector semantics)
 * - Reciprocal Rank Fusion (RRF k=60) mathematical properties:
 *   - Formula: score = sum( 1 / (60 + rank_i) )
 *   - Blending dominance: Dual-match at lower ranks outranking single-match at rank 1
 *   - Perfect dual-match at rank (1, 1) achieving highest score
 * - Search Mode filtering (`mode=hybrid` vs `mode=lexical` vs `mode=semantic`)
 * - Output `matchType` fidelity ("hybrid", "lexical", "semantic")
 * - Score monotonicity and ordering stability
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import {
  calculateRRFScore,
  assertSearchApiResponse,
  SearchHit,
} from "../harness/contracts";
import { createMockEmbedding } from "../harness/fixtures";

describe("Tier 3: Pairwise Interaction — Lexical, Semantic & RRF Blending", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  // ==========================================================================
  // 1. RRF MATHEMATICAL BLENDING PROPERTIES
  // ==========================================================================
  describe("RRF (k=60) Mathematical Blending & Rank Fusion", () => {
    it("computes exact RRF score for a pure lexical candidate at rank 1", () => {
      const score = calculateRRFScore(1, null, 60);
      expect(score).toBeCloseTo(1 / 61, 6);
      expect(Number(score.toFixed(6))).toBe(0.016393);
    });

    it("computes exact RRF score for a pure semantic candidate at rank 1", () => {
      const score = calculateRRFScore(null, 1, 60);
      expect(score).toBeCloseTo(1 / 61, 6);
      expect(Number(score.toFixed(6))).toBe(0.016393);
    });

    it("computes exact RRF score for a dual hit at rank 1 in both channels", () => {
      const score = calculateRRFScore(1, 1, 60);
      expect(score).toBeCloseTo(1 / 61 + 1 / 61, 6);
      expect(Number(score.toFixed(6))).toBe(0.032787);
    });

    it("ensures a dual hit at rank (2, 2) strictly outranks a single-channel hit at rank 1", () => {
      // Dual hit at (2, 2): 1/(60+2) + 1/(60+2) = 2/62 ≈ 0.032258
      // Single hit at (1, null): 1/(60+1) = 1/61 ≈ 0.016393
      const dualScore = calculateRRFScore(2, 2, 60);
      const singleScore = calculateRRFScore(1, null, 60);
      expect(dualScore).toBeGreaterThan(singleScore);
      expect(dualScore - singleScore).toBeGreaterThan(0.015);
    });

    it("ensures a dual hit at rank (5, 5) outranks a single-channel hit at rank 1", () => {
      // Dual hit at (5, 5): 1/65 + 1/65 = 2/65 ≈ 0.030769
      // Single hit at (1, null): 1/61 ≈ 0.016393
      const dualScoreRank5 = calculateRRFScore(5, 5, 60);
      const singleScoreRank1 = calculateRRFScore(1, null, 60);
      expect(dualScoreRank5).toBeGreaterThan(singleScoreRank1);
    });

    it("ensures score decreases monotonically with worsening ranks", () => {
      const rank1 = calculateRRFScore(1, 1, 60);
      const rank2 = calculateRRFScore(2, 2, 60);
      const rank3 = calculateRRFScore(3, 3, 60);
      const rank10 = calculateRRFScore(10, 10, 60);

      expect(rank1).toBeGreaterThan(rank2);
      expect(rank2).toBeGreaterThan(rank3);
      expect(rank3).toBeGreaterThan(rank10);
    });
  });

  // ==========================================================================
  // 2. END-TO-END RETRIEVAL BLENDING & MATCH TYPES
  // ==========================================================================
  describe("End-to-End Retrieval Blending (Hybrid vs Lexical vs Semantic)", () => {
    it("assigns matchType='hybrid' to candidate matching both channels in hybrid mode", async () => {
      // Query 'helicase' matches note-dna-helicase lexically and semantically
      const res = await harness.dispatchSearchApiJson({ q: "helicase", mode: "hybrid" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);

      const helicaseHit = res.data.hits.find((h: SearchHit) => h.id === "note-dna-helicase");
      expect(helicaseHit).toBeDefined();
      expect(helicaseHit?.matchType).toBe("hybrid");
      expect(helicaseHit?.score).toBeGreaterThan(0.02); // Must be a dual hit score
    });

    it("assigns matchType='lexical' to candidate matching only lexically in hybrid mode", async () => {
      // Add a note with pure text match but unrelated mock embedding
      const data = harness.store.getData();
      data.notes.push({
        id: "note-pure-lexical",
        topicId: "topic-helicase",
        authorId: "user-alice",
        title: "Rare Synthetic Oligonucleotide",
        plainText: "Rare Synthetic Oligonucleotide with no semantic overlap",
        source: "USER_CREATED",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      data.noteChunks.push({
        id: "nc-lex-only",
        noteId: "note-pure-lexical",
        content: "Rare Synthetic Oligonucleotide with no semantic overlap",
        order: 1,
        // Vector orthogonal to query
        embedding: createMockEmbedding("completely-unrelated-random-seed-xyz-999"),
        createdAt: new Date(),
      });

      const res = await harness.dispatchSearchApiJson({ q: "Oligonucleotide", mode: "hybrid" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);

      const hit = res.data.hits.find((h: SearchHit) => h.id === "note-pure-lexical");
      expect(hit).toBeDefined();
      expect(hit?.matchType).toBe("lexical");
      expect(hit?.score).toBeLessThanOrEqual(1 / 61); // Single-channel score
    });

    it("assigns matchType='semantic' to candidate matching only semantically in hybrid mode", async () => {
      // Seed a note whose text has zero query token match, but whose embedding is identical to query embedding
      const queryText = "enzymatic unwinding";
      const queryEmb = createMockEmbedding(queryText);

      const data = harness.store.getData();
      data.notes.push({
        id: "note-pure-semantic",
        topicId: "topic-helicase",
        authorId: "user-alice",
        title: "Biochemical Reaction Kinetics",
        plainText: "Catalytic acceleration and molecular motion", // No words matching 'enzymatic' or 'unwinding'
        source: "USER_CREATED",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      data.noteChunks.push({
        id: "nc-sem-only",
        noteId: "note-pure-semantic",
        content: "Catalytic acceleration and molecular motion",
        order: 1,
        embedding: queryEmb, // 100% cosine similarity to query
        createdAt: new Date(),
      });

      const res = await harness.dispatchSearchApiJson({ q: queryText, mode: "hybrid" });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);

      const hit = res.data.hits.find((h: SearchHit) => h.id === "note-pure-semantic");
      expect(hit).toBeDefined();
      expect(hit?.matchType).toBe("semantic");
    });
  });

  // ==========================================================================
  // 3. SEARCH MODE SWITCHING BEHAVIOR
  // ==========================================================================
  describe("Mode Filtering Invariance", () => {
    it("pure lexical mode (mode=lexical) excludes candidates that have only semantic matches", async () => {
      const queryText = "molecular catalysis";
      const queryEmb = createMockEmbedding(queryText);

      const data = harness.store.getData();
      data.notes.push({
        id: "note-sem-candidate",
        topicId: "topic-helicase",
        authorId: "user-alice",
        title: "Bioenergetics Review",
        plainText: "Thermodynamics and free energy",
        source: "USER_CREATED",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      data.noteChunks.push({
        id: "nc-sem-cand",
        noteId: "note-sem-candidate",
        content: "Thermodynamics and free energy",
        order: 1,
        embedding: queryEmb,
        createdAt: new Date(),
      });

      // Under hybrid: matches semantically
      const hybridRes = await harness.dispatchSearchApiJson({ q: queryText, mode: "hybrid" });
      expect(hybridRes.data.hits.some((h: SearchHit) => h.id === "note-sem-candidate")).toBe(true);

      // Under pure lexical: must be excluded!
      const lexicalRes = await harness.dispatchSearchApiJson({ q: queryText, mode: "lexical" });
      expect(lexicalRes.data.hits.some((h: SearchHit) => h.id === "note-sem-candidate")).toBe(false);
    });

    it("pure semantic mode (mode=semantic) excludes non-embeddable entities like subjects and chapters", async () => {
      // Query matches Alice's subject 'Molecular Biology'
      const lexicalRes = await harness.dispatchSearchApiJson({ q: "Molecular Biology", mode: "lexical" });
      const semanticRes = await harness.dispatchSearchApiJson({ q: "Molecular Biology", mode: "semantic" });

      expect(lexicalRes.data.hits.some((h: SearchHit) => h.entityType === "subject")).toBe(true);
      // In semantic mode, subjects cannot match because they have no vector embeddings
      expect(semanticRes.data.hits.some((h: SearchHit) => h.entityType === "subject")).toBe(false);
    });

    it("ensures results in all modes are sorted in strictly non-increasing score order", async () => {
      for (const mode of ["hybrid", "lexical", "semantic"] as const) {
        const res = await harness.dispatchSearchApiJson({ q: "dna replication", mode });
        expect(res.status).toBe(200);
        const hits: SearchHit[] = res.data.hits;
        for (let i = 0; i < hits.length - 1; i++) {
          const currentScore = hits[i]?.score ?? 0;
          const nextScore = hits[i + 1]?.score ?? 0;
          expect(currentScore).toBeGreaterThanOrEqual(nextScore);
        }
      }
    });
  });
});
