/**
 * src/lib/search/rrf-ranking.ts
 *
 * Reciprocal Rank Fusion (k=60) Hybrid Ranking Engine, Entity Deduplication,
 * Chunk Collapsing, Match Tagging, and Deep-Link Navigation Synthesis.
 */

import { materialSourceHref } from "@/lib/material-link";
import { extractContextualSnippet } from "./snippet-extractor";
import type { RawVectorHit } from "./vector-search";
import type { RawLexicalHit, SearchableEntityType } from "./lexical-search";

export interface SearchHit {
  id: string;
  entityType: SearchableEntityType;
  title: string;
  snippet?: string;
  matchType: "hybrid" | "lexical" | "semantic";
  score: number;
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
  navigation: {
    href: string;
    pageNumber?: number;
    timestampSeconds?: number;
  };
}

export interface RrfFuseParams {
  lexicalHits: RawLexicalHit[];
  vectorHits: RawVectorHit[];
  query?: string;
  k?: number;
  limit?: number;
  offset?: number;
}

/**
 * Builds canonical destination URL for SearchHit with deep-link support.
 */
export function buildNavigationHref(hit: {
  id: string;
  entityType: string;
  hierarchy: { subjectId?: string; chapterId?: string; topicId?: string; groupId?: string };
  pageNumber?: number | null;
  startSeconds?: number | null;
  customHref?: string;
}): string {
  // If specific chunk coordinates are present for a material, synthesize the deep link
  if (hit.entityType === "material" && (hit.pageNumber != null || hit.startSeconds != null)) {
    return materialSourceHref({
      materialId: hit.id,
      page: hit.pageNumber ?? undefined,
      timestampSeconds: hit.startSeconds ?? undefined,
    });
  }

  if (hit.customHref) return hit.customHref;

  const { id, entityType, hierarchy, pageNumber, startSeconds } = hit;

  switch (entityType) {
    case "subject":
      return `/subjects/${encodeURIComponent(id)}`;
    case "chapter":
      return hierarchy.subjectId
        ? `/subjects/${encodeURIComponent(hierarchy.subjectId)}/chapters/${encodeURIComponent(id)}`
        : `/subjects`;
    case "topic":
      return hierarchy.subjectId && hierarchy.chapterId
        ? `/subjects/${encodeURIComponent(hierarchy.subjectId)}/chapters/${encodeURIComponent(hierarchy.chapterId)}/topics/${encodeURIComponent(id)}`
        : `/subjects`;
    case "note":
      return hierarchy.subjectId && hierarchy.chapterId && hierarchy.topicId
        ? `/subjects/${encodeURIComponent(hierarchy.subjectId)}/chapters/${encodeURIComponent(hierarchy.chapterId)}/topics/${encodeURIComponent(hierarchy.topicId)}?tab=notes`
        : `/notes/${encodeURIComponent(id)}`;
    case "material":
      return materialSourceHref({
        materialId: id,
        page: pageNumber ?? undefined,
        timestampSeconds: startSeconds ?? undefined,
      });
    case "group":
      return `/groups/${encodeURIComponent(id)}`;
    case "flashcard":
      return `/flashcards/${encodeURIComponent(id)}`;
    default:
      return `/search`;
  }
}

/**
 * Reciprocal Rank Fusion (k=60) blending lexical and semantic candidate ranks:
 * RRF(d) = sum_{m in {lex, sem}} 1 / (60 + r_m(d))
 *
 * Collapses multiple chunks per entity to the minimum chunk rank, preserves
 * chunk coordinates (pageNumber, startSeconds), extracts contextual snippet,
 * and tags matchType ("hybrid", "lexical", "semantic").
 */
