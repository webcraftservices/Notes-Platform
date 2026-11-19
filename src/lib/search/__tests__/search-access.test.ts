/**
 * src/lib/search/__tests__/search-access.test.ts
 *
 * Comprehensive 10-Tier Vitest Suite for Search Access Control, Tenancy Scopes,
 * Fail-Closed Ancestor Checks, and Prisma / SQL Predicate Builders.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  groupMember: { findMany: vi.fn() },
}));

const access = vi.hoisted(() => ({
  getPrimaryWorkspace: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/access", () => ({ getPrimaryWorkspace: access.getPrimaryWorkspace }));

import {
  resolveUserSearchScope,
  buildSubjectWhere,
  buildChapterWhere,
  buildTopicWhere,
  buildNoteWhere,
  buildMaterialWhere,
  buildGroupWhere,
  buildFlashcardDeckWhere,
  buildSubjectSqlWhere,
  buildChapterSqlWhere,
  buildTopicSqlWhere,
  buildNoteSqlWhere,
  buildMaterialSqlWhere,
  buildGroupSqlWhere,
  buildFlashcardDeckSqlWhere,
  type UserSearchScope,
} from "../search-access";

describe("Search Access Control & Tenancy Predicates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const mockScope: UserSearchScope = {
    userId: "user-123",
    personalWorkspaceId: "ws-personal",
    activeGroupIds: ["group-alpha", "group-beta"],
  };

  const emptyGroupScope: UserSearchScope = {
    userId: "user-isolated",
    personalWorkspaceId: "ws-isolated",
    activeGroupIds: [],
  };

  // =========================================================================
  // Tier 1: Scope Resolution
  // =========================================================================
  describe("Tier 1: Scope Resolution", () => {
    it("1.1 resolves primary workspace and active non-deleted group memberships", async () => {
      access.getPrimaryWorkspace.mockResolvedValue({ id: "ws-personal", name: "Personal" });
      db.groupMember.findMany.mockResolvedValue([
        { groupId: "group-alpha" },
        { groupId: "group-beta" },
      ]);

      const scope = await resolveUserSearchScope("user-123");

      expect(scope).toEqual({
        userId: "user-123",
        personalWorkspaceId: "ws-personal",
        activeGroupIds: ["group-alpha", "group-beta"],
      });
      expect(access.getPrimaryWorkspace).toHaveBeenCalledWith("user-123");
      expect(db.groupMember.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          group: { deletedAt: null },
        },
        select: { groupId: true },
      });
    });

    it("1.2 queries strictly non-deleted groups (group: { deletedAt: null })", async () => {
      access.getPrimaryWorkspace.mockResolvedValue({ id: "ws-1" });
      db.groupMember.findMany.mockResolvedValue([]);

      await resolveUserSearchScope("user-456");

      const callArgs = db.groupMember.findMany.mock.calls[0]?.[0];
      expect(callArgs?.where?.group).toEqual({ deletedAt: null });
    });

    it("1.3 handles user with zero groups without throwing and returns empty array", async () => {
      access.getPrimaryWorkspace.mockResolvedValue({ id: "ws-empty" });
      db.groupMember.findMany.mockResolvedValue([]);

      const scope = await resolveUserSearchScope("user-nogroups");
      expect(scope.activeGroupIds).toEqual([]);
      expect(scope.personalWorkspaceId).toBe("ws-empty");
    });
  });

  // =========================================================================
  // Tier 2: Subject Predicates
  // =========================================================================
  describe("Tier 2: Subject Predicates", () => {
    it("2.1 builds Prisma WHERE matching personal workspace or active groups", () => {
      const where = buildSubjectWhere(mockScope);
      expect(where).toMatchObject({
        AND: [
          { deletedAt: null },
          {
            OR: [
              { workspaceId: "ws-personal" },
              { groupId: { in: ["group-alpha", "group-beta"] } },
            ],
          },
        ],
      });
    });

    it("2.2 builds SQL WHERE matching personal workspace or active groups", () => {
      const sqlWhere = buildSubjectSqlWhere(mockScope);
      const sqlStr = sqlWhere.sql;
      expect(sqlStr).toContain('s."deletedAt" IS NULL');
      expect(sqlStr).toContain('s."workspaceId" =');
      expect(sqlStr).toContain('s."groupId" IN (');
      expect(sqlWhere.values).toContain("ws-personal");
      expect(sqlWhere.values).toContain("group-alpha");
      expect(sqlWhere.values).toContain("group-beta");
    });

    it("2.3 enforces fail-closed when chapterId or topicId passed to Subject filter", () => {
      const wherePrisma = buildSubjectWhere(mockScope, { chapterId: "c-1" });
      expect(wherePrisma).toEqual({ id: "impossible-id-fail-closed" });

      const whereSql = buildSubjectSqlWhere(mockScope, { topicId: "t-1" });
      expect(whereSql.sql).toBe("1 = 0");
    });
  });

  // =========================================================================
  // Tier 3: Chapter Predicates
  // =========================================================================
  describe("Tier 3: Chapter Predicates", () => {
    it("3.1 checks parent subject soft-deletion in Prisma WHERE", () => {
      const where = buildChapterWhere(mockScope);
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { deletedAt: null },
          { subject: { deletedAt: null } },
        ])
      );
    });

    it("3.2 checks parent subject soft-deletion and join in SQL WHERE", () => {
      const sqlWhere = buildChapterSqlWhere(mockScope);
      const sqlStr = sqlWhere.sql;
      expect(sqlStr).toContain('c."deletedAt" IS NULL');
      expect(sqlStr).toContain("s.id IS NOT NULL");
      expect(sqlStr).toContain('s."deletedAt" IS NULL');
    });

    it("3.3 restricts by subjectId when provided", () => {
      const wherePrisma = buildChapterWhere(mockScope, { subjectId: "sub-100" });
      expect(wherePrisma.AND).toEqual(
        expect.arrayContaining([{ subjectId: "sub-100" }])
      );

      const whereSql = buildChapterSqlWhere(mockScope, { subjectId: "sub-100" });
      expect(whereSql.sql).toContain('c."subjectId" =');
      expect(whereSql.values).toContain("sub-100");
    });
  });

  // =========================================================================
  // Tier 4: Topic Predicates
  // =========================================================================
  describe("Tier 4: Topic Predicates", () => {
    it("4.1 enforces ancestor cascade (topic, chapter, subject deletedAt IS NULL)", () => {
      const where = buildTopicWhere(mockScope);
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { deletedAt: null },
          { chapter: { deletedAt: null, subject: { deletedAt: null } } },
        ])
      );

      const sqlWhere = buildTopicSqlWhere(mockScope);
      const sqlStr = sqlWhere.sql;
      expect(sqlStr).toContain('t."deletedAt" IS NULL');
      expect(sqlStr).toContain('c."deletedAt" IS NULL');
      expect(sqlStr).toContain('s."deletedAt" IS NULL');
    });
  });

  // =========================================================================
  // Tier 5: Note Predicates
  // =========================================================================
  describe("Tier 5: Note Predicates", () => {
    it("5.1 permits topic notes under active workspace/group, and standalone notes for author only", () => {
      const where = buildNoteWhere(mockScope);
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { deletedAt: null },
          {
            OR: [
              expect.objectContaining({
                topicId: { not: null },
                topic: expect.objectContaining({
                  deletedAt: null,
                  chapter: expect.objectContaining({
                    deletedAt: null,
                    subject: expect.objectContaining({
                      deletedAt: null,
                    }),
                  }),
                }),
              }),
              {
                topicId: null,
                authorId: "user-123",
              },
            ],
          },
        ])
      );
    });

    it("5.2 constructs fail-closed SQL with ancestor soft-delete checks", () => {
      const sqlWhere = buildNoteSqlWhere(mockScope);
      const sqlStr = sqlWhere.sql;
      expect(sqlStr).toContain('n."deletedAt" IS NULL');
      expect(sqlStr).toContain('t."deletedAt" IS NULL');
      expect(sqlStr).toContain('c."deletedAt" IS NULL');
      expect(sqlStr).toContain('s."deletedAt" IS NULL');
      expect(sqlStr).toContain('n."authorId" =');
      expect(sqlWhere.values).toContain("user-123");
    });
  });

  // =========================================================================
  // Tier 6: Material Predicates
  // =========================================================================
  describe("Tier 6: Material Predicates", () => {
    it("6.1 enforces parent hierarchy soft-deletion and group vs workspace/owner isolation in Prisma", () => {
      const where = buildMaterialWhere(mockScope);
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { deletedAt: null },
          { OR: [{ subjectId: null }, { subject: { deletedAt: null } }] },
          { OR: [{ chapterId: null }, { chapter: { deletedAt: null } }] },
          { OR: [{ topicId: null }, { topic: { deletedAt: null } }] },
        ])
      );
    });

    it("6.2 enforces group vs personal ownership in SQL", () => {
      const sqlWhere = buildMaterialSqlWhere(mockScope);
      const sqlStr = sqlWhere.sql;
      expect(sqlStr).toContain('m."deletedAt" IS NULL');
      expect(sqlStr).toContain('m."groupId" IS NOT NULL AND m."groupId" IN (');
      expect(sqlStr).toContain('m."workspaceId" =');
      expect(sqlStr).toContain('m."ownerId" =');
    });
  });

  // =========================================================================
  // Tier 7: StudyGroup Predicates
  // =========================================================================
  describe("Tier 7: StudyGroup Predicates", () => {
    it("7.1 restricts to activeGroupIds and checks deletedAt IS NULL", () => {
      const where = buildGroupWhere(mockScope);
      expect(where).toEqual({
        deletedAt: null,
        id: { in: ["group-alpha", "group-beta"] },
      });

      const sqlWhere = buildGroupSqlWhere(mockScope);
      expect(sqlWhere.sql).toContain('g."deletedAt" IS NULL');
      expect(sqlWhere.sql).toContain("g.id IN (");
      expect(sqlWhere.values).toContain("group-alpha");
      expect(sqlWhere.values).toContain("group-beta");
    });

    it("7.2 fails closed when user belongs to zero groups", () => {
      const where = buildGroupWhere(emptyGroupScope);
      expect(where).toEqual({ id: "impossible-id-fail-closed" });

      const sqlWhere = buildGroupSqlWhere(emptyGroupScope);
      expect(sqlWhere.sql).toBe("1 = 0");
    });

    it("7.3 fails closed when hierarchy filters (subjectId/chapterId/topicId) are passed to group query", () => {
      expect(buildGroupWhere(mockScope, { subjectId: "sub-1" })).toEqual({
        id: "impossible-id-fail-closed",
      });
      expect(buildGroupSqlWhere(mockScope, { subjectId: "sub-1" }).sql).toBe("1 = 0");
    });
  });

  // =========================================================================
  // Tier 8: FlashcardDeck Predicates
  // =========================================================================
  describe("Tier 8: FlashcardDeck Predicates", () => {
    it("8.1 checks ancestor hierarchy soft-deletion (since deck table lacks deletedAt)", () => {
      const where = buildFlashcardDeckWhere(mockScope);
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { OR: [{ subjectId: null }, { subject: { deletedAt: null } }] },
          { OR: [{ chapterId: null }, { chapter: { deletedAt: null } }] },
          { OR: [{ topicId: null }, { topic: { deletedAt: null } }] },
        ])
      );

      const sqlWhere = buildFlashcardDeckSqlWhere(mockScope);
      const sqlStr = sqlWhere.sql;
      expect(sqlStr).toContain('s."deletedAt" IS NULL');
      expect(sqlStr).toContain('c."deletedAt" IS NULL');
      expect(sqlStr).toContain('t."deletedAt" IS NULL');
    });
  });

  // =========================================================================
  // Tier 9: Hierarchy Filter Overrides
  // =========================================================================
  describe("Tier 9: Hierarchy Filter Overrides", () => {
    it("9.1 allows authorized groupId filter", () => {
      const where = buildSubjectWhere(mockScope, { groupId: "group-alpha" });
      expect(where.AND).toEqual(
        expect.arrayContaining([{ groupId: "group-alpha" }])
      );

      const sqlWhere = buildSubjectSqlWhere(mockScope, { groupId: "group-alpha" });
      expect(sqlWhere.sql).toContain('s."groupId" =');
      expect(sqlWhere.values).toContain("group-alpha");
    });

    it("9.2 rejects unauthorized groupId filter with fail-closed condition", () => {
      const where = buildSubjectWhere(mockScope, { groupId: "group-forbidden" });
      expect(where).toEqual({ id: "impossible-id-fail-closed" });

      const sqlWhere = buildSubjectSqlWhere(mockScope, { groupId: "group-forbidden" });
      expect(sqlWhere.sql).toBe("1 = 0");
    });
  });

  // =========================================================================
  // Tier 10: Empty Group Safety (Zero Crashes on Prisma.join([]))
  // =========================================================================
  describe("Tier 10: Empty Group Safety", () => {
    it("10.1 builds valid SQL without calling Prisma.join([]) when activeGroupIds is empty", () => {
      expect(() => {
        const sSql = buildSubjectSqlWhere(emptyGroupScope);
        expect(sSql.sql).not.toContain("IN ()");
        expect(sSql.sql).toContain('s."workspaceId" =');

        const cSql = buildChapterSqlWhere(emptyGroupScope);
        expect(cSql.sql).not.toContain("IN ()");

        const tSql = buildTopicSqlWhere(emptyGroupScope);
        expect(tSql.sql).not.toContain("IN ()");

        const nSql = buildNoteSqlWhere(emptyGroupScope);
        expect(nSql.sql).not.toContain("IN ()");

        const mSql = buildMaterialSqlWhere(emptyGroupScope);
        expect(mSql.sql).not.toContain("IN ()");

        const gSql = buildGroupSqlWhere(emptyGroupScope);
        expect(gSql.sql).toBe("1 = 0");

        const fdSql = buildFlashcardDeckSqlWhere(emptyGroupScope);
        expect(fdSql.sql).not.toContain("IN ()");
      }).not.toThrow();
    });
  });
});
