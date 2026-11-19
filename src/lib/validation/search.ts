/**
 * src/lib/validation/search.ts
 *
 * Zod validation schemas and query parameter parsing helpers for
 * Zenote Phase 12 Unified Global & Semantic Search (GET /api/search).
 */

import { z } from "zod";

export const VALID_SEARCH_MODES = ["hybrid", "lexical", "semantic"] as const;
export type SearchMode = (typeof VALID_SEARCH_MODES)[number];

export const VALID_SEARCH_ENTITY_TYPES = [
  "subject",
  "chapter",
  "topic",
  "material",
  "note",
  "group",
  "flashcard",
] as const;
export type SearchEntityType = (typeof VALID_SEARCH_ENTITY_TYPES)[number];

/**
 * 1. Query String ('q'):
 * - Required, trimmed, min 2 chars, max 200 chars.
 */
export const searchQueryStringSchema = z.preprocess(
  (val) => (typeof val === "string" ? val.trim() : val),
  z
    .string({
      required_error: "Query parameter 'q' must have at least 2 characters",
      invalid_type_error: "Query parameter 'q' must have at least 2 characters",
    })
    .min(2, "Query parameter 'q' must have at least 2 characters")
    .max(200, "Query parameter 'q' must not exceed 200 characters")
);

/**
 * 2. Search Mode ('mode'):
 * - Optional, defaults to "hybrid".
 * - Allowed: "hybrid" | "lexical" | "semantic".
 */
export const searchModeSchema = z.preprocess(
  (val) => (val === undefined || val === null || val === "" ? "hybrid" : val),
  z
    .enum(VALID_SEARCH_MODES, {
      errorMap: () => ({
        message: "Invalid mode. Allowed: hybrid, lexical, semantic",
      }),
    })
    .default("hybrid")
);

/**
 * 3. Search Entity Types ('types'):
 * - Optional, accepts comma-separated string ("note,material") or string array.
 * - Normalized to lowercase.
 * - Explicitly rejects "quiz" with authoritative Phase 12 roadmap exclusion message.
 * - Validates all items against VALID_SEARCH_ENTITY_TYPES.
 * - Defaults to all 7 approved core entity types.
 */
export const searchTypesSchema = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === "") {
      return [...VALID_SEARCH_ENTITY_TYPES];
    }
    if (typeof val === "string") {
      const parts = val
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      return parts.length === 0 ? [...VALID_SEARCH_ENTITY_TYPES] : parts;
    }
    if (Array.isArray(val)) {
      const parts = val
        .flatMap((s) => (typeof s === "string" ? s.split(",") : s))
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean);
      return parts.length === 0 ? [...VALID_SEARCH_ENTITY_TYPES] : parts;
    }
    return val;
  },
  z
    .array(z.string())
    .default(() => [...VALID_SEARCH_ENTITY_TYPES])
    .superRefine((arr, ctx) => {
      if (!arr) return;
      for (const item of arr) {
        if (item === "quiz") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Entity type 'quiz' is formally excluded from Phase 12 search",
          });
          return;
        }
        if (!VALID_SEARCH_ENTITY_TYPES.includes(item as SearchEntityType)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid entity type '${item}'. Allowed: ${VALID_SEARCH_ENTITY_TYPES.join(", ")}`,
          });
          return;
        }
      }
    })
    .transform((arr) => arr as SearchEntityType[])
);

/**
 * 4. Pagination Limit ('limit'):
 * - Optional, defaults to 20.
 * - Clamped integer between 1 and 50.
 */
export const searchLimitSchema = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === "") return 20;
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (!/^-?\d+$/.test(trimmed)) return NaN;
      return parseInt(trimmed, 10);
    }
    if (typeof val === "number") {
      if (!Number.isInteger(val)) return NaN;
      return val;
    }
    return NaN;
  },
  z
    .number({
      required_error: "Limit must be an integer between 1 and 50",
      invalid_type_error: "Limit must be an integer between 1 and 50",
    })
    .int("Limit must be an integer between 1 and 50")
    .min(1, "Limit must be an integer between 1 and 50")
    .max(50, "Limit must be an integer between 1 and 50")
    .default(20)
);

/**
 * 5. Pagination Offset ('offset'):
 * - Optional, defaults to 0.
 * - Non-negative integer.
 */
export const searchOffsetSchema = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === "") return 0;
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (!/^-?\d+$/.test(trimmed)) return NaN;
      return parseInt(trimmed, 10);
    }
    if (typeof val === "number") {
      if (!Number.isInteger(val)) return NaN;
      return val;
    }
    return NaN;
  },
  z
    .number({
      required_error: "Offset must be a non-negative integer",
      invalid_type_error: "Offset must be a non-negative integer",
    })
    .int("Offset must be a non-negative integer")
    .min(0, "Offset must be a non-negative integer")
    .default(0)
);

/**
 * 6. Hierarchy Filter Parameters:
 * - groupId?, subjectId?, chapterId?, topicId?
 * - Trimmed strings, empty strings converted to undefined.
 * - Supports CUIDs as well as custom fixture identifiers (e.g. "subj-alice-bio").
 */
export const searchHierarchyIdSchema = z.preprocess(
  (val) => (typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined),
  z.string().optional()
);

/**
 * Main Search Query Parameter Schema
 */
export const searchQuerySchema = z.object({
  q: searchQueryStringSchema,
  mode: searchModeSchema,
  types: searchTypesSchema,
  limit: searchLimitSchema,
  offset: searchOffsetSchema,
  groupId: searchHierarchyIdSchema,
  subjectId: searchHierarchyIdSchema,
  chapterId: searchHierarchyIdSchema,
  topicId: searchHierarchyIdSchema,
});

export type SearchQueryParams = z.infer<typeof searchQuerySchema>;

/**
 * Standardized Validation Error Formatting
 */
export interface SearchValidationErrorResponse {
  error: string;
  details?: Record<string, string[]>;
}

export function formatSearchValidationError(error: z.ZodError): SearchValidationErrorResponse {
  const first = error.issues[0];
  const fieldErrors = error.flatten().fieldErrors;
  return {
    error: first?.message ?? "Invalid search query parameters",
    details: fieldErrors as Record<string, string[]>,
  };
}

export type SearchValidationResult =
  | { success: true; data: SearchQueryParams }
  | { success: false; error: string; details?: Record<string, string[]> };

/**
 * Helper to parse and validate search parameters from URLSearchParams
 */
export function validateSearchQueryParams(searchParams: URLSearchParams): SearchValidationResult {
  const rawTypes = searchParams.getAll("types");
  const rawObj: Record<string, unknown> = {
    q: searchParams.get("q") ?? undefined,
    mode: searchParams.get("mode") ?? undefined,
    types:
      rawTypes.length > 0
        ? rawTypes.length === 1
          ? rawTypes[0]
          : rawTypes
        : undefined,
    limit: searchParams.get("limit") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
    groupId: searchParams.get("groupId") ?? undefined,
    subjectId: searchParams.get("subjectId") ?? undefined,
    chapterId: searchParams.get("chapterId") ?? undefined,
    topicId: searchParams.get("topicId") ?? undefined,
  };

  const parsed = searchQuerySchema.safeParse(rawObj);
  if (!parsed.success) {
    const formatted = formatSearchValidationError(parsed.error);
    return {
      success: false,
      error: formatted.error,
      details: formatted.details,
    };
  }

  return {
    success: true,
    data: parsed.data,
  };
}

/**
 * Alias for validateSearchQueryParams to support varied caller conventions
 */
export const parseSearchQueryParams = validateSearchQueryParams;
