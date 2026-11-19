/**
 * Tier 1 — Feature 12: Hierarchy & Entity Filtering
 *
 * Verifies scoped search queries with entity type filtering (`types`),
 * parent Subject scoping (`subjectId`), Chapter scoping (`chapterId`),
 * Topic scoping (`topicId`), and Study Group scoping (`groupId`).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse } from "../harness/contracts";

describe("Tier 1 — Feat 12: Hierarchy & Entity Filtering", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };
  const bob = { id: "user-bob", email: "bob@example.com", name: "Bob Jones" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("filters search results strictly to specified entity types", async () => {
    // Search for "helicase" with types=note only
    const resNotesOnly = await harness.dispatchSearchApiJson(
      { q: "helicase", types: "note" },
      alice
    );

    expect(resNotesOnly.status).toBe(200);
    assertSearchApiResponse(resNotesOnly.data);
    for (const hit of resNotesOnly.data.hits) {
      expect(hit.entityType).toBe("note");
    }
    expect(resNotesOnly.data.hits.some((h) => h.entityType === "material")).toBe(false);

    // Search with types=material only
    const resMatOnly = await harness.dispatchSearchApiJson(
      { q: "helicase", types: "material" },
      alice
    );
    expect(resMatOnly.status).toBe(200);
    assertSearchApiResponse(resMatOnly.data);
    for (const hit of resMatOnly.data.hits) {
      expect(hit.entityType).toBe("material");
    }
  });

  it("scopes results strictly to a specific Subject and its descendants via subjectId", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "replication", subjectId: "subj-alice-bio" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    for (const hit of res.data.hits) {
      expect(hit.hierarchy.subjectId).toBe("subj-alice-bio");
    }
  });

  it("scopes results strictly to a specific Chapter and its descendants via chapterId", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "replication", chapterId: "chap-dna" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    for (const hit of res.data.hits) {
      expect(hit.hierarchy.chapterId).toBe("chap-dna");
      expect(hit.hierarchy.subjectId).toBe("subj-alice-bio");
    }
  });

  it("scopes results strictly to a specific Topic via topicId", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "helicase", topicId: "topic-helicase" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    for (const hit of res.data.hits) {
      expect(hit.hierarchy.topicId).toBe("topic-helicase");
      expect(hit.hierarchy.chapterId).toBe("chap-dna");
    }
  });

  it("scopes results strictly to a specific Study Group via groupId", async () => {
    // Bob searches group-1 for benzene
    const res = await harness.dispatchSearchApiJson(
      { q: "benzene", groupId: "group-1" },
      bob
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    for (const hit of res.data.hits) {
      expect(hit.hierarchy.groupId).toBe("group-1");
    }
  });

  it("combines entity type filter and hierarchy filters conjunctively", async () => {
    // In topic-helicase, we have both notes and materials
    // Filter specifically for material in topic-helicase
    const res = await harness.dispatchSearchApiJson(
      { q: "helicase", types: "material", topicId: "topic-helicase" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    for (const hit of res.data.hits) {
      expect(hit.entityType).toBe("material");
      expect(hit.hierarchy.topicId).toBe("topic-helicase");
    }
    expect(res.data.hits.some((h) => h.entityType === "note")).toBe(false);
  });
});
