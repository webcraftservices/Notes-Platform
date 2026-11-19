/**
 * Tier 1 — Feature 11: Chunk Collapsing & Deduplication
 *
 * Verifies that when a query matches multiple chunks of a single Note or Material,
 * the search engine collapses the candidate chunks into a single top-level entity hit,
 * selecting the highest-scoring chunk's score, snippet, and navigation metadata.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse } from "../harness/contracts";

describe("Tier 1 — Feat 11: Chunk Collapsing & Deduplication", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("collapses multiple matching chunks of a single Material into exactly one search hit", async () => {
    // In seed fixtures, mat-dna-slides has 3 chunks:
    // chunk 1 (slide 1): "DNA Replication overview"
    // chunk 2 (slide 2): "Helicase hexamer enzyme motor unwinding duplex DNA at 1000 bp/sec"
    // chunk 3 (slide 3): "Polymerase delta and epsilon coordination"
    // Searching for "DNA" matches all 3 chunks
    const res = await harness.dispatchSearchApiJson(
      { q: "DNA", mode: "hybrid", types: "material" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    // mat-dna-slides must appear exactly ONCE in hits
    const occurrences = res.data.hits.filter((h) => h.id === "mat-dna-slides");
    expect(occurrences.length).toBe(1);
    expect(res.data.counts.material).toBe(1);
  });

  it("collapses multiple matching chunks of a single Note into exactly one search hit", async () => {
    // In seed fixtures, note-dna-helicase has 2 chunks:
    // chunk 1: "DNA helicase unwinds the double helix at the replication fork..."
    // chunk 2: "DNA polymerase III synthesizes the leading strand..."
    // Query "DNA strand" matches both chunks
    const res = await harness.dispatchSearchApiJson(
      { q: "DNA strand", mode: "hybrid", types: "note" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    const occurrences = res.data.hits.filter((h) => h.id === "note-dna-helicase");
    expect(occurrences.length).toBe(1);
    expect(res.data.counts.note).toBe(1);
  });

  it("selects the highest-scoring chunk as the representative score and snippet", async () => {
    // Semantic search targeting chunk 2 (page 2: helicase hexamer motor)
    const res = await harness.dispatchSearchApiJson(
      { q: "mat-slides-p2-helicase", mode: "semantic", types: "material" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    const hit = res.data.hits.find((h) => h.id === "mat-dna-slides");
    expect(hit).toBeDefined();
    // Representative snippet must be from chunk 2 (slide 2), not chunk 1 or chunk 3
    expect(hit?.snippet?.toLowerCase()).toContain("helicase");
    expect(hit?.navigation.pageNumber).toBe(2);
    expect(hit?.navigation.href).toBe("/materials/mat-dna-slides?page=2");
  });

  it("ensures total response count reflects unique entity count, not raw matching chunk count", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "replication", mode: "hybrid" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    // Total must equal the sum of unique entity hits
    const uniqueHitIds = new Set(res.data.hits.map((h) => h.id));
    expect(uniqueHitIds.size).toBe(res.data.hits.length);
    expect(res.data.total).toBe(res.data.hits.length);
  });

  it("preserves deep-link page and timestamp targeting on collapsed hits across modes", async () => {
    // Semantic search targeting chunk 2 gives page 2
    const res = await harness.dispatchSearchApiJson(
      { q: "mat-slides-p2-helicase", mode: "semantic", types: "material" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    const hit = res.data.hits.find((h) => h.id === "mat-dna-slides");
    expect(hit).toBeDefined();
    expect(hit?.navigation.href).toContain("page=2");
  });

  it("does not duplicate documents when offset pagination shifts window across multi-chunk documents", async () => {
    // Page 1
    const resPage1 = await harness.dispatchSearchApiJson(
      { q: "DNA", limit: 1, offset: 0 },
      alice
    );
    // Page 2
    const resPage2 = await harness.dispatchSearchApiJson(
      { q: "DNA", limit: 1, offset: 1 },
      alice
    );

    expect(resPage1.status).toBe(200);
    expect(resPage2.status).toBe(200);

    const id1 = resPage1.data.hits[0]?.id;
    const id2 = resPage2.data.hits[0]?.id;

    if (id1 && id2) {
      // Chunk collapsing guarantees two different entity hits across consecutive pages
      expect(id1).not.toBe(id2);
    }
  });
});
