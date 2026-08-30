import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ResolvedAIScope } from "@/lib/access";
import { getEmbeddingService } from "@/lib/services/embedding";

export interface RetrievedChunk {
  id: string;
  materialId: string;
  materialTitle: string;
  content: string;
  pageNumber: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
  similarity: number;
}

/**
 * Narrows an AI scope down to the Material `where` filter that matches it.
 * Relies on the guarantee documented in materials-scope.ts: every
 * Material's subjectId/chapterId/topicId are mutually consistent (a
 * topicId always implies the matching chapterId/subjectId are set too),
 * so filtering on the single narrowest scope field is sufficient — no
 * need to OR across levels.
 */
function materialWhereForScope(scope: ResolvedAIScope) {
  if (scope.topicId) return { topicId: scope.topicId };
  if (scope.chapterId) return { chapterId: scope.chapterId };
  if (scope.subjectId) return { subjectId: scope.subjectId };
  // Phase 6.5: a bare group scope (ownerType "group" with no
  // subject/chapter/topic set) retrieves across every Material owned
  // directly by the group — mirrors Material.groupId, the same field
  // access.ts's assertScopeAccess already trusts for group-owned content.
  if (scope.ownerType === "group") return { groupId: scope.groupId };
  return { workspaceId: scope.workspaceId };
}

/**
 * Retrieves the most relevant indexed chunks for a query, restricted to
 * materials within the given (already-authorized) scope — retrieval never
 * takes a raw list of IDs from a caller; it always re-derives which
 * materials are in-scope itself, so a bug elsewhere can't accidentally
 * widen what gets searched.
 *
 * Real pgvector cosine-distance search — never a fake/keyword substitute
 * dressed up as "semantic" search (CLAUDE.md's "never fake a feature").
 * If nothing has been indexed yet for this scope, this returns an empty
 * array WITHOUT calling the embedding service — embedding a query is
 * pointless (and would trip an avoidable ServiceNotConfiguredError) when
 * there's provably nothing to compare it against yet, e.g. a brand new
 * topic with no transcribed materials.
 */
export async function retrieveRelevantChunks(
  query: string,
  scope: ResolvedAIScope,
  limit = 8
): Promise<RetrievedChunk[]> {
  const materials = await db.material.findMany({
    where: { ...materialWhereForScope(scope), deletedAt: null },
    select: { id: true },
  });
  const materialIds = materials.map((m) => m.id);
  if (materialIds.length === 0) return [];

  const indexedCount = await db.materialChunk.count({
    where: { materialId: { in: materialIds } },
  });
  if (indexedCount === 0) return [];

  const embeddingService = getEmbeddingService();
  const embeddings = await embeddingService.embed([query]);
  const queryVector = embeddings[0];
  if (!queryVector) throw new Error("EmbeddingService returned no vector for the query.");
  const vectorLiteral = `[${queryVector.join(",")}]`;

  // Raw SQL: pgvector's <=> (cosine distance) operator and the vector(1536)
  // column type aren't reachable through the typed Prisma client (the
  // schema declares embedding as Unsupported("vector(1536)")). Material
  // IDs are safely parameterized via Prisma.join; the vector literal is
  // built from numbers we generated ourselves (never user input), not
  // interpolated user text.
  const rows = await db.$queryRaw<
    { id: string; materialId: string; materialTitle: string; content: string; pageNumber: number | null; startSeconds: number | null; endSeconds: number | null; similarity: number }[]
  >`
    SELECT mc.id, mc."materialId", m.title AS "materialTitle", mc.content,
           mc."pageNumber", mc."startSeconds", mc."endSeconds",
           1 - (mc.embedding <=> ${vectorLiteral}::vector) AS similarity
    FROM "MaterialChunk" mc
    JOIN "Material" m ON m.id = mc."materialId"
    WHERE mc."materialId" IN (${Prisma.join(materialIds)}) AND mc.embedding IS NOT NULL
    ORDER BY mc.embedding <=> ${vectorLiteral}::vector ASC
    LIMIT ${limit}
  `;

  return rows;
}
