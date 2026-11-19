/**
 * src/app/api/search/route.ts
 *
 * Phase 12 Milestone 3: Unified Global & Semantic Search API Route Handler.
 * Integrates lexical search (PostgreSQL GIN full-text search) and semantic search
 * (pgvector cosine distance) using Reciprocal Rank Fusion (k=60).
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import { resolveUserSearchScope } from "@/lib/search/search-access";
import {
  executeLexicalSearch,
  buildLexicalNavigationHref,
  type SearchableEntityType,
} from "@/lib/search/lexical-search";
import {
  executeVectorSearch,
  type RawVectorHit,
} from "@/lib/search/vector-search";
import {
  fuseRankings,
  buildNavigationHref,
  type SearchHit,
} from "@/lib/search/rrf-ranking";
import { extractContextualSnippet } from "@/lib/search/snippet-extractor";
import {
  validateSearchQueryParams,
  type SearchMode,
} from "@/lib/validation/search";
import { logServerError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export interface SearchApiResponse {
  query: string;
  mode: SearchMode;
  total: number;
  limit: number;
  offset: number;
  hits: SearchHit[];
  counts: Record<string, number>;
}

function sanitizeSnippetSource(text?: string | null): string {
  if (!text) return "";
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createEmptyResponse(
  query: string,
  mode: SearchMode,
  limit: number,
  offset: number
): SearchApiResponse {
  return {
    query,
    mode,
    total: 0,
    limit,
    offset,
    hits: [],
    counts: {
      subject: 0,
      chapter: 0,
      topic: 0,
      material: 0,
      note: 0,
      group: 0,
      flashcard: 0,
    },
  };
}

export async function GET(req: Request) {
  try {
    // 1. Session Authentication Guard
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Query Parameter Validation via Zod
    const url = new URL(req.url);
    const validation = validateSearchQueryParams(url.searchParams);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error, details: validation.details },
        { status: 400 }
      );
    }

    const {
      q,
      mode,
      types,
      limit,
      offset,
      groupId,
      subjectId,
      chapterId,
      topicId,
    } = validation.data;

    // 3. User Search Scope Resolution
    let scope;
    try {
      scope = await resolveUserSearchScope(user.id);
    } catch (scopeError) {
      if (
        scopeError instanceof Error &&
        (scopeError.message.includes("No primary workspace") ||
          scopeError.message.includes("workspace") ||
          scopeError.message.includes("orphan"))
      ) {
        return NextResponse.json(createEmptyResponse(q, mode, limit, offset));
      }
      throw scopeError;
    }

    // Fail-closed tenancy check: if explicit groupId requested and user is not an active member
    if (groupId && !scope.activeGroupIds.includes(groupId)) {
      return NextResponse.json(createEmptyResponse(q, mode, limit, offset));
    }

    // 4. Candidate Pool Sizing
    const candidateLimit = Math.max(limit + offset, 50);

    let allScoredHits: SearchHit[] = [];

    // 5. Mode Execution
    if (mode === "lexical") {
      const rawLexicalHits = await executeLexicalSearch({
        query: q,
        scope,
        types: types as SearchableEntityType[],
        groupId,
        subjectId,
        chapterId,
        topicId,
        limit: candidateLimit,
      });

      const seen = new Set<string>();
      for (const hit of rawLexicalHits) {
        const key = `${hit.entityType}:${hit.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          const cleanSource = sanitizeSnippetSource(hit.snippetSourceText);
          const snippet = extractContextualSnippet(cleanSource, q, {
            targetLength: 160,
          });
          allScoredHits.push({
            id: hit.id,
            entityType: hit.entityType,
            title: hit.title,
            snippet: snippet || undefined,
            matchType: "lexical",
            score: Number(hit.rankScore.toFixed(6)),
            hierarchy: hit.hierarchy,
            navigation: {
              href:
                hit.navigation?.href ||
                buildLexicalNavigationHref(hit.entityType, hit.id, hit.hierarchy),
              pageNumber: hit.navigation?.pageNumber,
              timestampSeconds: hit.navigation?.timestampSeconds,
            },
          });
        }
      }
      allScoredHits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    } else if (mode === "semantic") {
      const vectorTypes = types.filter(
        (t) => t === "material" || t === "note"
      ) as ("material" | "note")[];

      if (vectorTypes.length === 0) {
        return NextResponse.json(createEmptyResponse(q, mode, limit, offset));
      }

      let rawVectorHits: RawVectorHit[] = [];
      try {
        rawVectorHits = await executeVectorSearch({
          query: q,
          scope,
          types: vectorTypes,
          groupId,
          subjectId,
          chapterId,
          topicId,
          limit: candidateLimit,
        });
      } catch (err) {
        console.warn("[search/route] Semantic vector retrieval failed, returning empty:", err);
        rawVectorHits = [];
      }

      // Chunk collapsing: top chunk per (entityType, entityId)
      const entityMap = new Map<string, RawVectorHit>();
      for (const chunk of rawVectorHits) {
        const key = `${chunk.entityType}:${chunk.entityId}`;
        const existing = entityMap.get(key);
        if (!existing || chunk.similarityScore > existing.similarityScore) {
          entityMap.set(key, chunk);
        }
      }

      for (const chunk of entityMap.values()) {
        const cleanContent = sanitizeSnippetSource(chunk.chunkContent);
        const snippet = extractContextualSnippet(cleanContent, q, {
          targetLength: 160,
        });
        const href = buildNavigationHref({
          id: chunk.entityId,
          entityType: chunk.entityType,
          hierarchy: chunk.hierarchy,
          pageNumber: chunk.pageNumber ?? undefined,
          startSeconds: chunk.startSeconds ?? undefined,
        });

        allScoredHits.push({
          id: chunk.entityId,
          entityType: chunk.entityType,
          title: chunk.title,
          snippet: snippet || undefined,
          matchType: "semantic",
          score: Number(chunk.similarityScore.toFixed(6)),
          hierarchy: chunk.hierarchy,
          navigation: {
            href,
            pageNumber: chunk.pageNumber ?? undefined,
            timestampSeconds: chunk.startSeconds ?? undefined,
          },
        });
      }
      allScoredHits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    } else {
      // mode === "hybrid"
      const vectorTypes = types.filter(
        (t) => t === "material" || t === "note"
      ) as ("material" | "note")[];

      const [lexResult, vecResult] = await Promise.allSettled([
        executeLexicalSearch({
          query: q,
          scope,
          types: types as SearchableEntityType[],
          groupId,
          subjectId,
          chapterId,
          topicId,
          limit: candidateLimit,
        }),
        vectorTypes.length > 0
          ? executeVectorSearch({
              query: q,
              scope,
              types: vectorTypes,
              groupId,
              subjectId,
              chapterId,
              topicId,
              limit: candidateLimit,
            })
          : Promise.resolve([]),
      ]);

      if (lexResult.status === "rejected") {
        throw lexResult.reason;
      }

      const lexicalHits = lexResult.value;
      const vectorHits =
        vecResult.status === "fulfilled"
          ? vecResult.value
          : (console.warn(
              "[search/route] Vector search failed in hybrid mode, falling back to lexical:",
              vecResult.reason
            ),
            []);

      const sanitizedLexicalHits = lexicalHits.map((h) => ({
        ...h,
        snippetSourceText: sanitizeSnippetSource(h.snippetSourceText),
      }));
      const sanitizedVectorHits = vectorHits.map((c) => ({
        ...c,
        chunkContent: sanitizeSnippetSource(c.chunkContent),
      }));

      allScoredHits = fuseRankings({
        lexicalHits: sanitizedLexicalHits,
        vectorHits: sanitizedVectorHits,
        query: q,
        k: 60,
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
      });
    }

    // 6. Global Counts & Pagination
    const total = allScoredHits.length;
    const counts: Record<string, number> = {
      subject: 0,
      chapter: 0,
      topic: 0,
      material: 0,
      note: 0,
      group: 0,
      flashcard: 0,
    };
    for (const hit of allScoredHits) {
      counts[hit.entityType] = (counts[hit.entityType] ?? 0) + 1;
    }

    const hits = allScoredHits.slice(offset, offset + limit);

    return NextResponse.json({
      query: q,
      mode,
      total,
      limit,
      offset,
      hits,
      counts,
    });
  } catch (error) {
    logServerError({ route: "search/unified" }, error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
