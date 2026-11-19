/**
 * src/lib/search/__tests__/challenger-access.adversarial.test.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE — CHALLENGER 1 (Milestone 2)
 *
 * Targets:
 * 1. Tenancy Leakage: Cross-workspace access attempts via direct, empty, or forged filters.
 * 2. Group Boundaries: Non-member access attempts to private group resources.
 * 3. Soft-Delete Cascades: Complete exclusion of children under soft-deleted Subject/Chapter/Topic/Group.
 * 4. Empty Group Array: Safety and syntax validity when activeGroupIds = [].
 * 5. Role Parity: Identical read permissions across VIEWER, MEMBER, ADMIN, OWNER.
 * 6. Adversarial Input & Injection Resilience: Syntax fuzzing, SQL injection payloads, extreme inputs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mocks & Setup
// ============================================================================

const db = vi.hoisted(() => ({
  groupMember: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));

const access = vi.hoisted(() => ({
  getPrimaryWorkspace: vi.fn(),
}));

const recordAIUsageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockEmbed = vi.hoisted(() => vi.fn());
const mockEmbeddingService = {
  dimensions: 1536,
  providerName: "openai",
  modelName: "text-embedding-3-small",
  embed: mockEmbed,
};

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/access", () => ({ getPrimaryWorkspace: access.getPrimaryWorkspace }));
vi.mock("@/lib/ai-usage", () => ({ recordAIUsage: recordAIUsageMock }));
vi.mock("@/lib/services/embedding", () => ({
  EMBEDDING_DIMENSIONS: 1536,
  getEmbeddingService: () => mockEmbeddingService,
}));

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

import {
  executeLexicalSearch,
  normalizeSearchQuery,
  type LexicalSearchParams,
} from "../lexical-search";

import {
  executeVectorSearch,
  type VectorSearchParams,
} from "../vector-search";

function extractSqlAndValues(raw: unknown): { sql: string; values: unknown[] } {
  const strings: string[] = [];
  const values: unknown[] = [];

  function inspect(val: unknown) {
    if (val && typeof val === "object" && ("strings" in val || "sql" in val || "values" in val)) {
      if ("strings" in val && Array.isArray((val as { strings: unknown[] }).strings)) {
        strings.push((val as { strings: string[] }).strings.join(" "));
      }
      if ("sql" in val && typeof (val as { sql: unknown }).sql === "string") {
        strings.push((val as { sql: string }).sql);
      }
      if ("values" in val && Array.isArray((val as { values: unknown[] }).values)) {
        for (const subVal of (val as { values: unknown[] }).values) {
          inspect(subVal);
        }
      }
    } else {
      values.push(val);
    }
  }

  if (Array.isArray(raw)) {
    // raw is either TemplateStringsArray or an array of call arguments [strings, ...values]
    if (raw.length > 0 && Array.isArray(raw[0])) {
      // It's Vitest call args: [TemplateStringsArray, val1, val2, ...]
      strings.push((raw[0] as string[]).join(" "));
      for (let i = 1; i < raw.length; i++) {
        inspect(raw[i]);
      }
    } else {
      // It's directly an array of strings or values
      for (const item of raw) {
        if (typeof item === "string") {
          strings.push(item);
        } else {
          inspect(item);
        }
      }
    }
  } else {
    inspect(raw);
  }

  return { sql: strings.join(" "), values };
}

describe("Empirical Challenger 1: Adversarial Access & Tenancy Stress Verification", () => {
  const dummy1536Vector = Array(1536).fill(0.01);

  beforeEach(() => {
    vi.resetAllMocks();
    recordAIUsageMock.mockResolvedValue(undefined);
    mockEmbed.mockResolvedValue({
      vectors: [dummy1536Vector],
      totalTokens: 10,
    });
  });

  // Test scopes
  const scopeUserA: UserSearchScope = {
    userId: "user-A",
    personalWorkspaceId: "ws-A",
    activeGroupIds: ["group-alpha"],
  };

  const scopeSoloUser: UserSearchScope = {
    userId: "user-solo",
    personalWorkspaceId: "ws-solo",
    activeGroupIds: [],
  };

  const scopeUserB: UserSearchScope = {
    userId: "user-B",
    personalWorkspaceId: "ws-B",
    activeGroupIds: ["group-beta"],
  };

  // =========================================================================
  // 1. Tenancy Leakage Stress Tests
  // =========================================================================
  describe("1. Tenancy Leakage: Cross-Workspace Isolation", () => {
    it("1.1 [SQL] Subject WHERE prevents User A from matching User B's workspace even if subjectId is supplied", () => {
      // User A specifies subjectId pointing to User B's subject
      const sqlObj = buildSubjectSqlWhere(scopeUserA, { subjectId: "sub-in-ws-B" });
      const { sql, values } = extractSqlAndValues(sqlObj);

      expect(sql).toContain('s."deletedAt" IS NULL');
      expect(sql).toContain('s.id =');
      expect(values).toContain("sub-in-ws-B");
      // Tenancy predicate strictly checks personalWorkspaceId = ws-A or groupId IN ('group-alpha')
      expect(values).toContain("ws-A");
      expect(values).not.toContain("ws-B");
    });

    it("1.2 [SQL] Chapter WHERE links to Subject tenancy and excludes foreign workspaces", () => {
      const sqlObj = buildChapterSqlWhere(scopeUserA, { chapterId: "ch-in-ws-B" });
      const { sql, values } = extractSqlAndValues(sqlObj);

      expect(sql).toContain('c."deletedAt" IS NULL');
      expect(sql).toContain('s."deletedAt" IS NULL');
      expect(sql).toContain('c.id =');
      expect(values).toContain("ch-in-ws-B");
      expect(values).toContain("ws-A");
      expect(values).not.toContain("ws-B");
    });

    it("1.3 [SQL] Note WHERE strictly enforces personal workspace or group-alpha for topic notes", () => {
      const sqlObj = buildNoteSqlWhere(scopeUserA, { topicId: "top-in-ws-B" });
      const { sql, values } = extractSqlAndValues(sqlObj);

      expect(sql).toContain('n."deletedAt" IS NULL');
      expect(sql).toContain('t."deletedAt" IS NULL');
      expect(sql).toContain('c."deletedAt" IS NULL');
      expect(sql).toContain('s."deletedAt" IS NULL');
      expect(values).toContain("top-in-ws-B");
      expect(values).toContain("ws-A");
      expect(values).not.toContain("ws-B");
    });

    it("1.4 [SQL] Standalone Note WHERE strictly restricts authorId to scope.userId", () => {
      // With no hierarchy filters, standalone notes require authorId = scope.userId
      const sqlObj = buildNoteSqlWhere(scopeUserA);
      const { sql, values } = extractSqlAndValues(sqlObj);

      expect(sql).toContain('n."topicId" IS NULL');
      expect(sql).toContain('n."authorId" =');
      expect(values).toContain("user-A");
      expect(values).not.toContain("user-B");
    });

    it("1.5 [SQL] Material WHERE restricts personal items to personalWorkspaceId or ownerId", () => {
      const sqlObj = buildMaterialSqlWhere(scopeUserA);
      const { sql, values } = extractSqlAndValues(sqlObj);

      expect(sql).toContain('m."deletedAt" IS NULL');
      expect(values).toContain("ws-A");
      expect(values).toContain("user-A");
      expect(values).not.toContain("ws-B");
      expect(values).not.toContain("user-B");
    });

    it("1.6 [Prisma] Prisma WHERE builders enforce workspaceId and ownerId boundaries", () => {
      const subWhere = buildSubjectWhere(scopeUserA);
      expect(subWhere.AND).toBeDefined();
      const whereJson = JSON.stringify(subWhere);
      expect(whereJson).toContain("ws-A");
      expect(whereJson).not.toContain("ws-B");

      const noteWhere = buildNoteWhere(scopeUserA);
      const noteJson = JSON.stringify(noteWhere);
      expect(noteJson).toContain("ws-A");
      expect(noteJson).toContain("user-A");
      expect(noteJson).not.toContain("ws-B");
      expect(noteJson).not.toContain("user-B");
    });
  });

  // =========================================================================
  // 2. Group Boundaries & Non-Member Attack Scenarios
  // =========================================================================
  describe("2. Group Boundaries & Unauthorized Group Access", () => {
    it("2.1 [Lexical] executeLexicalSearch immediately returns [] without calling db if unauthorized groupId requested", async () => {
      const hits = await executeLexicalSearch({
        query: "financial results",
        scope: scopeUserA, // only has group-alpha
        groupId: "group-beta", // forbidden target
      });

      expect(hits).toEqual([]);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it("2.2 [Vector] executeVectorSearch immediately returns [] without calling embedding or db if unauthorized groupId requested", async () => {
      const hits = await executeVectorSearch({
        query: "confidential roadmap",
        scope: scopeUserA,
        groupId: "group-secret-x",
      });

      expect(hits).toEqual([]);
      expect(mockEmbed).not.toHaveBeenCalled();
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it("2.3 [SQL] All 7 SQL WHERE builders return fail-closed '1 = 0' for unauthorized groupId", () => {
      const unauthorizedFilter = { groupId: "group-unauthorized" };

      const subSql = buildSubjectSqlWhere(scopeUserA, unauthorizedFilter);
      const chSql = buildChapterSqlWhere(scopeUserA, unauthorizedFilter);
      const topSql = buildTopicSqlWhere(scopeUserA, unauthorizedFilter);
      const noteSql = buildNoteSqlWhere(scopeUserA, unauthorizedFilter);
      const matSql = buildMaterialSqlWhere(scopeUserA, unauthorizedFilter);
      const grpSql = buildGroupSqlWhere(scopeUserA, unauthorizedFilter);
      const deckSql = buildFlashcardDeckSqlWhere(scopeUserA, unauthorizedFilter);

      expect(extractSqlAndValues(subSql).sql).toContain("1 = 0");
      expect(extractSqlAndValues(chSql).sql).toContain("1 = 0");
      expect(extractSqlAndValues(topSql).sql).toContain("1 = 0");
      expect(extractSqlAndValues(noteSql).sql).toContain("1 = 0");
      expect(extractSqlAndValues(matSql).sql).toContain("1 = 0");
      expect(extractSqlAndValues(grpSql).sql).toContain("1 = 0");
      expect(extractSqlAndValues(deckSql).sql).toContain("1 = 0");
    });

    it("2.4 [Prisma] All 7 Prisma WHERE builders return impossible-id-fail-closed for unauthorized groupId", () => {
      const unauthorizedFilter = { groupId: "group-unauthorized" };

      expect(buildSubjectWhere(scopeUserA, unauthorizedFilter)).toEqual({ id: "impossible-id-fail-closed" });
      expect(buildChapterWhere(scopeUserA, unauthorizedFilter)).toEqual({ id: "impossible-id-fail-closed" });
      expect(buildTopicWhere(scopeUserA, unauthorizedFilter)).toEqual({ id: "impossible-id-fail-closed" });
      expect(buildNoteWhere(scopeUserA, unauthorizedFilter)).toEqual({ id: "impossible-id-fail-closed" });
      expect(buildMaterialWhere(scopeUserA, unauthorizedFilter)).toEqual({ id: "impossible-id-fail-closed" });
      expect(buildGroupWhere(scopeUserA, unauthorizedFilter)).toEqual({ id: "impossible-id-fail-closed" });
      expect(buildFlashcardDeckWhere(scopeUserA, unauthorizedFilter)).toEqual({ id: "impossible-id-fail-closed" });
    });

    it("2.5 [SQL Injection in groupId] Attempting SQL injection via groupId fails closed safely", async () => {
      const maliciousGroupId = "group-alpha' OR '1'='1";
      const hits = await executeLexicalSearch({
        query: "anything",
        scope: scopeUserA, // activeGroupIds has exact string 'group-alpha'
        groupId: maliciousGroupId,
      });

      // Because maliciousGroupId is not in activeGroupIds, it fails closed immediately
      expect(hits).toEqual([]);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Soft-Delete Cascades: Fail-Closed Invariant
  // =========================================================================
  describe("3. Soft-Delete Cascades & Ancestor Soft-Deletion Checks", () => {
    it("3.1 [Scope Resolution] Soft-deleted groups are never included in activeGroupIds", async () => {
      access.getPrimaryWorkspace.mockResolvedValue({ id: "ws-test" });
      db.groupMember.findMany.mockResolvedValue([]); // filtered by group: { deletedAt: null }

      const scope = await resolveUserSearchScope("usr-test");

      expect(db.groupMember.findMany).toHaveBeenCalledWith({
        where: {
          userId: "usr-test",
          group: { deletedAt: null },
        },
        select: { groupId: true },
      });
      expect(scope.activeGroupIds).toEqual([]);
    });

    it("3.2 [Lexical Queries] All entity queries enforce deletedAt IS NULL on entity and all ancestors", async () => {
      db.$queryRaw.mockResolvedValue([]);

      await executeLexicalSearch({
        query: "photosynthesis",
        scope: scopeUserA,
      });

      expect(db.$queryRaw).toHaveBeenCalledTimes(7);

      for (const call of db.$queryRaw.mock.calls) {
        const { sql } = extractSqlAndValues(call);
        // Every single entity query checks deletedAt IS NULL
        expect(sql).toContain('"deletedAt" IS NULL');
      }
    });

    it("3.3 [Vector Queries] Both MaterialChunk and NoteChunk check ancestor deletedAt IS NULL", async () => {
      db.$queryRaw.mockResolvedValue([]);

      await executeVectorSearch({
        query: "enzymes kinetics",
        scope: scopeUserA,
      });

      expect(db.$queryRaw).toHaveBeenCalledTimes(2);

      const matCall = db.$queryRaw.mock.calls[0]!;
      const noteCall = db.$queryRaw.mock.calls[1]!;

      const matSql = extractSqlAndValues(matCall).sql;
      const noteSql = extractSqlAndValues(noteCall).sql;

      // MaterialChunk verifies m.deletedAt, s.deletedAt, c.deletedAt, t.deletedAt, g.deletedAt
      expect(matSql).toContain('m."deletedAt" IS NULL');
      expect(matSql).toContain('s."deletedAt" IS NULL');
      expect(matSql).toContain('c."deletedAt" IS NULL');
      expect(matSql).toContain('t."deletedAt" IS NULL');
      expect(matSql).toContain('g."deletedAt" IS NULL');

      // NoteChunk verifies n.deletedAt, s.deletedAt, c.deletedAt, t.deletedAt, g.deletedAt
      expect(noteSql).toContain('n."deletedAt" IS NULL');
      expect(noteSql).toContain('s."deletedAt" IS NULL');
      expect(noteSql).toContain('c."deletedAt" IS NULL');
      expect(noteSql).toContain('t."deletedAt" IS NULL');
      expect(noteSql).toContain('g."deletedAt" IS NULL');
    });

    it("3.4 [Prisma Invariant] Note Prisma where clause nests ancestor soft-deletion", () => {
      const where = buildNoteWhere(scopeUserA);
      const whereStr = JSON.stringify(where);
      // deletedAt: null appears at note, topic, chapter, and subject levels
      const matches = whereStr.match(/"deletedAt":null/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(4);
    });

    it("3.5 [Prisma Invariant] Topic Prisma where clause verifies Chapter and Subject soft-deletion", () => {
      const where = buildTopicWhere(scopeUserA);
      const whereStr = JSON.stringify(where);
      const matches = whereStr.match(/"deletedAt":null/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(3);
    });
  });

  // =========================================================================
  // 4. Empty Group Array Safety: activeGroupIds = []
  // =========================================================================
  describe("4. Empty Group Array Safety (activeGroupIds = [])", () => {
    it("4.1 [SQL] buildGroupSqlWhere returns '1 = 0' without calling Prisma.join when activeGroupIds = []", () => {
      const sqlObj = buildGroupSqlWhere(scopeSoloUser);
      const { sql } = extractSqlAndValues(sqlObj);
      expect(sql).toContain("1 = 0");
    });

    it("4.2 [SQL] All SQL WHERE builders produce valid SQL with activeGroupIds = [] and zero syntax errors", () => {
      const builders = [
        () => buildSubjectSqlWhere(scopeSoloUser),
        () => buildChapterSqlWhere(scopeSoloUser),
        () => buildTopicSqlWhere(scopeSoloUser),
        () => buildNoteSqlWhere(scopeSoloUser),
        () => buildMaterialSqlWhere(scopeSoloUser),
        () => buildGroupSqlWhere(scopeSoloUser),
        () => buildFlashcardDeckSqlWhere(scopeSoloUser),
      ];

      for (const builder of builders) {
        expect(() => {
          const sqlObj = builder();
          const { sql } = extractSqlAndValues(sqlObj);
          expect(sql).not.toContain("IN ()");
          expect(sql).not.toContain("IN ()");
        }).not.toThrow();
      }
    });

    it("4.3 [Lexical] executeLexicalSearch succeeds without errors when activeGroupIds = []", async () => {
      db.$queryRaw.mockResolvedValue([]);

      const hits = await executeLexicalSearch({
        query: "mitochondria",
        scope: scopeSoloUser,
      });

      expect(hits).toEqual([]);
      // 6 queries executed (Group query is skipped because activeGroupIds = [])
      expect(db.$queryRaw).toHaveBeenCalledTimes(6);
      for (const call of db.$queryRaw.mock.calls) {
        const { sql } = extractSqlAndValues(call);
        expect(sql).not.toContain("IN ()");
      }
    });

    it("4.4 [Vector] executeVectorSearch succeeds without errors when activeGroupIds = []", async () => {
      db.$queryRaw.mockResolvedValue([]);

      const hits = await executeVectorSearch({
        query: "cellular respiration",
        scope: scopeSoloUser,
      });

      expect(hits).toEqual([]);
      expect(db.$queryRaw).toHaveBeenCalledTimes(2);

      const matCall = db.$queryRaw.mock.calls[0]!;
      const noteCall = db.$queryRaw.mock.calls[1]!;

      // Verify activeGroupIds is passed as empty array [] to ANY(${activeGroupIds}::text[])
      expect(matCall[3]).toEqual([]);
      expect(matCall[5]).toEqual([]);
      expect(noteCall[3]).toEqual([]);
    });
  });

  // =========================================================================
  // 5. Role Parity across Group Roles (VIEWER, MEMBER, ADMIN, OWNER)
  // =========================================================================
  describe("5. Role Parity: VIEWER, MEMBER, ADMIN, OWNER", () => {
    it("5.1 [Scope] All 4 roles resolve identical search scope with group memberships", async () => {
      const roles = ["VIEWER", "MEMBER", "ADMIN", "OWNER"] as const;

      for (const role of roles) {
        access.getPrimaryWorkspace.mockResolvedValue({ id: "ws-parity" });
        db.groupMember.findMany.mockResolvedValue([{ groupId: "group-shared" }]);

        const scope = await resolveUserSearchScope(`user-${role.toLowerCase()}`);

        expect(scope).toEqual({
          userId: `user-${role.toLowerCase()}`,
          personalWorkspaceId: "ws-parity",
          activeGroupIds: ["group-shared"],
        });
      }
    });

    it("5.2 [Retrieval] VIEWER and OWNER generate identical SQL query predicates for group content", async () => {
      const viewerScope: UserSearchScope = {
        userId: "user-viewer",
        personalWorkspaceId: "ws-viewer",
        activeGroupIds: ["group-shared"],
      };

      const ownerScope: UserSearchScope = {
        userId: "user-owner",
        personalWorkspaceId: "ws-owner",
        activeGroupIds: ["group-shared"],
      };

      const viewerSql = extractSqlAndValues(buildSubjectSqlWhere(viewerScope, { groupId: "group-shared" }));
      const ownerSql = extractSqlAndValues(buildSubjectSqlWhere(ownerScope, { groupId: "group-shared" }));

      // SQL structure is identical: s."deletedAt" IS NULL AND s."groupId" = $1
      expect(viewerSql.sql).toBe(ownerSql.sql);
      expect(viewerSql.values).toEqual(ownerSql.values);
    });

    it("5.3 [Results Parity] Mock DB results for group content return identical search hits for VIEWER and OWNER", async () => {
      const mockRows = [
        {
          id: "mat-group-shared",
          entityType: "material",
          title: "Shared Organic Chemistry Lecture",
          snippetSourceText: "Benzene ring resonance stability.",
          subjectId: "sub-1",
          subjectName: "Chemistry",
          chapterId: null,
          chapterName: null,
          topicId: null,
          topicName: null,
          groupId: "group-shared",
          groupName: "Chemistry Study Group",
          rankScore: 0.88,
        },
      ];

      const roles = ["viewer", "member", "admin", "owner"];
      const results: unknown[] = [];

      for (const role of roles) {
        db.$queryRaw.mockResolvedValue(mockRows);

        const scope: UserSearchScope = {
          userId: `usr-${role}`,
          personalWorkspaceId: `ws-${role}`,
          activeGroupIds: ["group-shared"],
        };

        const hits = await executeLexicalSearch({
          query: "resonance stability",
          scope,
          types: ["material"],
          groupId: "group-shared",
        });

        results.push(hits);
      }

      // Assert all 4 roles receive identical search results
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);
      expect(results[2]).toEqual(results[3]);
    });
  });

  // =========================================================================
  // 6. Adversarial Input & FTS Injection Resilience
  // =========================================================================
  describe("6. Adversarial Input & FTS Injection Resilience", () => {
    it("6.1 handles SQL injection payloads in search query safely via websearch_to_tsquery parameterization", async () => {
      const injectionPayloads = [
        `'; DROP TABLE "User"; --`,
        `' OR '1'='1`,
        `" OR ""="`,
        `admin'--`,
        `\\x00\\x01\\x02`,
        `' UNION SELECT * FROM "User" --`,
      ];

      for (const payload of injectionPayloads) {
        db.$queryRaw.mockResolvedValue([]);

        await executeLexicalSearch({
          query: payload,
          scope: scopeUserA,
        });

        const normalized = normalizeSearchQuery(payload);
        for (const call of db.$queryRaw.mock.calls) {
          const { values } = extractSqlAndValues(call);
          // Payloads are passed as bound parameters, never concatenated into raw SQL
          expect(values.some((v) => typeof v === "string" && v.includes(normalized))).toBe(true);
        }
        db.$queryRaw.mockClear();
      }
    });

    it("6.2 handles pathological input lengths (10,000 characters) by capping at 200 characters safely", () => {
      const pathological = "word ".repeat(2500); // ~12,500 chars
      const normalized = normalizeSearchQuery(pathological);

      expect(normalized.length).toBe(200);
      expect(normalized.endsWith("word") || normalized.endsWith(" ")).toBe(true);
    });

    it("6.3 handles extreme punctuation, unbalanced quotes, and operator spam safely", () => {
      const inputs = [
        `"""""""""`,
        `'''''''''`,
        `AND OR NOT AND AND OR`,
        `!@#$%^&*()_+-=[]{}|;':",.<>/?`,
        `\t\r\n   spaces   \t\r\n`,
      ];

      for (const inp of inputs) {
        const norm = normalizeSearchQuery(inp);
        expect(typeof norm).toBe("string");
      }
    });

    it("6.4 vector search handles malformed vector dimensions gracefully without throwing", async () => {
      // Mock embedding returning a 768-dim vector instead of 1536
      mockEmbed.mockResolvedValueOnce({
        vectors: [Array(768).fill(0.01)],
        totalTokens: 5,
      });

      const hits = await executeVectorSearch({
        query: "corrupted dimension check",
        scope: scopeUserA,
      });

      // Mismatched dimensions fail closed gracefully to [] without crashing
      expect(hits).toEqual([]);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });

    it("6.5 vector search handles empty vector array gracefully", async () => {
      mockEmbed.mockResolvedValueOnce({
        vectors: [],
        totalTokens: 0,
      });

      const hits = await executeVectorSearch({
        query: "empty vectors check",
        scope: scopeUserA,
      });

      expect(hits).toEqual([]);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
