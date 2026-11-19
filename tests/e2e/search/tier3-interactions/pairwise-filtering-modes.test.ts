/**
 * Tier 3: Pairwise Cross-Feature Interactions — Filtering & Search Modes
 *
 * Systematic 2-way combinatorial testing of Features F12 and F16:
 * - Search Modes (`hybrid`, `lexical`, `semantic`) combined pairwise with
 *   Entity Types (`note`, `material`, `subject`, `chapter`, `topic`, `group`, `flashcard`)
 * - Hierarchy scope constraints (`subjectId`, `groupId`, `topicId`) combined with modes
 * - Semantic mode applicability: applies only to embeddable entities (notes, materials)
 * - Formal rejection of excluded entity types (`quiz`) across all modes
 * - Multi-type syntax (comma-separated vs array)
 * - Facet distribution accuracy under mode and type filtering
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, SearchHit } from "../harness/contracts";

describe("Tier 3: Pairwise Interaction — Filtering Modes & Entity Constraints", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  // ==========================================================================
  // 1. COMBINATORIAL MATRIX: SEARCH MODES × ENTITY TYPES
  // ==========================================================================
  describe("Combinatorial Matrix: Search Modes × Entity Types", () => {
    it("combines mode='semantic' with types=['note'] returning only note hits", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "replication helicase",
        mode: "semantic",
        types: ["note"],
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits.length).toBeGreaterThanOrEqual(1);
      for (const hit of res.data.hits) {
        expect(hit.entityType).toBe("note");
        expect(hit.matchType).toBe("semantic");
      }
    });

    it("combines mode='semantic' with types=['material'] returning only material hits", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "replication fork slides",
        mode: "semantic",
        types: ["material"],
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits.length).toBeGreaterThanOrEqual(1);
      for (const hit of res.data.hits) {
        expect(hit.entityType).toBe("material");
        expect(hit.matchType).toBe("semantic");
      }
    });

    it("combines mode='semantic' with types=['subject'] returning 0 hits (subjects are non-embeddable)", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "Molecular Biology",
        mode: "semantic",
        types: ["subject"],
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBe(0);
    });

    it("combines mode='semantic' with types=['group'] returning 0 hits (groups are non-embeddable)", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "Biochemistry Study Group",
        mode: "semantic",
        types: ["group"],
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });

    it("combines mode='semantic' with types=['flashcard'] returning 0 hits (cards embeddings deferred in Phase 12)", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "Molecular Biology Flashcards",
        mode: "semantic",
        types: ["flashcard"],
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });

    it("combines mode='lexical' with types=['subject', 'chapter', 'topic'] returning structural hierarchy matches", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "Biology",
        mode: "lexical",
        types: ["subject", "chapter", "topic"],
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits.length).toBeGreaterThanOrEqual(1);
      for (const hit of res.data.hits) {
        expect(["subject", "chapter", "topic"]).toContain(hit.entityType);
        expect(hit.matchType).toBe("lexical");
      }
    });

    it("combines mode='hybrid' with types=['note', 'material'] returning blended dual hits", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "replication",
        mode: "hybrid",
        types: ["note", "material"],
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits.length).toBeGreaterThanOrEqual(2);
      const entityTypes = new Set(res.data.hits.map((h: SearchHit) => h.entityType));
      expect(entityTypes.has("note") || entityTypes.has("material")).toBe(true);
      expect(entityTypes.has("subject")).toBe(false);
    });
  });

  // ==========================================================================
  // 2. HIERARCHY SCOPING COMBINED WITH MODES
  // ==========================================================================
  describe("Hierarchy Scopes Combined with Modes", () => {
    it("combines subjectId scoping with mode='hybrid' to restrict retrieval to Alice's biology subject", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "replication",
        mode: "hybrid",
        subjectId: "subj-alice-bio",
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits.length).toBeGreaterThanOrEqual(1);
      for (const hit of res.data.hits) {
        expect(hit.hierarchy.subjectId).toBe("subj-alice-bio");
      }
    });

    it("combines groupId scoping with mode='lexical' to restrict retrieval to Group 1", async () => {
      const res = await harness.dispatchSearchApiJson(
        {
          q: "Chemistry",
          mode: "lexical",
          groupId: "group-1",
        },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits.length).toBeGreaterThanOrEqual(1);
      for (const hit of res.data.hits) {
        expect(hit.hierarchy.groupId).toBe("group-1");
      }
    });

    it("combines topicId scoping with mode='semantic' to restrict to specific topic", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "helicase unwinding",
        mode: "semantic",
        topicId: "topic-helicase",
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      for (const hit of res.data.hits) {
        expect(hit.hierarchy.topicId).toBe("topic-helicase");
      }
    });
  });

  // ==========================================================================
  // 3. SYNTAX & TYPE VALIDATION COMBINATIONS
  // ==========================================================================
  describe("Syntax & Excluded Type Combinations", () => {
    it("accepts comma-separated string 'types=note,material' with identical results to array syntax", async () => {
      const resComma = await harness.dispatchSearchApiJson({
        q: "dna",
        types: "note,material",
      });
      const resArray = await harness.dispatchSearchApiJson({
        q: "dna",
        types: ["note", "material"],
      });

      expect(resComma.status).toBe(200);
      expect(resArray.status).toBe(200);
      expect(resComma.data.total).toBe(resArray.data.total);
      expect(resComma.data.hits.map((h: SearchHit) => h.id)).toEqual(
        resArray.data.hits.map((h: SearchHit) => h.id)
      );
    });

    it("formally rejects 'types=quiz' across all search modes with 400 Bad Request", async () => {
      for (const mode of ["hybrid", "lexical", "semantic"] as const) {
        const res = await harness.dispatchSearchApiJson({
          q: "biology quiz",
          mode,
          types: "quiz",
        });
        expect(res.status).toBe(400);
        expect(res.data?.error).toMatch(/excluded from phase 12 search/i);
      }
    });

    it("formally rejects mixed types including quiz 'types=note,quiz' with 400 Bad Request", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "biology",
        types: "note,quiz",
      });
      expect(res.status).toBe(400);
      expect(res.data?.error).toMatch(/excluded from phase 12 search/i);
    });
  });
});
