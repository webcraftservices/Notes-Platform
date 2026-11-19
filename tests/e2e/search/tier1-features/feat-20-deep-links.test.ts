/**
 * Tier 1 — Feature 20: Deep-Link Navigation Routing
 *
 * Verifies contextual deep-link generation across entity types:
 * - PDF materials route to `/materials/[id]?page=[pageNumber]`
 * - Audio materials route to `/materials/[id]?t=[seconds]`
 * - Notes route to `/topics/[topicId]?tab=notes&noteId=[noteId]`
 * - Subjects route to `/subjects/[id]`
 * - Chapters route to `/chapters/[id]`
 * - Topics route to `/topics/[id]`
 * - Study Groups route to `/groups/[id]`
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, SearchHit } from "../harness/contracts";

describe("Tier 1 — Feat 20: Deep-Link Navigation Routing", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };
  const bob = { id: "user-bob", email: "bob@example.com", name: "Bob Jones" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("generates PDF deep link with exact page parameter '?page=' from matching chunk", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "mat-slides-p2-helicase", mode: "semantic", types: "material" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    const hit = res.data.hits.find((h) => h.id === "mat-dna-slides");
    expect(hit).toBeDefined();
    expect(hit?.navigation.href).toBe("/materials/mat-dna-slides?page=2");
    expect(hit?.navigation.pageNumber).toBe(2);
  });

  it("generates Audio deep link with exact timestamp parameter '?t=' from matching chunk", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "mat-audio-seg-1", mode: "semantic", types: "material" },
      bob
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    const hit = res.data.hits.find((h) => h.id === "mat-chem-lecture-audio");
    expect(hit).toBeDefined();
    expect(hit?.navigation.href).toBe("/materials/mat-chem-lecture-audio?t=120");
    expect(hit?.navigation.timestampSeconds).toBe(120);
  });

  it("generates Note deep link routing to topic notes tab with noteId query parameter", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "helicase", types: "note" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    const hit = res.data.hits.find((h) => h.id === "note-dna-helicase");
    expect(hit).toBeDefined();
    expect(hit?.navigation.href).toBe(
      "/topics/topic-helicase?tab=notes&noteId=note-dna-helicase"
    );
  });

  it("generates Subject deep link routing to '/subjects/[subjectId]'", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Molecular Biology", types: "subject" },
      alice
    );

    expect(res.status).toBe(200);
    const hit = (res.data.hits as SearchHit[]).find((h: SearchHit) => h.id === "subj-alice-bio");
    expect(hit).toBeDefined();
    expect(hit?.navigation.href).toBe("/subjects/subj-alice-bio");
  });

  it("generates Chapter deep link routing to '/chapters/[chapterId]'", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "DNA Replication and Repair", types: "chapter" },
      alice
    );

    expect(res.status).toBe(200);
    const hit = (res.data.hits as SearchHit[]).find((h: SearchHit) => h.id === "chap-dna");
    expect(hit).toBeDefined();
    expect(hit?.navigation.href).toBe("/chapters/chap-dna");
  });

  it("generates Study Group deep link routing to '/groups/[groupId]'", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Biochemistry", types: "group" },
      alice
    );

    expect(res.status).toBe(200);
    const hit = (res.data.hits as SearchHit[]).find((h: SearchHit) => h.id === "group-1");
    expect(hit).toBeDefined();
    expect(hit?.navigation.href).toBe("/groups/group-1");
  });

  it("verifies all navigation URLs are relative paths starting with '/' to prevent open redirects", async () => {
    const res = await harness.dispatchSearchApiJson({ q: "DNA" }, alice);
    expect(res.status).toBe(200);

    for (const hit of res.data.hits) {
      expect(hit.navigation.href.startsWith("/")).toBe(true);
      expect(hit.navigation.href).not.toMatch(/^https?:\/\//i);
      expect(hit.navigation.href).not.toMatch(/^\/\//i); // Prevent protocol-relative URLs (//malicious.com)
    }
  });
});
