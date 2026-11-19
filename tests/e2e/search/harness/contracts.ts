/**
 * Runtime contracts, type guards, and assertion utilities for Phase 12 E2E Search tests.
 * Matches specifications in PROJECT.md § Interface Contracts.
 */

export const VALID_ENTITY_TYPES = [
  "subject",
  "chapter",
  "topic",
  "material",
  "note",
  "group",
  "flashcard",
] as const;

export type EntityType = (typeof VALID_ENTITY_TYPES)[number];

export const VALID_SEARCH_MODES = ["hybrid", "lexical", "semantic"] as const;
export type SearchMode = (typeof VALID_SEARCH_MODES)[number];

export interface SearchHitHierarchy {
  subjectId?: string;
  subjectName?: string;
  chapterId?: string;
  chapterName?: string;
  topicId?: string;
  topicName?: string;
  groupId?: string;
  groupName?: string;
}

export interface SearchHitNavigation {
  href: string;
  pageNumber?: number;
  timestampSeconds?: number;
}

export interface SearchHit {
  id: string;
  entityType: EntityType;
  title: string;
  snippet?: string;
  matchType: SearchMode;
  score: number;
  hierarchy: SearchHitHierarchy;
  navigation: SearchHitNavigation;
}

export interface SearchApiResponse {
  query: string;
  mode: SearchMode;
  total: number;
  limit: number;
  offset: number;
  hits: SearchHit[];
  counts: Record<string, number>;
}

export interface UserSearchScope {
  userId: string;
  personalWorkspaceId: string;
  activeGroupIds: string[];
}

/**
 * Validates whether an object complies with the SearchHit contract.
 */
