/**
 * Tier 1 — Feature 3: Quiz Scope Formal Decision
 *
 * Verifies the explicit architectural exclusion of Quizzes from Zenote Phase 12 search:
 * - Queries matching quiz titles never return Quiz entities
 * - Passing "quiz" as an entity type filter results in 400 Bad Request
 * - Quiz question prompts and explanations are excluded from retrieval
 * - Counts map strictly excludes "quiz"
 * - Exclusion holds across hybrid, lexical, and semantic modes
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, VALID_ENTITY_TYPES } from "../harness/contracts";

describe("Tier 1 — Feat 03: Quiz Scope Formal Decision & Exclusion", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("never returns Quiz entities in search hits even when query exactly matches a Quiz title", async () => {
    // Seed data contains: "DNA Replication Mastery Quiz" (id: "quiz-dna-review")
    const res = await harness.dispatchSearchApiJson(
      { q: "DNA Replication Mastery Quiz", mode: "lexical" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    // Hits must never include the quiz id or entityType quiz
    expect(res.data.hits.some((h) => h.id === "quiz-dna-review")).toBe(false);
    expect(res.data.hits.some((h) => (h.entityType as string) === "quiz")).toBe(false);
  });

  it("rejects 'quiz' in the types parameter with a 400 Bad Request error", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Replication", types: "quiz" },
      alice
    );

    expect(res.status).toBe(400);
    expect(res.data.error).toBeDefined();
    expect(res.data.error.toLowerCase()).toContain("quiz");
  });

  it("rejects compound types filter containing 'quiz' alongside valid types", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Replication", types: "note,quiz,subject" },
      alice
    );

    expect(res.status).toBe(400);
    expect(res.data.error).toBeDefined();
    expect(res.data.error.toLowerCase()).toContain("quiz");
  });

  it("ensures response counts map only includes approved core entity types and never 'quiz'", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Replication" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    const countKeys = Object.keys(res.data.counts);
    expect(countKeys).not.toContain("quiz");

    // Must match VALID_ENTITY_TYPES exactly
    for (const validKey of VALID_ENTITY_TYPES) {
      expect(typeof res.data.counts[validKey]).toBe("number");
    }
  });

  it("excludes quiz questions and question explanations from search retrieval", async () => {
    // Seed question prompt: "Which enzyme is primarily responsible for unzipping double-stranded DNA?"
    // Explanation: "DNA helicase unzips DNA using ATP hydrolysis."
    const res = await harness.dispatchSearchApiJson(
      { q: "unzipping double-stranded DNA using ATP hydrolysis", mode: "lexical" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    // No hit should refer to quiz-dna-review or qq-dna-1
    expect(res.data.hits.some((h) => h.id === "quiz-dna-review" || h.id === "qq-dna-1")).toBe(false);
  });

  it("consistently excludes quizzes across hybrid, lexical, and semantic modes", async () => {
    const modes = ["hybrid", "lexical", "semantic"] as const;

    for (const mode of modes) {
      const res = await harness.dispatchSearchApiJson(
        { q: "Mastery Quiz", mode },
        alice
      );

      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits.some((h) => (h.entityType as string) === "quiz")).toBe(false);
      expect(res.data.hits.some((h) => h.id === "quiz-dna-review")).toBe(false);
    }
  });
});
