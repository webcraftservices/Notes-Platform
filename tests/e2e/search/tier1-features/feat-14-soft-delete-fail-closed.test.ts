/**
 * Tier 1 — Feature 14: Fail-Closed Hierarchy Soft Deletion
 *
 * Verifies that soft-deleted entities (deletedAt IS NOT NULL) and any child entities
 * under a soft-deleted ancestor (Subject -> Chapter -> Topic -> Note/Material) are
 * strictly excluded from all search retrieval channels (fail-closed security).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse } from "../harness/contracts";

describe("Tier 1 — Feat 14: Fail-Closed Hierarchy Soft Deletion", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("excludes soft-deleted Note entities even when query matches title and content exactly", async () => {
    // Seed data contains: "Deleted Helicase Experimental Draft" (id: "note-deleted", deletedAt set)
    const res = await harness.dispatchSearchApiJson(
      { q: "Deleted Helicase Experimental Draft", mode: "lexical", types: "note" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.some((h) => h.id === "note-deleted")).toBe(false);
  });

  it("excludes soft-deleted Material entities from all search results", async () => {
    // Seed data contains: "Deleted Outdated Replication Notes.pdf" (id: "mat-deleted", deletedAt set)
    const res = await harness.dispatchSearchApiJson(
      { q: "Deleted Outdated Replication Notes", mode: "lexical", types: "material" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.some((h) => h.id === "mat-deleted")).toBe(false);
  });

  it("fails closed on child Notes when the parent Subject is soft-deleted", async () => {
    const db = harness.store.createPrismaClientMock();

    // Soft-delete parent subject "subj-alice-bio"
    await db.subject.update({
      where: { id: "subj-alice-bio" },
      data: { deletedAt: new Date() },
    });

    // Query for notes that were under subj-alice-bio (e.g. note-dna-helicase)
    const res = await harness.dispatchSearchApiJson(
      { q: "helicase", mode: "hybrid", types: "note" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    // note-dna-helicase itself has deletedAt = null, but parent Subject is soft-deleted
    expect(res.data.hits.some((h) => h.id === "note-dna-helicase")).toBe(false);
    expect(res.data.counts.note).toBe(0);
  });

  it("fails closed on child Materials when the parent Chapter is soft-deleted", async () => {
    const db = harness.store.createPrismaClientMock();

    // Soft-delete parent chapter "chap-dna"
    await db.chapter.update({
      where: { id: "chap-dna" },
      data: { deletedAt: new Date() },
    });

    // Query for material under chap-dna (mat-dna-slides)
    const res = await harness.dispatchSearchApiJson(
      { q: "DNA Replication Fork Helicase", mode: "hybrid", types: "material" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.some((h) => h.id === "mat-dna-slides")).toBe(false);
    expect(res.data.counts.material).toBe(0);
  });

  it("fails closed on Notes when the intermediate Topic is soft-deleted", async () => {
    const db = harness.store.createPrismaClientMock();

    // Soft-delete topic "topic-helicase"
    await db.topic.update({
      where: { id: "topic-helicase" },
      data: { deletedAt: new Date() },
    });

    const res = await harness.dispatchSearchApiJson(
      { q: "helicase", mode: "hybrid", types: "note" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.some((h) => h.id === "note-dna-helicase")).toBe(false);
  });

  it("excludes soft-deleted Study Groups and all group-scoped content", async () => {
    // In seed fixtures, group-deleted has deletedAt set
    const res = await harness.dispatchSearchApiJson(
      { q: "Archived Medical", mode: "lexical", types: "group" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.some((h) => h.id === "group-deleted")).toBe(false);
    expect(res.data.counts.group).toBe(0);
  });
});
