/**
 * Tier 1 — Feature 18: Dedicated /search Experience
 *
 * Verifies full /search page facets, query parameter synchronization,
 * loading skeleton states, empty states, and entity-specific count indicators.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, VALID_ENTITY_TYPES, SearchHit } from "../harness/contracts";

describe("Tier 1 — Feat 18: Dedicated /search Experience", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("synchronizes query parameters from URL into search API request", async () => {
    const url = new URL("/search?q=helicase&mode=hybrid&types=note,material&limit=10", "https://example.test");
    const q = url.searchParams.get("q") ?? "";
    const mode = url.searchParams.get("mode") ?? "hybrid";
    const types = url.searchParams.get("types") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 20);

    const res = await harness.dispatchSearchApiJson({ q, mode, types, limit }, alice);
    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.query).toBe("helicase");
    expect(res.data.limit).toBe(10);
    expect(res.data.hits.every((h) => h.entityType === "note" || h.entityType === "material")).toBe(true);
  });

  it("calculates facet counts across all approved entity categories", async () => {
    const res = await harness.dispatchSearchApiJson({ q: "DNA" }, alice);

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    // Counts object must include counts for each valid entity type
    for (const entityType of VALID_ENTITY_TYPES) {
      expect(res.data.counts[entityType]).toBeDefined();
      expect(typeof res.data.counts[entityType]).toBe("number");
      expect(res.data.counts[entityType]).toBeGreaterThanOrEqual(0);
    }
    // "quiz" must never be present in facets
    expect(res.data.counts["quiz"]).toBeUndefined();
  });

  it("provides clean empty state metadata when query produces zero matches", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "nonexistent_super_rare_query_term_12345", mode: "lexical" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.total).toBe(0);
    expect(res.data.hits).toHaveLength(0);

    for (const entityType of VALID_ENTITY_TYPES) {
      expect(res.data.counts[entityType]).toBe(0);
    }
  });

  it("supports paginated browsing with limit and offset across multiple pages", async () => {
    const pageSize = 1;

    // Fetch page 1
    const page1 = await harness.dispatchSearchApiJson(
      { q: "DNA", limit: pageSize, offset: 0 },
      alice
    );
    expect(page1.status).toBe(200);
    assertSearchApiResponse(page1.data);
    expect(page1.data.hits.length).toBeLessThanOrEqual(pageSize);

    // Fetch page 2
    const page2 = await harness.dispatchSearchApiJson(
      { q: "DNA", limit: pageSize, offset: 1 },
      alice
    );
    expect(page2.status).toBe(200);
    assertSearchApiResponse(page2.data);
    expect(page2.data.offset).toBe(1);

    const hit1 = page1.data.hits[0] as SearchHit | undefined;
    const hit2 = page2.data.hits[0] as SearchHit | undefined;
    if (hit1 && hit2) {
      expect(hit1.id).not.toBe(hit2.id);
    }
  });

  it("verifies facet filtering toggles only requested entity types while preserving query context", async () => {
    const resAll = await harness.dispatchSearchApiJson({ q: "DNA" }, alice);
    expect(resAll.status).toBe(200);
    const totalAll = resAll.data.total;

    // Filter to only subjects
    const resSubj = await harness.dispatchSearchApiJson({ q: "DNA", types: "subject" }, alice);
    expect(resSubj.status).toBe(200);
    expect((resSubj.data.hits as SearchHit[]).every((h: SearchHit) => h.entityType === "subject")).toBe(true);

    // Filter to only notes
    const resNotes = await harness.dispatchSearchApiJson({ q: "DNA", types: "note" }, alice);
    expect(resNotes.status).toBe(200);
    expect((resNotes.data.hits as SearchHit[]).every((h: SearchHit) => h.entityType === "note")).toBe(true);

    expect(totalAll).toBeGreaterThanOrEqual(resSubj.data.total);
    expect(totalAll).toBeGreaterThanOrEqual(resNotes.data.total);
  });

  it("ensures search hits contain complete hierarchy breadcrumbs for rich page rendering", async () => {
    const res = await harness.dispatchSearchApiJson({ q: "helicase", types: "note" }, alice);
    expect(res.status).toBe(200);

    const hit = (res.data.hits as SearchHit[]).find((h: SearchHit) => h.id === "note-dna-helicase");
    expect(hit).toBeDefined();
    // Breadcrumbs require subject, chapter, and topic labels
    expect(hit?.hierarchy.subjectName).toBe("Molecular Biology");
    expect(hit?.hierarchy.chapterName).toBe("DNA Replication and Repair");
    expect(hit?.hierarchy.topicName).toBe("DNA Helicase and Polymerase Mechanisms");
  });
});
