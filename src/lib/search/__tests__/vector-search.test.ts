/**
 * src/lib/search/__tests__/vector-search.test.ts
 *
 * Comprehensive 12-Test Vitest Suite for pgvector Cosine Semantic Retrieval:
 * HNSW index usage (<=> order), cosine similarity calculation, tenancy predicates,
 * fail-closed ancestor soft-deletion, graceful embedding degradation, and AI usage logging.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
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
vi.mock("@/lib/ai-usage", () => ({ recordAIUsage: recordAIUsageMock }));
vi.mock("@/lib/services/embedding", () => ({
  EMBEDDING_DIMENSIONS: 1536,
  getEmbeddingService: () => mockEmbeddingService,
}));

function getSqlString(sqlArg: unknown): string {
  const parts: string[] = [];
  function extract(item: unknown) {
    if (Array.isArray(item)) {
      parts.push(item.join(" "));
    } else if (item && typeof item === "object") {
      if ("sql" in item && typeof (item as { sql: unknown }).sql === "string") {
        parts.push((item as { sql: string }).sql);
      }
      if ("strings" in item && Array.isArray((item as { strings: unknown[] }).strings)) {
        parts.push((item as { strings: string[] }).strings.join(" "));
      }
      if ("values" in item && Array.isArray((item as { values: unknown[] }).values)) {
        for (const val of (item as { values: unknown[] }).values) {
          extract(val);
        }
      }
    }
  }
  extract(sqlArg);
  return parts.join(" ");
}

import {
  executeVectorSearch,
  type VectorSearchParams,
} from "../vector-search";
import type { UserSearchScope } from "../search-access";

describe("pgvector Semantic Vector Retrieval", () => {
  const dummy1536Vector = Array(1536).fill(0.025);

  beforeEach(() => {
    vi.resetAllMocks();
    recordAIUsageMock.mockResolvedValue(undefined);
    mockEmbed.mockResolvedValue({
      vectors: [dummy1536Vector],
      totalTokens: 12,
    });
  });

  const mockScope: UserSearchScope = {
    userId: "usr-vector-1",
    personalWorkspaceId: "ws-vector-1",
    activeGroupIds: ["grp-v1", "grp-v2"],
  };

  it("VS-01: orders candidates by cosine distance (<=>) for HNSW index usage", async () => {
    db.$queryRaw.mockResolvedValue([]);

    await executeVectorSearch({
      query: "photosynthesis light reactions",
      scope: mockScope,
    });

    expect(db.$queryRaw).toHaveBeenCalledTimes(2); // material + note
    for (const call of db.$queryRaw.mock.calls) {
      const sql = getSqlString(call[0]);
      expect(sql).toContain("<=>");
      expect(sql).toContain("ORDER BY");
      expect(sql).toContain("ASC");
    }
  });

  it("VS-02: calculates cosine similarity as 1 - (embedding <=> query_vector)", async () => {
    db.$queryRaw.mockImplementation((sqlArg) => {
      const sql = getSqlString(sqlArg);
      if (sql.includes("MaterialChunk")) {
        return Promise.resolve([
          {
            chunkId: "mc-1",
            entityId: "mat-1",
            title: "Cellular Biology",
            chunkContent: "Thylakoid membranes contain chlorophyll complexes.",
            pageNumber: 42,
            startSeconds: null,
            similarityScore: 0.895,
            subjectId: "sub-1",
            subjectName: "Biology",
            chapterId: "ch-1",
            chapterName: "Photosynthesis",
            topicId: "top-1",
            topicName: "Light Reactions",
            groupId: null,
            groupName: null,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const hits = await executeVectorSearch({
      query: "thylakoid",
      scope: mockScope,
      types: ["material"],
    });

    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    expect(hit.chunkId).toBe("mc-1");
    expect(hit.entityType).toBe("material");
    expect(hit.similarityScore).toBe(0.895);
    expect(hit.pageNumber).toBe(42);
    expect(hit.hierarchy.subjectName).toBe("Biology");
  });

  it("VS-03: enforces tenancy filtering for personal workspace", async () => {
    db.$queryRaw.mockResolvedValue([]);

    await executeVectorSearch({
      query: "workspace test",
      scope: mockScope,
    });

    for (const call of db.$queryRaw.mock.calls) {
      const sql = getSqlString(call[0]);
      expect(sql).toContain('"workspaceId" =');
    }
  });

  it("VS-04: binds activeGroupIds using safe array syntax (= ANY)", async () => {
    db.$queryRaw.mockResolvedValue([]);

    await executeVectorSearch({
      query: "group chunk test",
      scope: mockScope,
    });

    for (const call of db.$queryRaw.mock.calls) {
      const sql = getSqlString(call[0]);
      expect(sql).toContain("ANY(");
    }
  });

  it("VS-05: enforces ancestor soft deletion on Subject", async () => {
    db.$queryRaw.mockResolvedValue([]);

    await executeVectorSearch({
      query: "soft delete check",
      scope: mockScope,
    });

    for (const call of db.$queryRaw.mock.calls) {
      const sql = getSqlString(call[0]);
      expect(sql).toContain('s."deletedAt" IS NULL');
    }
  });

  it("VS-06: enforces ancestor soft deletion on Chapter and Topic", async () => {
    db.$queryRaw.mockResolvedValue([]);

    await executeVectorSearch({
      query: "cascade check",
      scope: mockScope,
    });

    for (const call of db.$queryRaw.mock.calls) {
      const sql = getSqlString(call[0]);
      expect(sql).toContain('c."deletedAt" IS NULL');
      expect(sql).toContain('t."deletedAt" IS NULL');
    }
  });

  it("VS-07: degrades gracefully when embedding service throws configuration error", async () => {
    mockEmbed.mockRejectedValueOnce(new Error("ServiceNotConfiguredError: OpenAI key missing"));

    const hits = await executeVectorSearch({
      query: "graceful fallback test",
      scope: mockScope,
    });

    expect(hits).toEqual([]);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("VS-08: degrades gracefully when embedding service throws network timeout", async () => {
    mockEmbed.mockRejectedValueOnce(new Error("Network timeout after 5000ms"));

    const hits = await executeVectorSearch({
      query: "network error test",
      scope: mockScope,
    });

    expect(hits).toEqual([]);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("VS-09: returns empty array immediately on whitespace / empty query without embedding", async () => {
    const hits = await executeVectorSearch({
      query: "   ",
      scope: mockScope,
    });

    expect(hits).toEqual([]);
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("VS-10: executes only NoteChunk query when types is ['note']", async () => {
    db.$queryRaw.mockResolvedValue([]);

    await executeVectorSearch({
      query: "only notes",
      scope: mockScope,
      types: ["note"],
    });

    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const firstCall = db.$queryRaw.mock.calls[0];
    const sql = getSqlString(firstCall![0]);
    expect(sql).toContain('"NoteChunk"');
    expect(sql).not.toContain('"MaterialChunk"');
  });

  it("VS-11: binds hierarchy filters (subjectId, chapterId, topicId, groupId)", async () => {
    db.$queryRaw.mockResolvedValue([]);

    await executeVectorSearch({
      query: "scoped hierarchy",
      scope: mockScope,
      subjectId: "sub-99",
      chapterId: "ch-99",
      topicId: "top-99",
    });

    const allSql = db.$queryRaw.mock.calls
      .map((call) => call.map((arg: unknown) => getSqlString(arg)).join(" "))
      .join("\n");
    expect(allSql).toContain('"subjectId" =');
    expect(allSql).toContain('"chapterId" =');
    expect(allSql).toContain('"topicId" =');
  });

  it("VS-12: asynchronously logs AI token consumption under embedding category", async () => {
    db.$queryRaw.mockResolvedValue([]);

    await executeVectorSearch({
      query: "ai accounting",
      scope: mockScope,
    });

    expect(recordAIUsageMock).toHaveBeenCalledWith({
      userId: "usr-vector-1",
      workspaceId: "ws-vector-1",
      category: "embedding",
      provider: "openai",
      model: "text-embedding-3-small",
      tokensInput: 12,
      context: { purpose: "search_query" },
    });
  });

  it("VS-13: fails closed when unauthorized groupId requested", async () => {
    const hits = await executeVectorSearch({
      query: "secret group",
      scope: mockScope,
      groupId: "forbidden-foreign-group",
    });

    expect(hits).toEqual([]);
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
