/**
 * Tier 1 — Feature 5: Material Vector Reuse
 *
 * Verifies that semantic search for materials reuses the existing MaterialChunk embedding
 * infrastructure (1536-dimensional pgvector embeddings) without redundant vector columns
 * on the parent Material entity, and properly extracts chunk-level navigation metadata.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, SearchHit } from "../harness/contracts";
import {
  MOCK_VECTOR_DIMENSION,
  cosineSimilarity,
  createMockEmbedding,
} from "../harness/fixtures";

describe("Tier 1 — Feat 05: Material Vector Reuse", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("verifies MaterialChunk embeddings are 1536-dimensional unit vectors", () => {
    const data = harness.store.getData();
    const materialChunks = data.materialChunks;

    expect(materialChunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of materialChunks) {
      expect(chunk.embedding).toBeDefined();
      expect(Array.isArray(chunk.embedding)).toBe(true);
      expect(chunk.embedding.length).toBe(MOCK_VECTOR_DIMENSION);
      expect(chunk.embedding.length).toBe(1536);

      // Verify L2 norm is approximately 1.0
      const norm = Math.sqrt(chunk.embedding.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 2);
    }
  });

  it("confirms the Material parent table does not contain redundant vector columns", async () => {
    const db = harness.store.createPrismaClientMock();
    const material = await db.material.findUnique({
      where: { id: "mat-dna-slides" },
    });

    expect(material).toBeDefined();
    // Material entity should only contain metadata, text, status, and relationships
    expect(material.id).toBe("mat-dna-slides");
    expect(material.title).toBeDefined();
    expect(material.extractedText).toBeDefined();
    // Must NOT have any embedding property on the parent Material table
    expect((material as any).embedding).toBeUndefined();
    expect((material as any).vector).toBeUndefined();
    expect((material as any).embedding1536).toBeUndefined();
  });

  it("performs semantic retrieval over MaterialChunk embeddings in semantic mode", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "mat-slides-p2-helicase", mode: "semantic", types: "material" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.mode).toBe("semantic");

    const hit = (res.data.hits as SearchHit[]).find((h: SearchHit) => h.id === "mat-dna-slides");
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe("material");
    expect(hit?.matchType).toBe("semantic");
    expect(hit?.score).toBeGreaterThan(0.6);
  });

  it("extracts chunk-level page numbers for PDF materials to form deep links", async () => {
    // In seed fixtures, mchunk-slides-2 corresponds to page 2 (helicase hexamer)
    const res = await harness.dispatchSearchApiJson(
      { q: "mat-slides-p2-helicase", mode: "semantic", types: "material" },
      alice
    );

    expect(res.status).toBe(200);
    const hit = (res.data.hits as SearchHit[]).find((h: SearchHit) => h.id === "mat-dna-slides");
    expect(hit).toBeDefined();
    expect(hit?.navigation.pageNumber).toBe(2);
    expect(hit?.navigation.href).toBe("/materials/mat-dna-slides?page=2");
  });

  it("extracts chunk-level audio timestamps for Audio materials to form deep links", async () => {
    // Bob has access to group-1 chemistry audio material (mchunk-audio-1 at startSeconds: 120)
    const bob = { id: "user-bob", email: "bob@example.com", name: "Bob Jones" };
    const res = await harness.dispatchSearchApiJson(
      { q: "mat-audio-seg-1", mode: "semantic", types: "material" },
      bob
    );

    expect(res.status).toBe(200);
    const hit = (res.data.hits as SearchHit[]).find((h: SearchHit) => h.id === "mat-chem-lecture-audio");
    expect(hit).toBeDefined();
    expect(hit?.navigation.timestampSeconds).toBe(120);
    expect(hit?.navigation.href).toBe("/materials/mat-chem-lecture-audio?t=120");
  });

  it("accurately orders multiple material chunks by cosine similarity", () => {
    const queryVec = createMockEmbedding("query-concept");
    const closeVec = createMockEmbedding("query-concept"); // identical seed -> similarity ~ 1.0
    const distantVec = createMockEmbedding("distant-concept-xyz");

    const simClose = cosineSimilarity(queryVec, closeVec);
    const simDistant = cosineSimilarity(queryVec, distantVec);

    expect(simClose).toBeCloseTo(1.0, 2);
    expect(simDistant).toBeLessThan(simClose);
    expect(simClose - simDistant).toBeGreaterThan(0.1);
  });
});
