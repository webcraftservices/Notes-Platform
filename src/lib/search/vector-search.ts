/**
 * src/lib/search/vector-search.ts
 *
 * pgvector Cosine Similarity Semantic Retrieval over MaterialChunk and NoteChunk
 * with HNSW Index Utilization, Tenancy Isolation, and Graceful Fallback.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getEmbeddingService, EMBEDDING_DIMENSIONS } from "@/lib/services/embedding";
import type { EmbeddingService } from "@/lib/services/interfaces";
import { recordAIUsage } from "@/lib/ai-usage";
import type { UserSearchScope } from "./search-access";

export interface RawVectorHit {
  chunkId: string;
  entityId: string;
  entityType: "material" | "note";
  title: string;
  chunkContent: string;
  pageNumber: number | null;
  startSeconds: number | null;
  similarityScore: number;
  hierarchy: {
    subjectId?: string;
    subjectName?: string;
    chapterId?: string;
    chapterName?: string;
    topicId?: string;
    topicName?: string;
    groupId?: string;
    groupName?: string;
  };
}

export interface VectorSearchParams {
  query: string;
  scope: UserSearchScope;
  limit?: number;
  types?: ("material" | "note")[];
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
  groupId?: string;
  minSimilarity?: number;
  embeddingService?: EmbeddingService;
}

export async function executeVectorSearch(
  params: VectorSearchParams
): Promise<RawVectorHit[]> {
  const query = params.query.trim();
  if (query.length === 0) return [];

  // Fail-closed if caller requests a group the user is not actively in
  if (params.groupId && !params.scope.activeGroupIds.includes(params.groupId)) {
    return [];
  }

  const limit = params.limit ?? 50;
  const types = params.types ?? ["material", "note"];

  // 1. Generate Query Vector Embedding with Graceful Fallback
  let queryVector: number[];
  let totalTokens: number | undefined;
  let embeddingService: EmbeddingService;

  try {
    embeddingService = params.embeddingService ?? getEmbeddingService();
    const result = await embeddingService.embed([query]);
    const vec = result.vectors[0];
    if (!vec || vec.length !== EMBEDDING_DIMENSIONS) {
      return [];
    }
    queryVector = vec;
    totalTokens = typeof result.totalTokens === "number" ? result.totalTokens : undefined;
  } catch (err) {
    // Graceful degradation: Log and return empty array so lexical search proceeds
    console.warn("[vector-search] Embedding unavailable, falling back to lexical search:", err);
    return [];
  }

  // 2. Record AI Usage (Non-blocking)
  if (params.scope.userId) {
    try {
      const maybePromise = recordAIUsage({
        userId: params.scope.userId,
        workspaceId: params.scope.personalWorkspaceId,
        category: "embedding",
        provider: embeddingService.providerName,
        model: embeddingService.modelName,
        tokensInput: totalTokens,
        context: { purpose: "search_query" },
      });
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch(() => {});
      }
    } catch {
      // Non-blocking AI usage accounting
    }
  }

  const vectorLiteral = `[${queryVector.join(",")}]`;

  // 3. Execute Parallel Searches Across Requested Entity Chunk Tables
  const searches: Promise<RawVectorHit[]>[] = [];

  if (types.includes("material")) {
    searches.push(searchMaterialChunks(vectorLiteral, params, limit));
  }
  if (types.includes("note")) {
    searches.push(searchNoteChunks(vectorLiteral, params, limit));
  }

  const results = await Promise.all(searches);
  const combined = results.flat();

  // 4. Sort Combined Chunks by Similarity Descending and Limit
  combined.sort((a, b) => b.similarityScore - a.similarityScore);
  return combined.slice(0, limit);
}

async function searchMaterialChunks(
  vectorLiteral: string,
  params: VectorSearchParams,
  limit: number
): Promise<RawVectorHit[]> {
  const { scope, subjectId, chapterId, topicId, groupId, minSimilarity = 0.0 } = params;
  const activeGroupIds = scope.activeGroupIds ?? [];

  const rows = await db.$queryRaw<
    {
      chunkId: string;
      entityId: string;
      title: string;
      chunkContent: string;
      pageNumber: number | null;
      startSeconds: number | null;
      similarityScore: number;
      subjectId: string | null;
      subjectName: string | null;
      chapterId: string | null;
      chapterName: string | null;
      topicId: string | null;
      topicName: string | null;
      groupId: string | null;
      groupName: string | null;
    }[]
  >`
    SELECT
      mc.id AS "chunkId",
      m.id AS "entityId",
      m.title AS "title",
      mc.content AS "chunkContent",
      mc."pageNumber" AS "pageNumber",
      mc."startSeconds" AS "startSeconds",
      1 - (mc.embedding <=> ${vectorLiteral}::vector) AS "similarityScore",
      s.id AS "subjectId",
      s.name AS "subjectName",
      c.id AS "chapterId",
      c.name AS "chapterName",
      t.id AS "topicId",
      t.name AS "topicName",
      g.id AS "groupId",
      g.name AS "groupName"
    FROM "MaterialChunk" mc
    JOIN "Material" m ON m.id = mc."materialId"
    LEFT JOIN "Topic" t ON t.id = m."topicId"
    LEFT JOIN "Chapter" c ON c.id = coalesce(m."chapterId", t."chapterId")
    LEFT JOIN "Subject" s ON s.id = coalesce(m."subjectId", c."subjectId")
    LEFT JOIN "Group" g ON g.id = coalesce(m."groupId", s."groupId")
    WHERE mc.embedding IS NOT NULL
      AND m."deletedAt" IS NULL
      AND (
        (m."workspaceId" IS NOT NULL AND m."workspaceId" = ${scope.personalWorkspaceId})
        OR (m."groupId" IS NOT NULL AND m."groupId" = ANY(${activeGroupIds}::text[]))
        OR (s.id IS NOT NULL AND (
          s."workspaceId" = ${scope.personalWorkspaceId}
          OR (s."groupId" IS NOT NULL AND s."groupId" = ANY(${activeGroupIds}::text[]))
        ))
        OR (m."ownerId" = ${scope.userId} AND m."workspaceId" IS NULL AND m."groupId" IS NULL AND m."subjectId" IS NULL)
      )
      AND (s.id IS NULL OR s."deletedAt" IS NULL)
      AND (c.id IS NULL OR c."deletedAt" IS NULL)
      AND (t.id IS NULL OR t."deletedAt" IS NULL)
      AND (g.id IS NULL OR g."deletedAt" IS NULL)
      ${subjectId ? Prisma.sql`AND (m."subjectId" = ${subjectId} OR s.id = ${subjectId})` : Prisma.empty}
      ${chapterId ? Prisma.sql`AND (m."chapterId" = ${chapterId} OR c.id = ${chapterId})` : Prisma.empty}
      ${topicId ? Prisma.sql`AND m."topicId" = ${topicId}` : Prisma.empty}
      ${groupId ? Prisma.sql`AND (m."groupId" = ${groupId} OR s."groupId" = ${groupId})` : Prisma.empty}
      ${minSimilarity > 0 ? Prisma.sql`AND (1 - (mc.embedding <=> ${vectorLiteral}::vector)) >= ${minSimilarity}` : Prisma.empty}
    ORDER BY mc.embedding <=> ${vectorLiteral}::vector ASC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    chunkId: r.chunkId,
    entityId: r.entityId,
    entityType: "material",
    title: r.title,
    chunkContent: r.chunkContent,
    pageNumber: r.pageNumber,
    startSeconds: r.startSeconds,
    similarityScore: Number(r.similarityScore),
    hierarchy: {
      subjectId: r.subjectId ?? undefined,
      subjectName: r.subjectName ?? undefined,
      chapterId: r.chapterId ?? undefined,
      chapterName: r.chapterName ?? undefined,
      topicId: r.topicId ?? undefined,
      topicName: r.topicName ?? undefined,
      groupId: r.groupId ?? undefined,
      groupName: r.groupName ?? undefined,
    },
  }));
}

async function searchNoteChunks(
  vectorLiteral: string,
  params: VectorSearchParams,
  limit: number
): Promise<RawVectorHit[]> {
  const { scope, subjectId, chapterId, topicId, groupId, minSimilarity = 0.0 } = params;
  const activeGroupIds = scope.activeGroupIds ?? [];

  const rows = await db.$queryRaw<
    {
      chunkId: string;
      entityId: string;
      title: string;
      chunkContent: string;
      similarityScore: number;
      subjectId: string | null;
      subjectName: string | null;
      chapterId: string | null;
      chapterName: string | null;
      topicId: string | null;
      topicName: string | null;
      groupId: string | null;
      groupName: string | null;
    }[]
  >`
    SELECT
      nc.id AS "chunkId",
      n.id AS "entityId",
      n.title AS "title",
      nc.content AS "chunkContent",
      1 - (nc.embedding <=> ${vectorLiteral}::vector) AS "similarityScore",
      s.id AS "subjectId",
      s.name AS "subjectName",
      c.id AS "chapterId",
      c.name AS "chapterName",
      t.id AS "topicId",
      t.name AS "topicName",
      g.id AS "groupId",
      g.name AS "groupName"
    FROM "NoteChunk" nc
    JOIN "Note" n ON n.id = nc."noteId"
    LEFT JOIN "Topic" t ON t.id = n."topicId"
    LEFT JOIN "Chapter" c ON c.id = t."chapterId"
    LEFT JOIN "Subject" s ON s.id = c."subjectId"
    LEFT JOIN "Group" g ON g.id = s."groupId"
    WHERE nc.embedding IS NOT NULL
      AND n."deletedAt" IS NULL
      AND (
        (n."topicId" IS NOT NULL
         AND t."deletedAt" IS NULL
         AND c."deletedAt" IS NULL
         AND s."deletedAt" IS NULL
         AND (g.id IS NULL OR g."deletedAt" IS NULL)
         AND (
           s."workspaceId" = ${scope.personalWorkspaceId}
           OR (s."groupId" IS NOT NULL AND s."groupId" = ANY(${activeGroupIds}::text[]))
         )
        )
        OR
        (n."topicId" IS NULL AND n."authorId" = ${scope.userId})
      )
      ${subjectId ? Prisma.sql`AND s.id = ${subjectId}` : Prisma.empty}
      ${chapterId ? Prisma.sql`AND c.id = ${chapterId}` : Prisma.empty}
      ${topicId ? Prisma.sql`AND n."topicId" = ${topicId}` : Prisma.empty}
      ${groupId ? Prisma.sql`AND s."groupId" = ${groupId}` : Prisma.empty}
      ${minSimilarity > 0 ? Prisma.sql`AND (1 - (nc.embedding <=> ${vectorLiteral}::vector)) >= ${minSimilarity}` : Prisma.empty}
    ORDER BY nc.embedding <=> ${vectorLiteral}::vector ASC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    chunkId: r.chunkId,
    entityId: r.entityId,
    entityType: "note",
    title: r.title,
    chunkContent: r.chunkContent,
    pageNumber: null,
    startSeconds: null,
    similarityScore: Number(r.similarityScore),
    hierarchy: {
      subjectId: r.subjectId ?? undefined,
      subjectName: r.subjectName ?? undefined,
      chapterId: r.chapterId ?? undefined,
      chapterName: r.chapterName ?? undefined,
      topicId: r.topicId ?? undefined,
      topicName: r.topicName ?? undefined,
      groupId: r.groupId ?? undefined,
      groupName: r.groupName ?? undefined,
    },
  }));
}
