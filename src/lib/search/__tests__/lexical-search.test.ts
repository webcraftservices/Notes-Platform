/**
 * src/lib/search/__tests__/lexical-search.test.ts
 *
 * Comprehensive 10-Suite Vitest Suite for PostgreSQL GIN Lexical Search:
 * Query normalization, weighted expression verification, multi-entity retrieval,
 * fail-closed tenancy filters, hierarchy breadcrumbs, and canonical navigation URLs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db }));

function getSqlString(sqlArg: unknown): string {
  if (Array.isArray(sqlArg)) {
    return sqlArg.join(" ");
  }
  if (sqlArg && typeof sqlArg === "object") {
    if ("sql" in sqlArg && typeof (sqlArg as { sql: unknown }).sql === "string") {
      return (sqlArg as { sql: string }).sql;
    }
    if ("strings" in sqlArg && Array.isArray((sqlArg as { strings: unknown[] }).strings)) {
      return (sqlArg as { strings: string[] }).strings.join(" ");
    }
  }
  return String(sqlArg ?? "");
}

import {
  normalizeSearchQuery,
  buildLexicalNavigationHref,
  executeLexicalSearch,
  type LexicalSearchParams,
  type SearchableEntityType,
} from "../lexical-search";
import type { UserSearchScope } from "../search-access";

describe("PostgreSQL GIN Lexical Search Engine", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const mockScope: UserSearchScope = {
    userId: "usr-42",
    personalWorkspaceId: "ws-personal",
    activeGroupIds: ["grp-1", "grp-2"],
  };

  // =========================================================================
  // Suite 1: Query Normalization
  // =========================================================================
  describe("Suite 1: Query Normalization", () => {
    it("1.1 trims leading/trailing whitespace and collapses internal multiple spaces", () => {
      expect(normalizeSearchQuery("   mitochondrial    ATP    synthase   ")).toBe(
        "mitochondrial ATP synthase"
      );
    });

    it("1.2 caps search query at 200 characters", () => {
      const longInput = "a".repeat(250);
      const normalized = normalizeSearchQuery(longInput);
      expect(normalized.length).toBe(200);
    });

    it("1.3 handles empty and falsy input gracefully", () => {
      expect(normalizeSearchQuery("")).toBe("");
      expect(normalizeSearchQuery("     ")).toBe("");
      // @ts-expect-error testing runtime falsy
      expect(normalizeSearchQuery(null)).toBe("");
      // @ts-expect-error testing runtime falsy
      expect(normalizeSearchQuery(undefined)).toBe("");
    });
  });

  // =========================================================================
  // Suite 2: FTS Syntax Safety & Short Query Early Return
  // =========================================================================
  describe("Suite 2: Query Length & Short Query Early Return", () => {
    it("2.1 returns empty array immediately if query is shorter than 2 characters", async () => {
      const res1 = await executeLexicalSearch({ query: "a", scope: mockScope });
      const res2 = await executeLexicalSearch({ query: "   ", scope: mockScope });
      expect(res1).toEqual([]);
      expect(res2).toEqual([]);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Suite 3: Index Expression Verbatim Check
  // =========================================================================
  describe("Suite 3: Index Expression Verbatim Check", () => {
    it("3.1 sends exact weighted tsvector expressions matching migration.sql for all 7 entities", async () => {
      db.$queryRaw.mockResolvedValue([]);

      await executeLexicalSearch({
        query: "biochemistry",
        scope: mockScope,
      });

      // 7 entities queried
      expect(db.$queryRaw).toHaveBeenCalledTimes(7);

      const executedSqls = db.$queryRaw.mock.calls.map((call) => getSqlString(call[0]));

      // Subject expression check
      expect(executedSqls.some((sql: string) =>
        sql.includes("setweight(to_tsvector('english', coalesce(s.\"name\", '')), 'A')") &&
        sql.includes("setweight(to_tsvector('english', coalesce(s.\"description\", '')), 'B')")
      )).toBe(true);

      // Chapter expression check
      expect(executedSqls.some((sql: string) =>
        sql.includes("setweight(to_tsvector('english', coalesce(c.\"name\", '')), 'A')") &&
        sql.includes("setweight(to_tsvector('english', coalesce(c.\"description\", '')), 'B')")
      )).toBe(true);

      // Topic expression check
      expect(executedSqls.some((sql: string) =>
        sql.includes("setweight(to_tsvector('english', coalesce(t.\"name\", '')), 'A')") &&
        sql.includes("setweight(to_tsvector('english', coalesce(t.\"description\", '')), 'B')")
      )).toBe(true);

      // Material expression check
      expect(executedSqls.some((sql: string) =>
        sql.includes("setweight(to_tsvector('english', coalesce(m.\"title\", '')), 'A')") &&
        sql.includes("setweight(to_tsvector('english', coalesce(m.\"originalFilename\", '')), 'B')") &&
        sql.includes("setweight(to_tsvector('english', coalesce(m.\"extractedText\", '')), 'C')")
      )).toBe(true);

      // Note expression check
      expect(executedSqls.some((sql: string) =>
        sql.includes("setweight(to_tsvector('english', coalesce(n.\"title\", '')), 'A')") &&
        sql.includes("setweight(to_tsvector('english', coalesce(n.\"plainText\", '')), 'B')")
      )).toBe(true);

      // Group expression check
      expect(executedSqls.some((sql: string) =>
        sql.includes("setweight(to_tsvector('english', coalesce(g.\"name\", '')), 'A')") &&
        sql.includes("setweight(to_tsvector('english', coalesce(g.\"description\", '')), 'B')")
      )).toBe(true);

      // FlashcardDeck + Card-level Flashcard (front 'B', back 'C') expression check (Phase 13 / LIM-10 resolved)
      expect(executedSqls.some((sql: string) =>
        sql.includes("setweight(to_tsvector('english', coalesce(fd.\"title\", '')), 'A')") &&
        sql.includes("setweight(to_tsvector('english', coalesce(fc.\"front\", '')), 'B')") &&
        sql.includes("setweight(to_tsvector('english', coalesce(fc.\"back\", '')), 'C')")
      )).toBe(true);
    });
  });

  // =========================================================================
  // Suite 4: Multi-Entity Type Coverage & Result Shaping
  // =========================================================================
  describe("Suite 4: Multi-Entity Type Coverage & Result Shaping", () => {
    it("4.1 executes across core entities and shapes RawLexicalHit correctly", async () => {
      db.$queryRaw.mockImplementation((sqlObj) => {
        const sql = getSqlString(sqlObj);
        if (sql.includes("'note'::text AS \"entityType\"")) {
          return Promise.resolve([
            {
              id: "note-1",
              entityType: "note",
              title: "Cell Division Notes",
              snippetSourceText: "Mitosis involves prophase, metaphase, anaphase, and telophase.",
              subjectId: "sub-1",
              subjectName: "Biology",
              chapterId: "ch-1",
              chapterName: "Cytology",
              topicId: "top-1",
              topicName: "Mitosis",
              groupId: null,
              groupName: null,
              rankScore: 0.85,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const hits = await executeLexicalSearch({
        query: "mitosis",
        scope: mockScope,
        types: ["note"],
      });

      expect(hits).toHaveLength(1);
      const hit = hits[0]!;
      expect(hit.id).toBe("note-1");
      expect(hit.entityType).toBe("note");
      expect(hit.title).toBe("Cell Division Notes");
      expect(hit.rankScore).toBe(0.85);
      expect(hit.hierarchy).toEqual({
        subjectId: "sub-1",
        subjectName: "Biology",
        chapterId: "ch-1",
        chapterName: "Cytology",
        topicId: "top-1",
        topicName: "Mitosis",
        groupId: undefined,
        groupName: undefined,
      });
      expect(hit.navigation?.href).toBe("/subjects/sub-1/chapters/ch-1/topics/top-1?tab=notes");
    });
  });

  // =========================================================================
  // Suite 5: Entity Type Filtering
  // =========================================================================
  describe("Suite 5: Entity Type Filtering", () => {
    it("5.1 executes only the requested entity queries when types filter is specified", async () => {
      db.$queryRaw.mockResolvedValue([]);

      await executeLexicalSearch({
        query: "calculus",
        scope: mockScope,
        types: ["material"],
      });

      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      const firstCall = db.$queryRaw.mock.calls[0];
      const sql = getSqlString(firstCall![0]);
      expect(sql).toContain("'material'::text AS \"entityType\"");
    });
  });

  // =========================================================================
  // Suite 6: Hierarchy Breadcrumb Population
  // =========================================================================
  describe("Suite 6: Hierarchy Breadcrumbs", () => {
    it("6.1 maps all parent breadcrumb fields accurately", async () => {
      db.$queryRaw.mockResolvedValue([
        {
          id: "mat-99",
          entityType: "material",
          title: "Mechanics Lab PDF",
          snippetSourceText: "Experimental procedure for measuring gravitational acceleration.",
          subjectId: "sub-phys",
          subjectName: "Physics",
          chapterId: "ch-kin",
          chapterName: "Kinematics",
          topicId: "top-grav",
          topicName: "Gravity",
          groupId: "grp-1",
          groupName: "Study Group A",
          rankScore: 0.92,
        },
      ]);

      const hits = await executeLexicalSearch({
        query: "gravity",
        scope: mockScope,
        types: ["material"],
      });

      const firstHit = hits[0]!;
      expect(firstHit.hierarchy).toEqual({
        subjectId: "sub-phys",
        subjectName: "Physics",
        chapterId: "ch-kin",
        chapterName: "Kinematics",
        topicId: "top-grav",
        topicName: "Gravity",
        groupId: "grp-1",
        groupName: "Study Group A",
      });
    });
  });

  // =========================================================================
  // Suite 7: Canonical Navigation URLs
  // =========================================================================
  describe("Suite 7: Navigation URL Generation", () => {
    it("7.1 correctly maps URLs for all entity types", () => {
      expect(
        buildLexicalNavigationHref("subject", "sub-1", {})
      ).toBe("/subjects/sub-1");

      expect(
        buildLexicalNavigationHref("chapter", "ch-1", { subjectId: "sub-1" })
      ).toBe("/subjects/sub-1/chapters/ch-1");

      expect(
        buildLexicalNavigationHref("topic", "top-1", {
          subjectId: "sub-1",
          chapterId: "ch-1",
        })
      ).toBe("/subjects/sub-1/chapters/ch-1/topics/top-1");

      expect(
        buildLexicalNavigationHref("note", "not-1", {
          subjectId: "sub-1",
          chapterId: "ch-1",
          topicId: "top-1",
        })
      ).toBe("/subjects/sub-1/chapters/ch-1/topics/top-1?tab=notes");

      expect(
        buildLexicalNavigationHref("note", "not-standalone", {})
      ).toBe("/notes/not-standalone");

      expect(
        buildLexicalNavigationHref("material", "mat-1", {})
      ).toBe("/materials/mat-1");

      expect(
        buildLexicalNavigationHref("group", "grp-1", {})
      ).toBe("/groups/grp-1");

      expect(
        buildLexicalNavigationHref("flashcard", "fc-1", {})
      ).toBe("/flashcards/fc-1");
    });
  });

  // =========================================================================
  // Suite 8: Fail-Closed Soft Deletion
  // =========================================================================
  describe("Suite 8: Fail-Closed Soft Deletion", () => {
    it("8.1 ensures all SQL queries enforce deletedAt IS NULL on entity and ancestors", async () => {
      db.$queryRaw.mockResolvedValue([]);

      await executeLexicalSearch({
        query: "quantum",
        scope: mockScope,
      });

      for (const call of db.$queryRaw.mock.calls) {
        const sql: string = getSqlString(call[0]);
        expect(sql).toContain('"deletedAt" IS NULL');
      }
    });
  });

  // =========================================================================
  // Suite 9: Tenancy Isolation & Unauthorized Group Filters
  // =========================================================================
  describe("Suite 9: Tenancy Isolation", () => {
    it("9.1 returns empty array immediately if unauthorized groupId requested", async () => {
      const hits = await executeLexicalSearch({
        query: "confidential",
        scope: mockScope,
        groupId: "forbidden-group-999",
      });

      expect(hits).toEqual([]);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it("9.2 allows searching when user has empty activeGroupIds without SQL errors", async () => {
      db.$queryRaw.mockResolvedValue([]);

      const emptyScope: UserSearchScope = {
        userId: "solo-user",
        personalWorkspaceId: "ws-solo",
        activeGroupIds: [],
      };

      const hits = await executeLexicalSearch({
        query: "solo notes",
        scope: emptyScope,
      });

      expect(hits).toEqual([]);
      // Group query was skipped because activeGroupIds is empty
      // Other 6 queries executed safely with 1 = 0 for group branches
      expect(db.$queryRaw).toHaveBeenCalledTimes(6);
      for (const call of db.$queryRaw.mock.calls) {
        const sql: string = getSqlString(call[0]);
        expect(sql).not.toContain("IN ()");
      }
    });
  });

  // =========================================================================
  // Suite 10: Deduplication & Ranking Order
  // =========================================================================
  describe("Suite 10: Deduplication & Ranking Order", () => {
    it("10.1 sorts hits strictly by rankScore DESC across all entity types", async () => {
      db.$queryRaw.mockImplementation((sqlObj) => {
        const sql: string = getSqlString(sqlObj);
        if (sql.includes("'subject'::text AS \"entityType\"")) {
          return Promise.resolve([
            {
              id: "sub-1",
              entityType: "subject",
              title: "Low relevance subject",
              snippetSourceText: "desc",
              rankScore: 0.12,
            },
          ]);
        }
        if (sql.includes("'note'::text AS \"entityType\"")) {
          return Promise.resolve([
            {
              id: "not-1",
              entityType: "note",
              title: "High relevance note",
              snippetSourceText: "desc",
              rankScore: 0.95,
            },
          ]);
        }
        if (sql.includes("'material'::text AS \"entityType\"")) {
          return Promise.resolve([
            {
              id: "mat-1",
              entityType: "material",
              title: "Mid relevance material",
              snippetSourceText: "desc",
              rankScore: 0.65,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const hits = await executeLexicalSearch({
        query: "relevance test",
        scope: mockScope,
      });

      expect(hits.map((h) => h.id)).toEqual(["not-1", "mat-1", "sub-1"]);
      expect(hits[0]?.rankScore).toBe(0.95);
      expect(hits[1]?.rankScore).toBe(0.65);
      expect(hits[2]?.rankScore).toBe(0.12);
    });
  });

  // =========================================================================
  // Suite 11: Flashcard Card-Level Front/Back Search (Phase 13 / LIM-10)
  // =========================================================================
  describe("Suite 11: Flashcard Card-Level Front/Back Search", () => {
    it("11.1 returns the parent FlashcardDeck with card front/back snippet when a card matches", async () => {
      db.$queryRaw.mockResolvedValue([
        {
          id: "deck-oxidative",
          entityType: "flashcard",
          title: "General Bio Deck",
          snippetSourceText:
            "What complex pumps protons across the inner mitochondrial membrane? — Complex I (NADH dehydrogenase)",
          subjectId: "sub-bio",
          subjectName: "Biology",
          chapterId: "ch-resp",
          chapterName: "Cellular Respiration",
          topicId: "top-etc",
          topicName: "Electron Transport Chain",
          groupId: null,
          groupName: null,
          rankScore: 0.78,
        },
      ]);

      const hits = await executeLexicalSearch({
        query: "NADH dehydrogenase",
        scope: mockScope,
        types: ["flashcard"],
      });

      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        id: "deck-oxidative",
        entityType: "flashcard",
        title: "General Bio Deck",
        snippetSourceText:
          "What complex pumps protons across the inner mitochondrial membrane? — Complex I (NADH dehydrogenase)",
        navigation: {
          href: "/flashcards/deck-oxidative",
        },
      });
    });
  });
});
