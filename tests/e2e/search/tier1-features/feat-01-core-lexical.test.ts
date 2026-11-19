/**
 * Tier 1 — Feature 1: Core Entity Lexical Search
 *
 * Verifies lexical full-text search matching across all 6 approved core entities:
 * 1. Subjects (name & description)
 * 2. Chapters (name & description)
 * 3. Topics (name & description)
 * 4. Materials (title & extracted text)
 * 5. Notes (title & plain text)
 * 6. StudyGroups (name & description)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, isSearchHit } from "../harness/contracts";

describe("Tier 1 — Feat 01: Core Entity Lexical Search", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };
  const bob = { id: "user-bob", email: "bob@example.com", name: "Bob Jones" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("retrieves Subject entities matching lexical query on name or description", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Molecular Biology", mode: "lexical", types: "subject" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    const hit = res.data.hits.find((h) => h.id === "subj-alice-bio");
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe("subject");
    expect(hit?.title).toBe("Molecular Biology");
    expect(hit?.hierarchy.subjectId).toBe("subj-alice-bio");
    expect(hit?.hierarchy.subjectName).toBe("Molecular Biology");
    expect(hit?.navigation.href).toBe("/subjects/subj-alice-bio");
    expect(res.data.counts.subject).toBeGreaterThanOrEqual(1);
  });

  it("retrieves Chapter entities matching lexical query on name or description", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "DNA Replication Repair", mode: "lexical", types: "chapter" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    const hit = res.data.hits.find((h) => h.id === "chap-dna");
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe("chapter");
    expect(hit?.title).toBe("DNA Replication and Repair");
    expect(hit?.hierarchy.subjectId).toBe("subj-alice-bio");
    expect(hit?.hierarchy.chapterId).toBe("chap-dna");
    expect(hit?.navigation.href).toBe("/chapters/chap-dna");
    expect(res.data.counts.chapter).toBeGreaterThanOrEqual(1);
  });

  it("retrieves Topic entities matching lexical query on name or description", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Helicase Polymerase Mechanisms", mode: "lexical", types: "topic" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    const hit = res.data.hits.find((h) => h.id === "topic-helicase");
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe("topic");
    expect(hit?.title).toBe("DNA Helicase and Polymerase Mechanisms");
    expect(hit?.hierarchy.chapterId).toBe("chap-dna");
    expect(hit?.hierarchy.topicId).toBe("topic-helicase");
    expect(hit?.navigation.href).toBe("/topics/topic-helicase");
    expect(res.data.counts.topic).toBeGreaterThanOrEqual(1);
  });

  it("retrieves Material entities matching lexical query on title or extractedText", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Replication Fork Helicase Structure", mode: "lexical", types: "material" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    const hit = res.data.hits.find((h) => h.id === "mat-dna-slides");
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe("material");
    expect(hit?.title).toContain("Lecture 04: DNA Replication Fork");
    expect(hit?.navigation.href).toContain("/materials/mat-dna-slides");
    expect(res.data.counts.material).toBeGreaterThanOrEqual(1);
  });

  it("retrieves Note entities matching lexical query on title or plainText", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "hydrogen bonds between base pairs", mode: "lexical", types: "note" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    const hit = res.data.hits.find((h) => h.id === "note-dna-helicase");
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe("note");
    expect(hit?.title).toBe("DNA Helicase & Polymerase III Machinery");
    expect(hit?.snippet).toContain("hydrogen bonds");
    expect(hit?.navigation.href).toContain("tab=notes");
    expect(res.data.counts.note).toBeGreaterThanOrEqual(1);
  });

  it("retrieves StudyGroup entities matching lexical query on name or description for group members", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Biochemistry molecular biology", mode: "lexical", types: "group" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    const hit = res.data.hits.find((h) => h.id === "group-1");
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe("group");
    expect(hit?.title).toBe("Biochemistry Study Group");
    expect(hit?.hierarchy.groupId).toBe("group-1");
    expect(hit?.navigation.href).toBe("/groups/group-1");
    expect(res.data.counts.group).toBeGreaterThanOrEqual(1);
  });

  it("performs multi-entity lexical search across all core entities in a single unified query", async () => {
    // Both note and material mention "helicase"
    const res = await harness.dispatchSearchApiJson(
      { q: "helicase", mode: "lexical" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    const hitTypes = new Set(res.data.hits.map((h) => h.entityType));
    expect(hitTypes.has("note")).toBe(true);
    expect(hitTypes.has("material")).toBe(true);
    expect(res.data.total).toBeGreaterThanOrEqual(2);
    for (const hit of res.data.hits) {
      expect(isSearchHit(hit)).toBe(true);
      expect(hit.matchType).toBe("lexical");
    }
  });
});