export function validateSearchHit(hit: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!hit || typeof hit !== "object") {
    return { valid: false, errors: ["SearchHit must be a non-null object"] };
  }

  const h = hit as Record<string, unknown>;

  if (typeof h.id !== "string" || h.id.trim() === "") {
    errors.push("SearchHit.id must be a non-empty string");
  }

  if (!VALID_ENTITY_TYPES.includes(h.entityType as EntityType)) {
    errors.push(
      `SearchHit.entityType must be one of: ${VALID_ENTITY_TYPES.join(", ")}, received: ${String(h.entityType)}`
    );
  }

  if (typeof h.title !== "string") {
    errors.push("SearchHit.title must be a string");
  }

  if (h.snippet !== undefined && typeof h.snippet !== "string") {
    errors.push("SearchHit.snippet, if present, must be a string");
  }

  if (!VALID_SEARCH_MODES.includes(h.matchType as SearchMode)) {
    errors.push(
      `SearchHit.matchType must be one of: ${VALID_SEARCH_MODES.join(", ")}, received: ${String(h.matchType)}`
    );
  }

  if (typeof h.score !== "number" || isNaN(h.score) || h.score < 0) {
    errors.push("SearchHit.score must be a non-negative number");
  }

  if (!h.hierarchy || typeof h.hierarchy !== "object") {
    errors.push("SearchHit.hierarchy must be an object");
  }

  if (!h.navigation || typeof h.navigation !== "object") {
    errors.push("SearchHit.navigation must be an object");
  } else {
    const nav = h.navigation as Record<string, unknown>;
    if (typeof nav.href !== "string" || !nav.href.startsWith("/")) {
      errors.push("SearchHit.navigation.href must be a relative URL path starting with '/'");
    }
    if (nav.pageNumber !== undefined && (typeof nav.pageNumber !== "number" || nav.pageNumber < 1)) {
      errors.push("SearchHit.navigation.pageNumber must be a positive integer if defined");
    }
    if (
      nav.timestampSeconds !== undefined &&
      (typeof nav.timestampSeconds !== "number" || nav.timestampSeconds < 0)
    ) {
      errors.push("SearchHit.navigation.timestampSeconds must be a non-negative number if defined");
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates whether an object complies with the SearchApiResponse contract.
 */
export function validateSearchApiResponse(res: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!res || typeof res !== "object") {
    return { valid: false, errors: ["SearchApiResponse must be a non-null object"] };
  }

  const r = res as Record<string, unknown>;

  if (typeof r.query !== "string") {
    errors.push("SearchApiResponse.query must be a string");
  }

  if (!VALID_SEARCH_MODES.includes(r.mode as SearchMode)) {
    errors.push(
      `SearchApiResponse.mode must be one of: ${VALID_SEARCH_MODES.join(", ")}, received: ${String(r.mode)}`
    );
  }

  if (typeof r.total !== "number" || r.total < 0 || !Number.isInteger(r.total)) {
    errors.push("SearchApiResponse.total must be a non-negative integer");
  }

  if (typeof r.limit !== "number" || r.limit < 1 || !Number.isInteger(r.limit)) {
    errors.push("SearchApiResponse.limit must be a positive integer");
  }

  if (typeof r.offset !== "number" || r.offset < 0 || !Number.isInteger(r.offset)) {
    errors.push("SearchApiResponse.offset must be a non-negative integer");
  }

  if (!Array.isArray(r.hits)) {
    errors.push("SearchApiResponse.hits must be an array");
  } else {
    r.hits.forEach((hit, idx) => {
      const hitRes = validateSearchHit(hit);
      if (!hitRes.valid) {
        errors.push(`SearchApiResponse.hits[${idx}] has errors: ${hitRes.errors.join("; ")}`);
      }
    });
  }

  if (!r.counts || typeof r.counts !== "object" || Array.isArray(r.counts)) {
    errors.push("SearchApiResponse.counts must be a record/object");
  } else {
    const counts = r.counts as Record<string, unknown>;
    for (const [key, val] of Object.entries(counts)) {
      if (typeof val !== "number" || val < 0 || !Number.isInteger(val)) {
        errors.push(`SearchApiResponse.counts[${key}] must be a non-negative integer`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Runtime Type Guard for SearchHit
 */
export function isSearchHit(hit: unknown): hit is SearchHit {
  return validateSearchHit(hit).valid;
}

/**
 * Runtime Type Guard for SearchApiResponse
 */
export function isSearchApiResponse(res: unknown): res is SearchApiResponse {
  return validateSearchApiResponse(res).valid;
}

/**
 * Assertion helper throwing if response violates contract.
 */
export function assertSearchApiResponse(res: unknown): asserts res is SearchApiResponse {
  const result = validateSearchApiResponse(res);
  if (!result.valid) {
    throw new Error(`SearchApiResponse contract violation:\n- ${result.errors.join("\n- ")}`);
  }
}

/**
 * Assertion helper throwing if search hit violates contract.
 */
export function assertSearchHit(hit: unknown): asserts hit is SearchHit {
  const result = validateSearchHit(hit);
  if (!result.valid) {
    throw new Error(`SearchHit contract violation:\n- ${result.errors.join("\n- ")}`);
  }
}

/**
 * Asserts that no hits in response belong to forbidden entities or workspaces.
 */
export function assertNoEntityLeak(
  response: SearchApiResponse,
  forbiddenIds: string[],
  forbiddenGroupIds: string[] = []
): void {
  for (const hit of response.hits) {
    if (forbiddenIds.includes(hit.id)) {
      throw new Error(`Security Leak: hit id "${hit.id}" belongs to forbidden id list`);
    }
    if (hit.hierarchy.groupId && forbiddenGroupIds.includes(hit.hierarchy.groupId)) {
      throw new Error(
        `Security Leak: hit "${hit.id}" belongs to forbidden groupId "${hit.hierarchy.groupId}"`
      );
    }
    if (forbiddenIds.some((fid) => hit.title.toLowerCase().includes(fid.toLowerCase()))) {
      throw new Error(`Security Leak: title contains forbidden token`);
    }
    if (hit.snippet && forbiddenIds.some((fid) => hit.snippet?.toLowerCase().includes(fid.toLowerCase()))) {
      throw new Error(`Security Leak: snippet contains forbidden token`);
    }
  }
}

/**
 * Calculates Reciprocal Rank Fusion (RRF) score for a document given its ranks.
 * Formula: score = sum( 1 / (k + rank_i) ) where k=60 by default.
 * Ranks are 1-based.
 */
export function calculateRRFScore(
  lexicalRank: number | null,
  semanticRank: number | null,
  k: number = 60
): number {
  let score = 0;
  if (lexicalRank !== null && lexicalRank > 0) {
    score += 1 / (k + lexicalRank);
  }
  if (semanticRank !== null && semanticRank > 0) {
    score += 1 / (k + semanticRank);
  }
  return score;
}
