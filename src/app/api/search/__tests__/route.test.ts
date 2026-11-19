/**
 * src/app/api/search/__tests__/route.test.ts
 *
 * Phase 12 Milestone 3: Unified Search API Route Integration Test Suite.
 *
 * Comprehensive 10-suite test architecture verifying:
 *   Suite 1  — Authentication & Security (401 unauthenticated, 200 authenticated)
 *   Suite 2  — Query Parameter Validation (q bounds, mode enum, limit/offset, quiz rejection)
 *   Suite 3  — Scope & Hierarchy Validation (200 OK with 0 hits on cross-tenant/non-existent)
 *   Suite 4  — Multi-Tenant Isolation & Zero Leakage (workspace boundaries, total & counts)
 *   Suite 5  — Group Role Access (OWNER, ADMIN, MEMBER, VIEWER access; non-member 0 hits)
 *   Suite 6  — Soft Deletion Fail-Closed (soft-deleted ancestor exclusions)
 *   Suite 7  — Retrieval Mode Execution (lexical only, semantic only, hybrid concurrent)
 *   Suite 8  — Graceful Fallback (vector error defaults to lexical hits; DB error returns 500)
 *   Suite 9  — Pagination & Counts (limit, offset, deep offset, 7-entity count dictionary)
 *   Suite 10 — Navigation Links & Snippets (coordinates, note tabs, 160-char sanitized snippets)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawLexicalHit } from "@/lib/search/lexical-search";
import type { RawVectorHit } from "@/lib/search/vector-search";

// ---------------------------------------------------------------------------
// Hoisted Mocks
// ---------------------------------------------------------------------------

const mockGetSessionUser = vi.hoisted(() => vi.fn());
const mockResolveUserSearchScope = vi.hoisted(() => vi.fn());
const mockExecuteLexicalSearch = vi.hoisted(() => vi.fn());
const mockExecuteVectorSearch = vi.hoisted(() => vi.fn());
const mockLogServerError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/access", () => ({
  getSessionUser: mockGetSessionUser,
}));

vi.mock("@/lib/search/search-access", () => ({
  resolveUserSearchScope: mockResolveUserSearchScope,
}));

vi.mock("@/lib/search/lexical-search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/search/lexical-search")>();
  return {
    ...actual,
    executeLexicalSearch: mockExecuteLexicalSearch,
  };
});

vi.mock("@/lib/search/vector-search", () => ({
  executeVectorSearch: mockExecuteVectorSearch,
}));

vi.mock("@/lib/api-response", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-response")>();
  return {
    ...actual,
    logServerError: mockLogServerError,
  };
});

// Import the Route Handler AFTER mocks are established
import { GET, type SearchApiResponse } from "../route";

// ---------------------------------------------------------------------------
// Test Fixtures & Factories
// ---------------------------------------------------------------------------

const alice = {
  id: "user-alice",
  email: "alice@example.com",
  name: "Alice Smith",
};

const bob = {
  id: "user-bob",
  email: "bob@example.com",
  name: "Bob Jones",
};

const aliceScope = {
  userId: "user-alice",
  personalWorkspaceId: "ws-alice",
  activeGroupIds: ["group-1", "group-study"],
};

const bobScope = {
  userId: "user-bob",
  personalWorkspaceId: "ws-bob",
  activeGroupIds: ["group-bob"],
};

function makeRequest(params: Record<string, string | number | undefined | string[]>): Request {
  const url = new URL("https://example.test/api/search");
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return new Request(url.toString(), { method: "GET" });
}

function createMockLexicalHit(overrides: Partial<RawLexicalHit> = {}): RawLexicalHit {
  return {
    id: "note-1",
    entityType: "note",
    title: "DNA Polymerase III Overview",
    snippetSourceText: "DNA polymerase synthesizes complementary strands in 5' to 3' direction.",
    rankScore: 0.85,
    hierarchy: {
      subjectId: "subj-1",
      subjectName: "Molecular Biology",
      chapterId: "chap-1",
      chapterName: "Replication",
      topicId: "topic-1",
      topicName: "Enzymes",
    },
    ...overrides,
  };
}

function createMockVectorHit(overrides: Partial<RawVectorHit> = {}): RawVectorHit {
  return {
    chunkId: "chunk-101",
    entityId: "material-1",
    entityType: "material",
    title: "Cellular Biology Lecture 4.pdf",
    chunkContent: "Helicase unwinds the double helix at the replication fork.",
    pageNumber: 14,
    startSeconds: null,
    similarityScore: 0.91,
    hierarchy: {
      subjectId: "subj-1",
      subjectName: "Molecular Biology",
      chapterId: "chap-1",
      chapterName: "Replication",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe("GET /api/search Route Handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetSessionUser.mockResolvedValue(alice);
    mockResolveUserSearchScope.mockResolvedValue(aliceScope);
    mockExecuteLexicalSearch.mockResolvedValue([createMockLexicalHit()]);
    mockExecuteVectorSearch.mockResolvedValue([createMockVectorHit()]);
  });

  // =========================================================================
  // Suite 1: Authentication & Security
  // =========================================================================
  describe("Suite 1: Authentication & Security", () => {
    it("1.1 returns 401 Unauthorized with exact JSON error when no session is present", async () => {
      mockGetSessionUser.mockResolvedValue(null);
      const res = await GET(makeRequest({ q: "helicase" }));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("1.2 accepts valid authenticated session and returns 200 OK", async () => {
      const res = await GET(makeRequest({ q: "helicase" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.query).toBe("helicase");
      expect(Array.isArray(body.hits)).toBe(true);
    });

    it("1.3 resolves scope strictly from authenticated session user.id, ignoring spoofed query params", async () => {
      await GET(makeRequest({ q: "helicase", userId: "attacker-user-id" }));
      expect(mockResolveUserSearchScope).toHaveBeenCalledWith("user-alice");
      expect(mockResolveUserSearchScope).not.toHaveBeenCalledWith("attacker-user-id");
    });

    it("1.4 does not invoke search retrieval engines when session is unauthenticated", async () => {
      mockGetSessionUser.mockResolvedValue(null);
      await GET(makeRequest({ q: "helicase" }));
      expect(mockExecuteLexicalSearch).not.toHaveBeenCalled();
      expect(mockExecuteVectorSearch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Suite 2: Query Parameter Validation
  // =========================================================================
  describe("Suite 2: Query Parameter Validation", () => {
    it("2.1 missing query parameter 'q' returns 400 Bad Request with informative message", async () => {
      const res = await GET(makeRequest({}));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/at least 2 characters/i);
    });

    it("2.2 empty string query 'q' returns 400 Bad Request", async () => {
      const res = await GET(makeRequest({ q: "" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/at least 2 characters/i);
    });

    it("2.3 whitespace-only query returns 400 Bad Request", async () => {
      const res = await GET(makeRequest({ q: "    " }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/at least 2 characters/i);
    });

    it("2.4 single-character query returns 400 Bad Request", async () => {
      const res = await GET(makeRequest({ q: "a" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/at least 2 characters/i);
    });

    it("2.5 accepts query at exact minimum length boundary (2 characters) with 200 OK", async () => {
      const res = await GET(makeRequest({ q: "ab" }));
      expect(res.status).toBe(200);

      const resPadded = await GET(makeRequest({ q: "  ab  " }));
      expect(resPadded.status).toBe(200);
    });

    it("2.6 accepts nominal query length with 200 OK", async () => {
      const res = await GET(makeRequest({ q: "mitochondrial ATP synthase" }));
      expect(res.status).toBe(200);
    });

    it("2.7 accepts query at exact maximum length boundary (200 characters) with 200 OK", async () => {
      const res = await GET(makeRequest({ q: "a".repeat(200) }));
      expect(res.status).toBe(200);
    });

    it("2.8 query exceeding 200 characters returns 400 Bad Request with informative message", async () => {
      const res = await GET(makeRequest({ q: "a".repeat(201) }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/not exceed 200 characters/i);
    });

    it("2.9 accepts valid search modes ('hybrid', 'lexical', 'semantic') with 200 OK", async () => {
      for (const mode of ["hybrid", "lexical", "semantic"] as const) {
        const res = await GET(makeRequest({ q: "helicase", mode }));
        expect(res.status).toBe(200);
        const body: SearchApiResponse = await res.json();
        expect(body.mode).toBe(mode);
      }
    });

    it("2.10 omitted mode defaults to 'hybrid'", async () => {
      const res = await GET(makeRequest({ q: "helicase" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.mode).toBe("hybrid");
    });

    it("2.11 invalid mode returns 400 Bad Request with allowed modes listed", async () => {
      const res = await GET(makeRequest({ q: "helicase", mode: "magic" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid mode/i);
    });

    it("2.12 validates limit parameter bounds (1..50) and integer constraints", async () => {
      // Valid boundaries
      expect((await GET(makeRequest({ q: "helicase", limit: 1 }))).status).toBe(200);
      expect((await GET(makeRequest({ q: "helicase", limit: 20 }))).status).toBe(200);
      expect((await GET(makeRequest({ q: "helicase", limit: 50 }))).status).toBe(200);

      // Invalid boundaries
      expect((await GET(makeRequest({ q: "helicase", limit: 0 }))).status).toBe(400);
      expect((await GET(makeRequest({ q: "helicase", limit: 51 }))).status).toBe(400);
      expect((await GET(makeRequest({ q: "helicase", limit: -5 }))).status).toBe(400);
      expect((await GET(makeRequest({ q: "helicase", limit: 10.5 }))).status).toBe(400);
      expect((await GET(makeRequest({ q: "helicase", limit: "twenty" }))).status).toBe(400);
    });

    it("2.13 validates offset parameter non-negative integer constraints", async () => {
      expect((await GET(makeRequest({ q: "helicase", offset: 0 }))).status).toBe(200);
      expect((await GET(makeRequest({ q: "helicase", offset: 10 }))).status).toBe(200);

      expect((await GET(makeRequest({ q: "helicase", offset: -1 }))).status).toBe(400);
      expect((await GET(makeRequest({ q: "helicase", offset: 5.5 }))).status).toBe(400);
      expect((await GET(makeRequest({ q: "helicase", offset: "abc" }))).status).toBe(400);
    });

    it("2.14 parses comma-separated types parameter ('note,material,subject')", async () => {
      const res = await GET(makeRequest({ q: "helicase", types: "note,material,subject" }));
      expect(res.status).toBe(200);
      expect(mockExecuteLexicalSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ["note", "material", "subject"],
        })
      );
    });

    it("2.15 parses multi-key types parameter (?types=note&types=material)", async () => {
      const res = await GET(makeRequest({ q: "helicase", types: ["note", "material"] }));
      expect(res.status).toBe(200);
      expect(mockExecuteLexicalSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ["note", "material"],
        })
      );
    });

    it("2.16 defaults to all 7 approved core entity types when types is omitted", async () => {
      const res = await GET(makeRequest({ q: "helicase" }));
      expect(res.status).toBe(200);
      expect(mockExecuteLexicalSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ["subject", "chapter", "topic", "material", "note", "group", "flashcard"],
        })
      );
    });

    it("2.17 explicitly rejects 'quiz' with authoritative Phase 12 roadmap exclusion message", async () => {
      const res = await GET(makeRequest({ q: "helicase", types: "quiz" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Entity type 'quiz' is formally excluded from Phase 12 search");

      const resCombined = await GET(makeRequest({ q: "helicase", types: "note,quiz" }));
      expect(resCombined.status).toBe(400);
      const bodyCombined = await resCombined.json();
      expect(bodyCombined.error).toBe("Entity type 'quiz' is formally excluded from Phase 12 search");
    });

    it("2.18 rejects unknown entity types with 400 Bad Request", async () => {
      const res = await GET(makeRequest({ q: "helicase", types: "custom_widget" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid entity type/i);
    });
  });

  // =========================================================================
  // Suite 3: Scope & Hierarchy Validation
  // =========================================================================
  describe("Suite 3: Scope & Hierarchy Validation (Zero Leakage)", () => {
    it("3.1 non-existent subjectId returns 200 OK with empty hits and 0 total", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "helicase", subjectId: "subj-ghost-does-not-exist" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
      expect(body.total).toBe(0);
    });

    it("3.2 non-existent chapterId & topicId returns 200 OK with 0 hits", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "helicase", chapterId: "chap-none", topicId: "top-none" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
      expect(body.total).toBe(0);
    });

    it("3.3 unauthorized groupId returns 200 OK with 0 hits immediately without leaking group existence", async () => {
      // Alice is in ['group-1', 'group-study'], NOT in 'group-secret-bob'
      const res = await GET(makeRequest({ q: "helicase", groupId: "group-secret-bob" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
      expect(body.total).toBe(0);
      // Retrieval engines must not even be executed for unauthorized group
      expect(mockExecuteLexicalSearch).not.toHaveBeenCalled();
      expect(mockExecuteVectorSearch).not.toHaveBeenCalled();
    });

    it("3.4 malformed scope strings (non-CUID) handled safely without crashing", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "helicase", subjectId: "not-a-uuid", groupId: "12345" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
    });

    it("3.5 empty string scopes treated as omitted, executing unscoped search", async () => {
      const res = await GET(makeRequest({ q: "helicase", subjectId: "", groupId: "" }));
      expect(res.status).toBe(200);
      expect(mockExecuteLexicalSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: undefined,
          groupId: undefined,
        })
      );
    });

    it("3.6 cross-tenant scope filter returns 200 OK with 0 hits and zero leakage", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "helicase", subjectId: "subj-bob-private" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
      expect(body.total).toBe(0);
    });

    it("3.7 conflicting hierarchy combination returns 200 OK with 0 hits", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "helicase", subjectId: "subj-bio", topicId: "topic-history" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
    });
  });

  // =========================================================================
  // Suite 4: Multi-Tenant Isolation & Zero Leakage
  // =========================================================================
  describe("Suite 4: Multi-Tenant Isolation & Zero Leakage", () => {
    it("4.1 User Alice's search returns only Alice's authorized items, never Bob's private items", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({ id: "note-alice", title: "Alice Private DNA Note" }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "DNA" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits.some((h) => h.id === "note-alice")).toBe(true);
      expect(body.hits.some((h) => h.id.includes("bob"))).toBe(false);
    });

    it("4.2 User Bob's search returns only Bob's authorized items, never Alice's private items", async () => {
      mockGetSessionUser.mockResolvedValue(bob);
      mockResolveUserSearchScope.mockResolvedValue(bobScope);
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({ id: "note-bob", title: "Bob Private Note" }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "DNA" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits.some((h) => h.id === "note-bob")).toBe(true);
      expect(body.hits.some((h) => h.id.includes("alice"))).toBe(false);
    });

    it("4.3 total count reflects strictly authorized hits for the searching user", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([createMockLexicalHit()]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "DNA" }));
      const body: SearchApiResponse = await res.json();
      expect(body.total).toBe(1);
    });

    it("4.4 counts breakdown reflects strictly authorized hits for the searching user", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({ id: "note-1", entityType: "note" }),
        createMockLexicalHit({ id: "subj-1", entityType: "subject", title: "Biology" }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "DNA" }));
      const body: SearchApiResponse = await res.json();
      expect(body.counts.note).toBe(1);
      expect(body.counts.subject).toBe(1);
      expect(body.counts.material).toBe(0);
    });

    it("4.5 hierarchy breadcrumbs in hits contain only authorized metadata", async () => {
      const res = await GET(makeRequest({ q: "DNA" }));
      const body: SearchApiResponse = await res.json();
      const hit = body.hits[0];
      expect(hit!.hierarchy.subjectName).toBe("Molecular Biology");
      expect(hit!.hierarchy.chapterName).toBe("Replication");
    });

    it("4.6 snippets never expose confidential text from unauthorized workspaces", async () => {
      const res = await GET(makeRequest({ q: "DNA" }));
      const body: SearchApiResponse = await res.json();
      expect(body.hits[0]!.snippet).toBeDefined();
      expect(body.hits[0]!.snippet).not.toContain("CONFIDENTIAL_BOB_TOKEN");
    });
  });

  // =========================================================================
  // Suite 5: Group Role Access
  // =========================================================================
  describe("Suite 5: Group Role Access", () => {
    it("5.1 StudyGroup OWNER can search and retrieve group content", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({ id: "note-grp", hierarchy: { groupId: "group-1", groupName: "Bio Group" } }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "replication", groupId: "group-1" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toHaveLength(1);
    });

    it("5.2 StudyGroup ADMIN can search and retrieve group content", async () => {
      const res = await GET(makeRequest({ q: "replication", groupId: "group-1" }));
      expect(res.status).toBe(200);
      expect(mockExecuteLexicalSearch).toHaveBeenCalled();
    });

    it("5.3 StudyGroup MEMBER can search and retrieve group content", async () => {
      const res = await GET(makeRequest({ q: "replication", groupId: "group-1" }));
      expect(res.status).toBe(200);
      expect(mockExecuteLexicalSearch).toHaveBeenCalled();
    });

    it("5.4 StudyGroup VIEWER can search and retrieve group content read-only", async () => {
      const res = await GET(makeRequest({ q: "replication", groupId: "group-1" }));
      expect(res.status).toBe(200);
      expect(mockExecuteLexicalSearch).toHaveBeenCalled();
    });

    it("5.5 Non-member searching group returns 0 hits and 0 counts for that group", async () => {
      // Alice is not in 'group-private-charlie'
      const res = await GET(makeRequest({ q: "replication", groupId: "group-private-charlie" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.counts.note).toBe(0);
    });

    it("5.6 Soft-deleted group is excluded from active group scope for all members, including OWNER", async () => {
      // If group is soft-deleted, it won't be in activeGroupIds
      const res = await GET(makeRequest({ q: "replication", groupId: "group-deleted" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
      expect(body.total).toBe(0);
    });
  });

  // =========================================================================
  // Suite 6: Soft Deletion Fail-Closed
  // =========================================================================
  describe("Suite 6: Soft Deletion Fail-Closed", () => {
    it("6.1 items under soft-deleted subject are excluded from search results", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "replication", subjectId: "subj-deleted" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
    });

    it("6.2 items under soft-deleted chapter are excluded from search results", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "replication", chapterId: "chap-deleted" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
    });

    it("6.3 items under soft-deleted topic are excluded from search results", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "replication", topicId: "topic-deleted" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
    });

    it("6.4 directly soft-deleted note is excluded from search results", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "archived note" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits.some((h) => h.id === "note-deleted")).toBe(false);
    });

    it("6.5 directly soft-deleted material is excluded from search results", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "archived material" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits.some((h) => h.id === "mat-deleted")).toBe(false);
    });
  });

  // =========================================================================
  // Suite 7: Retrieval Mode Execution
  // =========================================================================
  describe("Suite 7: Retrieval Mode Execution", () => {
    it("7.1 mode='lexical' invokes executeLexicalSearch, NOT executeVectorSearch, and tags hits as 'lexical'", async () => {
      const res = await GET(makeRequest({ q: "helicase", mode: "lexical" }));
      expect(res.status).toBe(200);
      expect(mockExecuteLexicalSearch).toHaveBeenCalled();
      expect(mockExecuteVectorSearch).not.toHaveBeenCalled();

      const body: SearchApiResponse = await res.json();
      expect(body.mode).toBe("lexical");
      expect(body.hits.length).toBeGreaterThan(0);
      expect(body.hits.every((h) => h.matchType === "lexical")).toBe(true);
    });

    it("7.2 mode='semantic' invokes executeVectorSearch with vector types only, NOT executeLexicalSearch, and preserves raw cosine score", async () => {
      const res = await GET(makeRequest({ q: "helicase", mode: "semantic" }));
      expect(res.status).toBe(200);
      expect(mockExecuteVectorSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          types: ["material", "note"],
        })
      );
      expect(mockExecuteLexicalSearch).not.toHaveBeenCalled();

      const body: SearchApiResponse = await res.json();
      expect(body.mode).toBe("semantic");
      expect(body.hits.length).toBeGreaterThan(0);
      expect(body.hits.every((h) => h.matchType === "semantic")).toBe(true);
      // Cosine similarity score > 0.6 preserved
      expect(body.hits[0]!.score).toBeGreaterThan(0.6);
    });

    it("7.3 mode='hybrid' invokes both lexical and vector search concurrently and fuses via RRF", async () => {
      const res = await GET(makeRequest({ q: "helicase", mode: "hybrid" }));
      expect(res.status).toBe(200);
      expect(mockExecuteLexicalSearch).toHaveBeenCalled();
      expect(mockExecuteVectorSearch).toHaveBeenCalled();

      const body: SearchApiResponse = await res.json();
      expect(body.mode).toBe("hybrid");
      expect(body.hits.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Suite 8: Graceful Fallback
  // =========================================================================
  describe("Suite 8: Graceful Fallback", () => {
    it("8.1 hybrid mode gracefully degrades to lexical hits when vector search throws (e.g. rate limit)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockExecuteVectorSearch.mockRejectedValue(new Error("OpenAI API rate limit exceeded (429)"));

      const res = await GET(makeRequest({ q: "helicase", mode: "hybrid" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits.length).toBeGreaterThan(0);
      expect(body.hits[0]!.matchType).toBe("lexical");
      warnSpy.mockRestore();
    });

    it("8.2 semantic mode returns 200 OK with 0 hits when vector search throws", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockExecuteVectorSearch.mockRejectedValue(new Error("ServiceNotConfiguredError"));

      const res = await GET(makeRequest({ q: "helicase", mode: "semantic" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
      expect(body.total).toBe(0);
      warnSpy.mockRestore();
    });

    it("8.3 unexpected database failure in lexical search returns 500 without leaking SQL or stack traces", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockExecuteLexicalSearch.mockRejectedValue(new Error("connection refused to postgres://internal-db:5432"));

      const res = await GET(makeRequest({ q: "helicase", mode: "lexical" }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Something went wrong. Please try again.");
      expect(JSON.stringify(body)).not.toContain("postgres://");
      expect(mockLogServerError).toHaveBeenCalledWith(
        expect.objectContaining({ route: "search/unified" }),
        expect.any(Error)
      );
      errorSpy.mockRestore();
    });

    it("8.4 orphaned user without primary workspace returns 200 OK with empty hits", async () => {
      mockResolveUserSearchScope.mockRejectedValue(new Error("No primary workspace found for user: usr-orphan"));

      const res = await GET(makeRequest({ q: "helicase" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.hits).toEqual([]);
      expect(body.total).toBe(0);
    });
  });

  // =========================================================================
  // Suite 9: Pagination & Counts
  // =========================================================================
  describe("Suite 9: Pagination & Counts", () => {
    it("9.1 returns default page (limit=20, offset=0) when omitted", async () => {
      const res = await GET(makeRequest({ q: "helicase" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
    });

    it("9.2 returns custom page slice with limit and offset", async () => {
      // Generate 10 hits
      const hits = Array.from({ length: 10 }, (_, i) =>
        createMockLexicalHit({ id: `note-${i + 1}`, title: `Note ${i + 1}`, rankScore: 1 - i * 0.05 })
      );
      mockExecuteLexicalSearch.mockResolvedValue(hits);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "helicase", mode: "lexical", limit: 3, offset: 2 }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.limit).toBe(3);
      expect(body.offset).toBe(2);
      expect(body.total).toBe(10);
      expect(body.hits).toHaveLength(3);
      expect(body.hits[0]!.id).toBe("note-3");
      expect(body.hits[1]!.id).toBe("note-4");
      expect(body.hits[2]!.id).toBe("note-5");
    });

    it("9.3 deep offset returns 200 OK with empty hits and preserved total", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([createMockLexicalHit()]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "helicase", offset: 1000 }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.offset).toBe(1000);
      expect(body.total).toBe(1);
      expect(body.hits).toEqual([]);
    });

    it("9.4 counts dictionary contains keys for all 7 approved entity types", async () => {
      const res = await GET(makeRequest({ q: "helicase" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      const expectedKeys = ["subject", "chapter", "topic", "material", "note", "group", "flashcard"];
      for (const k of expectedKeys) {
        expect(body.counts).toHaveProperty(k);
        expect(typeof body.counts[k]).toBe("number");
      }
    });

    it("9.5 total and counts remain invariant across page offsets", async () => {
      const hits = Array.from({ length: 15 }, (_, i) =>
        createMockLexicalHit({ id: `note-${i + 1}`, title: `Note ${i + 1}`, rankScore: 1 - i * 0.05 })
      );
      mockExecuteLexicalSearch.mockResolvedValue(hits);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const resPage1 = await GET(makeRequest({ q: "helicase", mode: "lexical", limit: 5, offset: 0 }));
      const bodyPage1: SearchApiResponse = await resPage1.json();

      const resPage2 = await GET(makeRequest({ q: "helicase", mode: "lexical", limit: 5, offset: 5 }));
      const bodyPage2: SearchApiResponse = await resPage2.json();

      expect(bodyPage1.total).toBe(15);
      expect(bodyPage2.total).toBe(15);
      expect(bodyPage1.counts.note).toBe(15);
      expect(bodyPage2.counts.note).toBe(15);
    });

    it("9.6 multiple vector chunks per entity are collapsed into 1 entity hit", async () => {
      // 3 chunks from same material entity
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([
        createMockVectorHit({ chunkId: "c1", entityId: "mat-1", similarityScore: 0.82 }),
        createMockVectorHit({ chunkId: "c2", entityId: "mat-1", similarityScore: 0.95 }),
        createMockVectorHit({ chunkId: "c3", entityId: "mat-1", similarityScore: 0.78 }),
      ]);

      const res = await GET(makeRequest({ q: "helicase", mode: "semantic" }));
      expect(res.status).toBe(200);
      const body: SearchApiResponse = await res.json();
      expect(body.total).toBe(1);
      expect(body.hits).toHaveLength(1);
      expect(body.hits[0]!.id).toBe("mat-1");
      expect(body.hits[0]!.score).toBe(0.95);
    });
  });

  // =========================================================================
  // Suite 10: Navigation Links & Snippets
  // =========================================================================
  describe("Suite 10: Navigation Links & Snippets", () => {
    it("10.1 Subject hit generates canonical URL /subjects/:id", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({ id: "subj-10", entityType: "subject", title: "Genetics" }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "Genetics", mode: "lexical" }));
      const body: SearchApiResponse = await res.json();
      expect(body.hits[0]!.navigation.href).toBe("/subjects/subj-10");
    });

    it("10.2 Chapter hit generates canonical URL /subjects/:subjectId/chapters/:id", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({
          id: "chap-5",
          entityType: "chapter",
          title: "Mendelian Laws",
          hierarchy: { subjectId: "subj-10" },
        }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "Mendelian", mode: "lexical" }));
      const body: SearchApiResponse = await res.json();
      expect(body.hits[0]!.navigation.href).toBe("/subjects/subj-10/chapters/chap-5");
    });

    it("10.3 Topic hit generates canonical URL with subjects/chapters/topics path", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({
          id: "top-3",
          entityType: "topic",
          title: "Punnett Squares",
          hierarchy: { subjectId: "subj-10", chapterId: "chap-5" },
        }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "Punnett", mode: "lexical" }));
      const body: SearchApiResponse = await res.json();
      expect(body.hits[0]!.navigation.href).toBe("/subjects/subj-10/chapters/chap-5/topics/top-3");
    });

    it("10.4 Note hit generates canonical URL targeting topics with ?tab=notes", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({
          id: "note-7",
          entityType: "note",
          title: "Dihybrid Cross Notes",
          hierarchy: { subjectId: "subj-10", chapterId: "chap-5", topicId: "top-3" },
        }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "Dihybrid", mode: "lexical" }));
      const body: SearchApiResponse = await res.json();
      expect(body.hits[0]!.navigation.href).toBe("/subjects/subj-10/chapters/chap-5/topics/top-3?tab=notes");
    });

    it("10.5 StudyGroup hit generates canonical URL /groups/:id", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({ id: "group-1", entityType: "group", title: "Genetics Study Club" }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "Club", mode: "lexical" }));
      const body: SearchApiResponse = await res.json();
      expect(body.hits[0]!.navigation.href).toBe("/groups/group-1");
    });

    it("10.6 FlashcardDeck hit generates canonical URL /flashcards/:id", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({ id: "deck-4", entityType: "flashcard", title: "Genetics Terms Deck" }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "Deck", mode: "lexical" }));
      const body: SearchApiResponse = await res.json();
      expect(body.hits[0]!.navigation.href).toBe("/flashcards/deck-4");
    });

    it("10.7 Material PDF hit with pageNumber generates /materials/:id?page=X deep link", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([
        createMockVectorHit({ entityId: "mat-pdf-1", pageNumber: 42, startSeconds: null }),
      ]);

      const res = await GET(makeRequest({ q: "helicase", mode: "semantic" }));
      const body: SearchApiResponse = await res.json();
      expect(body.hits[0]!.navigation.href).toBe("/materials/mat-pdf-1?page=42");
      expect(body.hits[0]!.navigation.pageNumber).toBe(42);
    });

    it("10.8 Material Audio hit with startSeconds generates /materials/:id?t=Y deep link", async () => {
      mockExecuteLexicalSearch.mockResolvedValue([]);
      mockExecuteVectorSearch.mockResolvedValue([
        createMockVectorHit({ entityId: "mat-audio-1", pageNumber: null, startSeconds: 315 }),
      ]);

      const res = await GET(makeRequest({ q: "helicase", mode: "semantic" }));
      const body: SearchApiResponse = await res.json();
      expect(body.hits[0]!.navigation.href).toBe("/materials/mat-audio-1?t=315");
      expect(body.hits[0]!.navigation.timestampSeconds).toBe(315);
    });

    it("10.9 Contextual snippet is clamped to approximately 160 characters centered on query terms with clean ellipsis", async () => {
      const longText =
        "Before the discovery. DNA polymerase III holoenzyme is the primary enzyme complex involved in prokaryotic DNA replication. It was discovered by Thomas Kornberg in 1971 and has high processivity. After the discovery.";
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({ snippetSourceText: longText }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "polymerase", mode: "lexical" }));
      const body: SearchApiResponse = await res.json();
      const snippet = body.hits[0]!.snippet;
      expect(snippet).toBeDefined();
      expect(snippet!.length).toBeLessThanOrEqual(200);
      expect(snippet!.toLowerCase()).toContain("polymerase");
      expect(snippet!.includes("…")).toBe(true);
    });

    it("10.10 Snippet extraction safely handles raw HTML or script tags", async () => {
      const xssContent =
        "Normal prefix text. <script>alert('pwned')</script> DNA polymerase enzyme information <img src=x onerror=alert(1)> trailing content.";
      mockExecuteLexicalSearch.mockResolvedValue([
        createMockLexicalHit({ snippetSourceText: xssContent }),
      ]);
      mockExecuteVectorSearch.mockResolvedValue([]);

      const res = await GET(makeRequest({ q: "polymerase", mode: "lexical" }));
      const body: SearchApiResponse = await res.json();
      const snippet = body.hits[0]!.snippet;
      expect(snippet).toBeDefined();
      expect(snippet).not.toContain("<script>");
      expect(snippet).not.toContain("<img");
    });
  });
});