export function fuseRankings(params: RrfFuseParams): SearchHit[] {
  const { lexicalHits, vectorHits, query = "", k = 60, limit = 20, offset = 0 } = params;

  // 1. Assign 1-Based Ranks to Lexical Hits
  // Key: entityType:entityId
  const lexicalMap = new Map<string, { hit: RawLexicalHit; rank: number }>();
  lexicalHits.forEach((hit, index) => {
    const key = `${hit.entityType}:${hit.id}`;
    if (!lexicalMap.has(key)) {
      lexicalMap.set(key, { hit, rank: index + 1 });
    }
  });

  // 2. Chunk Collapsing: Group Vector Hits by Entity & Record Minimum Rank
  const vectorMap = new Map<
    string,
    {
      topChunk: RawVectorHit;
      minRank: number;
    }
  >();

  vectorHits.forEach((chunk, index) => {
    const key = `${chunk.entityType}:${chunk.entityId}`;
    const rank = index + 1;
    const existing = vectorMap.get(key);
    if (!existing) {
      vectorMap.set(key, { topChunk: chunk, minRank: rank });
    } else if (rank < existing.minRank) {
      existing.minRank = rank;
      existing.topChunk = chunk;
    }
  });

  // 3. Collect All Distinct Entities Across Channels
  const allEntityKeys = new Set<string>([...lexicalMap.keys(), ...vectorMap.keys()]);

  // 4. Compute RRF Score and Construct Fused Hits
  const fused: SearchHit[] = [];

  for (const key of allEntityKeys) {
    const lex = lexicalMap.get(key);
    const vec = vectorMap.get(key);

    const hasLex = lex !== undefined;
    const hasVec = vec !== undefined;

    let score = 0;
    if (hasLex) {
      score += 1 / (k + lex.rank);
    }
    if (hasVec) {
      score += 1 / (k + vec.minRank);
    }

    const matchType: "hybrid" | "lexical" | "semantic" =
      hasLex && hasVec ? "hybrid" : hasLex ? "lexical" : "semantic";

    // Extract attributes: prefer lexical for title/hierarchy, vector for chunk coordinates
    const primary = lex ? lex.hit : vec!.topChunk;
    const id = lex ? lex.hit.id : vec!.topChunk.entityId;
    const entityType = primary.entityType as SearchableEntityType;
    const title = primary.title;
    const hierarchy = primary.hierarchy;

    const pageNumber = vec?.topChunk.pageNumber ?? undefined;
    const startSeconds = vec?.topChunk.startSeconds ?? undefined;

    // Snippet extraction
    let snippet: string | undefined;
    if (vec?.topChunk.chunkContent) {
      snippet = extractContextualSnippet(vec.topChunk.chunkContent, query);
    } else if (lex?.hit.snippetSourceText) {
      snippet = extractContextualSnippet(lex.hit.snippetSourceText, query);
    }

    const hasCoordinates =
      entityType === "material" &&
      (pageNumber != null || startSeconds != null);
    const href = buildNavigationHref({
      id,
      entityType,
      hierarchy,
      pageNumber,
      startSeconds,
      customHref: hasCoordinates ? undefined : lex?.hit.navigation?.href,
    });

    fused.push({
      id,
      entityType,
      title,
      snippet,
      matchType,
      score: Number(score.toFixed(6)),
      hierarchy: {
        subjectId: hierarchy.subjectId,
        subjectName: hierarchy.subjectName,
        chapterId: hierarchy.chapterId,
        chapterName: hierarchy.chapterName,
        topicId: hierarchy.topicId,
        topicName: hierarchy.topicName,
        groupId: hierarchy.groupId,
        groupName: hierarchy.groupName,
      },
      navigation: {
        href,
        pageNumber,
        timestampSeconds: startSeconds,
      },
    });
  }

  // 5. Sort Descending by Fused Score (Tie-Break: Hybrid first, then lower rank, then ID)
  fused.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.matchType === "hybrid" && b.matchType !== "hybrid") return -1;
    if (b.matchType === "hybrid" && a.matchType !== "hybrid") return 1;
    return a.id.localeCompare(b.id);
  });

  // 6. Pagination Slice
  return fused.slice(offset, offset + limit);
}
