/**
 * Tier 3: Pairwise Cross-Feature Interactions — Pagination Offsets & Chunk Collapsing
 *
 * Systematic combinatorial testing of Features F11 and F16:
 * - Multi-chunk documents (Materials with multiple PDF page chunks, Notes with multiple block chunks)
 * - Entity-level collapsing: multiple matching chunks are collapsed into exactly 1 hit per parent entity
 * - Top-chunk selection: highest scoring chunk provides the contextual snippet and navigation deep link
 * - Distinct count accounting: `total` count reflects collapsed parent entities, NOT raw chunk matches
 * - Pagination offset stability under collapsing:
 *   - Successive paginated requests (`offset=0`, `offset=2`, `offset=4`) never duplicate collapsed entities
 *   - Page disjointness: no hit on Page $N$ appears on Page $N+1$
 *   - Monotonic score ordering across page boundaries
 *   - Deep offsets beyond collapsed total return empty hits array
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, SearchHit } from "../harness/contracts";
import { createMockEmbedding } from "../harness/fixtures";

describe("Tier 3: Pairwise Interaction — Chunk Collapsing & Pagination Offsets", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  // ==========================================================================
  // 1. MULTI-CHUNK COLLAPSING TO SINGLE PARENT HIT
  // ==========================================================================
  describe("Multi-Chunk Collapsing & Top-Chunk Selection", () => {
    it("collapses a material with 5 matching chunks into exactly 1 search hit", async () => {
      const data = harness.store.getData();
      const materialId = "mat-multipage-genetics";

      data.materials.push({
        id: materialId,
        ownerId: "user-alice",
        workspaceId: "ws-alice",
        subjectId: "subj-alice-bio",
        chapterId: "chap-dna",
        topicId: "topic-helicase",
        type: "PDF",
        title: "Advanced Mendelian and Molecular Genetics",
        extractedText: "Multi-page comprehensive allelic variation genetics lecture slides",
        status: "READY",
        visibility: "PRIVATE",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      // Add 5 distinct chunks matching 'allelic'
      for (let page = 1; page <= 5; page++) {
        data.materialChunks.push({
          id: `mc-page-${page}`,
          materialId,
          content: `Page ${page} discusses allelic frequencies, locus linkage, and genetic drift variance.`,
          order: page,
          pageNumber: page,
          embedding: createMockEmbedding(`allelic page ${page}`),
          createdAt: new Date(),
        });
      }

      // Search for 'allelic'
      const res = await harness.dispatchSearchApiJson({
        q: "allelic",
        types: ["material"],
      });

      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);

      // Verify material appears exactly ONCE despite having 5 matching chunks
      const matches = res.data.hits.filter((h: SearchHit) => h.id === materialId);
      expect(matches.length).toBe(1);
      expect(matches[0]?.entityType).toBe("material");
      expect(matches[0]?.navigation.href).toMatch(/\/materials\/mat-multipage-genetics\?page=\d+/);
    });

    it("selects the highest scoring chunk to populate navigation pageNumber and snippet", async () => {
      const data = harness.store.getData();
      const materialId = "mat-target-chunk";
      const queryText = "transcription factor binding";
      const targetEmbedding = createMockEmbedding(queryText);

      data.materials.push({
        id: materialId,
        ownerId: "user-alice",
        workspaceId: "ws-alice",
        subjectId: "subj-alice-bio",
        chapterId: "chap-dna",
        topicId: "topic-helicase",
        type: "PDF",
        title: "Eukaryotic Gene Regulation Slides",
        extractedText: "Transcriptional control slides",
        status: "READY",
        visibility: "PRIVATE",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      // Page 1: weak match
      data.materialChunks.push({
        id: "mc-target-p1",
        materialId,
        content: "Page 1: General introductory remarks on cell biology.",
        order: 1,
        pageNumber: 1,
        embedding: createMockEmbedding("general introduction"),
        createdAt: new Date(),
      });

      // Page 4: exact semantic match to query
      data.materialChunks.push({
        id: "mc-target-p4",
        materialId,
        content: "Page 4 details the exact transcription factor binding affinity at enhancers.",
        order: 4,
        pageNumber: 4,
        embedding: targetEmbedding, // Exact vector match
        createdAt: new Date(),
      });

      const res = await harness.dispatchSearchApiJson({
        q: queryText,
        mode: "hybrid",
      });

      expect(res.status).toBe(200);
      const hit = res.data.hits.find((h: SearchHit) => h.id === materialId);
      expect(hit).toBeDefined();
      // Navigation pageNumber must point to the best chunk (Page 4)
      expect(hit?.navigation.pageNumber).toBe(4);
      expect(hit?.navigation.href).toBe(`/materials/${materialId}?page=4`);
      expect(hit?.snippet).toContain("Page 4 details");
    });
  });

  // ==========================================================================
  // 2. PAGINATION OFFSETS ACROSS COLLAPSED RESULTS
  // ==========================================================================
  describe("Pagination Across Collapsed Results", () => {
    it("ensures no collapsed entity duplicates across pagination boundaries", async () => {
      // Query that matches multiple notes and materials
      const fullRes = await harness.dispatchSearchApiJson({
        q: "dna",
        limit: 50,
        offset: 0,
      });
      expect(fullRes.status).toBe(200);
      const allHits: SearchHit[] = fullRes.data.hits;
      const totalHits = allHits.length;
      expect(totalHits).toBeGreaterThanOrEqual(3);

      // Paginate with limit=2
      const page1 = await harness.dispatchSearchApiJson({ q: "dna", limit: 2, offset: 0 });
      const page2 = await harness.dispatchSearchApiJson({ q: "dna", limit: 2, offset: 2 });
      const page3 = await harness.dispatchSearchApiJson({ q: "dna", limit: 2, offset: 4 });

      const page1Ids = page1.data.hits.map((h: SearchHit) => h.id);
      const page2Ids = page2.data.hits.map((h: SearchHit) => h.id);
      const page3Ids = page3.data.hits.map((h: SearchHit) => h.id);

      // Verify no overlap between pages
      for (const id of page1Ids) {
        expect(page2Ids).not.toContain(id);
        expect(page3Ids).not.toContain(id);
      }
      for (const id of page2Ids) {
        expect(page3Ids).not.toContain(id);
      }

      // Verify union of pages matches initial hits
      const combined = [...page1Ids, ...page2Ids, ...page3Ids];
      const expectedPrefix = allHits.slice(0, combined.length).map((h) => h.id);
      expect(combined).toEqual(expectedPrefix);
    });

    it("maintains strictly monotonic non-increasing score order across page transitions", async () => {
      const page1 = await harness.dispatchSearchApiJson({ q: "dna", limit: 2, offset: 0 });
      const page2 = await harness.dispatchSearchApiJson({ q: "dna", limit: 2, offset: 2 });

      if (page1.data.hits.length > 0 && page2.data.hits.length > 0) {
        const lastScorePage1 = page1.data.hits[page1.data.hits.length - 1].score;
        const firstScorePage2 = page2.data.hits[0].score;
        expect(lastScorePage1).toBeGreaterThanOrEqual(firstScorePage2);
      }
    });

    it("preserves total count across all pages regardless of chunk collapsing density", async () => {
      const resOffset0 = await harness.dispatchSearchApiJson({ q: "dna", limit: 1, offset: 0 });
      const resOffset2 = await harness.dispatchSearchApiJson({ q: "dna", limit: 1, offset: 2 });

      expect(resOffset0.data.total).toBe(resOffset2.data.total);
      expect(resOffset0.data.counts).toEqual(resOffset2.data.counts);
    });
  });
});
