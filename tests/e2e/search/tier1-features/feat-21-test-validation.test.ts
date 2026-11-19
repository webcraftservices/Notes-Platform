/**
 * Tier 1 — Feature 21: Comprehensive Test Validation
 *
 * Verifies test suite self-integrity, coverage of all 22 feature suites,
 * contract validators, fixture topology completeness, and test harness soundness.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  VALID_ENTITY_TYPES,
  VALID_SEARCH_MODES,
  validateSearchHit,
  validateSearchApiResponse,
} from "../harness/contracts";
import { getFreshFixtureData } from "../harness/fixtures";
import { SearchTestHarness } from "../harness/search-test-harness";

describe("Tier 1 — Feat 21: Comprehensive Test Validation", () => {
  const tier1Dir = path.resolve(process.cwd(), "tests/e2e/search/tier1-features");

  it("verifies all 22 Tier 1 feature test files exist on disk", () => {
    const expectedFiles = [
      "feat-01-core-lexical.test.ts",
      "feat-02-flashcard-scope.test.ts",
      "feat-03-quiz-exclusion.test.ts",
      "feat-04-text-normalization.test.ts",
      "feat-05-material-vector-reuse.test.ts",
      "feat-06-note-plain-text.test.ts",
      "feat-07-note-embedding-lifecycle.test.ts",
      "feat-08-hnsw-indexing.test.ts",
      "feat-09-gin-indexing.test.ts",
      "feat-10-rrf-ranking.test.ts",
      "feat-11-chunk-collapsing.test.ts",
      "feat-12-hierarchy-filtering.test.ts",
      "feat-13-prefiltered-authorization.test.ts",
      "feat-14-soft-delete-fail-closed.test.ts",
      "feat-15-leakage-prevention.test.ts",
      "feat-16-authenticated-api.test.ts",
      "feat-17-command-palette.test.ts",
      "feat-18-search-page.test.ts",
      "feat-19-contextual-snippets.test.ts",
      "feat-20-deep-links.test.ts",
      "feat-21-test-validation.test.ts",
      "feat-22-documentation-sync.test.ts",
    ];

    for (const filename of expectedFiles) {
      const fullPath = path.join(tier1Dir, filename);
      expect(fs.existsSync(fullPath), `Expected test file ${filename} to exist`).toBe(true);
    }
  });

  it("verifies each Tier 1 test file defines at least 5 independent test cases", () => {
    const files = fs.readdirSync(tier1Dir).filter((f) => f.endsWith(".test.ts"));
    expect(files.length).toBe(22);

    for (const file of files) {
      const content = fs.readFileSync(path.join(tier1Dir, file), "utf-8");
      // Count test occurrences (it( or test()
      const testMatches = content.match(/(?:it|test)\s*\(\s*["'`]/g) || [];
      expect(
        testMatches.length,
        `File ${file} must have at least 5 tests, found ${testMatches.length}`
      ).toBeGreaterThanOrEqual(5);
    }
  });

  it("validates runtime contract guards against the Project interface definitions", () => {
    expect(VALID_ENTITY_TYPES).toEqual([
      "subject",
      "chapter",
      "topic",
      "material",
      "note",
      "group",
      "flashcard",
    ]);

    expect(VALID_SEARCH_MODES).toEqual(["hybrid", "lexical", "semantic"]);

    // Test rejection of empty / null payloads
    expect(validateSearchHit(null).valid).toBe(false);
    expect(validateSearchApiResponse(null).valid).toBe(false);
  });

  it("verifies fixture data completeness covering multi-tenant users, hierarchy, chunks, and soft-delete", () => {
    const fixtures = getFreshFixtureData();

    expect(fixtures.users.length).toBeGreaterThanOrEqual(3);
    expect(fixtures.workspaces.length).toBeGreaterThanOrEqual(3);
    expect(fixtures.groups.length).toBeGreaterThanOrEqual(2);
    expect(fixtures.subjects.length).toBeGreaterThanOrEqual(4);
    expect(fixtures.chapters.length).toBeGreaterThanOrEqual(4);
    expect(fixtures.topics.length).toBeGreaterThanOrEqual(4);
    expect(fixtures.notes.length).toBeGreaterThanOrEqual(3);
    expect(fixtures.noteChunks.length).toBeGreaterThanOrEqual(4);
    expect(fixtures.materials.length).toBeGreaterThanOrEqual(3);
    expect(fixtures.materialChunks.length).toBeGreaterThanOrEqual(4);
    expect(fixtures.flashcardDecks.length).toBeGreaterThanOrEqual(2);
    expect(fixtures.quizzes.length).toBeGreaterThanOrEqual(1);

    // Verify presence of soft-deleted records for fail-closed verification
    expect(fixtures.subjects.some((s) => s.deletedAt !== null)).toBe(true);
    expect(fixtures.chapters.some((c) => c.deletedAt !== null)).toBe(true);
    expect(fixtures.topics.some((t) => t.deletedAt !== null)).toBe(true);
    expect(fixtures.notes.some((n) => n.deletedAt !== null)).toBe(true);
    expect(fixtures.materials.some((m) => m.deletedAt !== null)).toBe(true);
    expect(fixtures.groups.some((g) => g.deletedAt !== null)).toBe(true);
  });

  it("verifies SearchTestHarness clean reset and auth context switching", () => {
    const harness = new SearchTestHarness();
    harness.reset();

    expect(harness.getAuthUser()?.id).toBe("user-alice");

    harness.setAuthUser({ id: "user-bob", email: "bob@example.com", name: "Bob Jones" });
    expect(harness.getAuthUser()?.id).toBe("user-bob");

    harness.setAuthUser(null);
    expect(harness.getAuthUser()).toBeNull();

    harness.reset();
    expect(harness.getAuthUser()?.id).toBe("user-alice");
  });

  it("verifies MockDbStore supports in-memory Prisma transactions and foreign keys", async () => {
    const harness = new SearchTestHarness();
    harness.reset();
    const db = harness.store.createPrismaClientMock();

    const txResult = await db.$transaction(async (tx: any) => {
      const subject = await tx.subject.findUnique({ where: { id: "subj-alice-bio" } });
      const chapters = await tx.chapter.findMany({ where: { subjectId: "subj-alice-bio" } });
      return { subject, chapterCount: chapters.length };
    });

    expect(txResult.subject).not.toBeNull();
    expect(txResult.chapterCount).toBeGreaterThanOrEqual(2);
  });
});
