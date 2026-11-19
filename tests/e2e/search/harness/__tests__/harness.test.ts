/**
 * Sanity and contract validation test suite for Phase 12 E2E Search Test Harness.
 * Verifies fixtures, mock store, type guards, runtime validators, and reference oracle.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockEmbedding,
  cosineSimilarity,
  MOCK_VECTOR_DIMENSION,
  SEED_USERS,
  SEED_GROUPS,
  SEED_SUBJECTS,
  SEED_NOTES,
  SEED_MATERIALS,
  SEED_FLASHCARD_DECKS,
  SEED_QUIZZES,
  getFreshFixtureData,
} from "../fixtures";
import { MockDbStore } from "../mock-db-store";
import {
  validateSearchHit,
  validateSearchApiResponse,
  isSearchHit,
  isSearchApiResponse,
  assertSearchApiResponse,
  assertNoEntityLeak,
  calculateRRFScore,
  SearchHit,
  SearchApiResponse,
} from "../contracts";
import { SearchTestHarness } from "../search-test-harness";

describe("Phase 12 E2E Search Test Harness Sanity Suite", () => {
  // ==========================================================================
  // 1. FIXTURES & DETERMINISTIC EMBEDDINGS
  // ==========================================================================
  describe("Fixtures & Vector Embeddings", () => {
    it("generates deterministic 1536-dimensional unit vectors", () => {
      const v1 = createMockEmbedding("dna-replication");
      const v2 = createMockEmbedding("dna-replication");
      const v3 = createMockEmbedding("different-seed");

      expect(v1.length).toBe(MOCK_VECTOR_DIMENSION);
      expect(v1).toEqual(v2);
      expect(v1).not.toEqual(v3);

      // Verify L2 norm is approximately 1.0
      const norm = Math.sqrt(v1.reduce((sum, val) => sum + val * val, 0));
      expect(norm).toBeCloseTo(1.0, 2);
    });

    it("calculates cosine similarity correctly", () => {
      const v1 = createMockEmbedding("vector-a");
      const v2 = createMockEmbedding("vector-b");

      const selfSimilarity = cosineSimilarity(v1, v1);
      expect(selfSimilarity).toBeCloseTo(1.0, 2);

      const crossSimilarity = cosineSimilarity(v1, v2);
      expect(crossSimilarity).toBeLessThan(1.0);
      expect(crossSimilarity).toBeGreaterThanOrEqual(-1.0);
    });

    it("contains complete multi-tenant seed entities", () => {
      const data = getFreshFixtureData();

      // Multi-tenant users
      expect(data.users.length).toBeGreaterThanOrEqual(3);
      expect(data.users.map((u) => u.id)).toContain("user-alice");
      expect(data.users.map((u) => u.id)).toContain("user-bob");
      expect(data.users.map((u) => u.id)).toContain("user-charlie");

      // Study groups with roles
      const group1 = data.groups.find((g) => g.id === "group-1");
      expect(group1).toBeDefined();
      const g1Members = data.groupMembers.filter((m) => m.groupId === "group-1");
      expect(g1Members.some((m) => m.userId === "user-alice" && m.role === "OWNER")).toBe(true);
      expect(g1Members.some((m) => m.userId === "user-bob" && m.role === "MEMBER")).toBe(true);
      expect(g1Members.some((m) => m.userId === "user-dave" && m.role === "VIEWER")).toBe(true);

      // Soft-deleted group
      const deletedGroup = data.groups.find((g) => g.id === "group-deleted");
      expect(deletedGroup?.deletedAt).not.toBeNull();

      // Hierarchy: Subject -> Chapter -> Topic
      expect(data.subjects.length).toBeGreaterThanOrEqual(4);
      expect(data.chapters.length).toBeGreaterThanOrEqual(4);
      expect(data.topics.length).toBeGreaterThanOrEqual(4);

      // Notes with Tiptap blocks and plain text
      const helicaseNote = data.notes.find((n) => n.id === "note-dna-helicase");
      expect(helicaseNote).toBeDefined();
      expect(helicaseNote?.plainText).toContain("helicase");
      const blocks = data.noteBlocks.filter((b) => b.noteId === "note-dna-helicase");
      expect(blocks.length).toBeGreaterThanOrEqual(1);

      // Note chunks with 1536d embeddings
      const noteChunks = data.noteChunks.filter((nc) => nc.noteId === "note-dna-helicase");
      expect(noteChunks.length).toBe(2);
      expect(noteChunks[0]?.embedding.length).toBe(1536);

      // Materials with chunks (PDF pages & audio timestamps)
      const pdfMat = data.materials.find((m) => m.id === "mat-dna-slides");
      expect(pdfMat?.type).toBe("PDF");
      const pdfChunks = data.materialChunks.filter((mc) => mc.materialId === "mat-dna-slides");
      expect(pdfChunks.some((c) => c.pageNumber === 2)).toBe(true);

      const audioMat = data.materials.find((m) => m.id === "mat-chem-lecture-audio");
      expect(audioMat?.type).toBe("AUDIO");
      const audioChunks = data.materialChunks.filter((mc) => mc.materialId === "mat-chem-lecture-audio");
      expect(audioChunks.some((c) => c.startSeconds === 120)).toBe(true);

      // Flashcards and Quizzes
      expect(data.flashcardDecks.length).toBeGreaterThanOrEqual(2);
      expect(data.quizzes.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // 2. MOCK DB STORE & ACCESS HELPERS
  // ==========================================================================
  describe("MockDbStore", () => {
    let store: MockDbStore;

    beforeEach(() => {
      store = new MockDbStore();
      store.reset();
    });

    it("performs CRUD operations on mock prisma models", async () => {
      const db = store.createPrismaClientMock();

      // findUnique
      const user = await db.user.findUnique({ where: { id: "user-alice" } });
      expect(user).not.toBeNull();
      expect(user?.email).toBe("alice@example.com");

      // findFirst with filter
      const subject = await db.subject.findFirst({
        where: { name: { contains: "Biology", mode: "insensitive" } },
      });
      expect(subject?.id).toBe("subj-alice-bio");

      // create
      const newSubject = await db.subject.create({
        data: {
          id: "subj-test-new",
          name: "Test Subject",
          workspaceId: "ws-alice",
          order: 99,
        },
      });
      expect(newSubject.id).toBe("subj-test-new");

      // findMany with where.in
      const subjects = await db.subject.findMany({
        where: { id: { in: ["subj-alice-bio", "subj-test-new"] } },
      });
      expect(subjects.length).toBe(2);

      // update
      const updated = await db.subject.update({
        where: { id: "subj-test-new" },
        data: { name: "Updated Test Subject" },
      });
      expect(updated.name).toBe("Updated Test Subject");

      // delete
      const deleted = await db.subject.delete({
        where: { id: "subj-test-new" },
      });
      expect(deleted.id).toBe("subj-test-new");
      const notFound = await db.subject.findUnique({ where: { id: "subj-test-new" } });
      expect(notFound).toBeNull();
    });

    it("handles interactive transactions and array transactions", async () => {
      const db = store.createPrismaClientMock();

      // Array transaction
      const results = await db.$transaction([
        db.user.findUnique({ where: { id: "user-alice" } }),
        db.user.findUnique({ where: { id: "user-bob" } }),
      ]);
      expect(results.length).toBe(2);
      expect(results[0]?.id).toBe("user-alice");
      expect(results[1]?.id).toBe("user-bob");

      // Interactive callback transaction
      const txResult = await db.$transaction(async (tx: any) => {
        const u = await tx.user.findUnique({ where: { id: "user-alice" } });
        return u?.name;
      });
      expect(txResult).toBe("Alice Smith");
    });

    it("supports studyGroup and studyGroupMember aliases", async () => {
      const db = store.createPrismaClientMock();

      const groupViaAlias = await db.studyGroup.findUnique({ where: { id: "group-1" } });
      const groupDirect = await db.group.findUnique({ where: { id: "group-1" } });
      expect(groupViaAlias).toEqual(groupDirect);

      const memberViaAlias = await db.studyGroupMember.findFirst({
        where: { groupId: "group-1", userId: "user-alice" },
      });
      expect(memberViaAlias?.role).toBe("OWNER");
    });

    it("resolves user search scope correctly", () => {
      // Alice: personal workspace ws-alice, active member of group-1
      const aliceScope = store.resolveUserSearchScope("user-alice");
      expect(aliceScope.userId).toBe("user-alice");
      expect(aliceScope.personalWorkspaceId).toBe("ws-alice");
      expect(aliceScope.activeGroupIds).toContain("group-1");
      expect(aliceScope.activeGroupIds).not.toContain("group-deleted");

      // Bob: personal workspace ws-bob, active member of group-1 and group-2
      const bobScope = store.resolveUserSearchScope("user-bob");
      expect(bobScope.personalWorkspaceId).toBe("ws-bob");
      expect(bobScope.activeGroupIds).toContain("group-1");
      expect(bobScope.activeGroupIds).toContain("group-2");

      // Charlie: personal workspace ws-charlie, member of group-2, NOT in group-1
      const charlieScope = store.resolveUserSearchScope("user-charlie");
      expect(charlieScope.personalWorkspaceId).toBe("ws-charlie");
      expect(charlieScope.activeGroupIds).toContain("group-2");
      expect(charlieScope.activeGroupIds).not.toContain("group-1");
    });

    it("provides access mock helpers", async () => {
      const access = store.createAccessMock();

      store.setCurrentUser({ id: "user-alice", email: "alice@example.com", name: "Alice" });
      const user = await access.getSessionUser();
      expect(user?.id).toBe("user-alice");

      const ws = await access.getPrimaryWorkspace("user-alice");
      expect(ws?.id).toBe("ws-alice");

      const isMember = await access.userIsGroupMember("group-1", "user-bob");
      expect(isMember).toBe(true);

      const isDeletedGroupMember = await access.userIsGroupMember("group-deleted", "user-alice");
      expect(isDeletedGroupMember).toBe(false);
    });
  });

  // ==========================================================================
  // 3. CONTRACTS & RUNTIME VALIDATORS
  // ==========================================================================
  describe("Contracts & Runtime Validators", () => {
    const validHit: SearchHit = {
      id: "note-dna-helicase",
      entityType: "note",
      title: "DNA Helicase & Polymerase III Machinery",
      snippet: "...helicase unwinds the double helix at the replication fork...",
      matchType: "hybrid",
      score: 0.032787,
      hierarchy: {
        subjectId: "subj-alice-bio",
        subjectName: "Molecular Biology",
        chapterId: "chap-dna",
        chapterName: "DNA Replication and Repair",
        topicId: "topic-helicase",
        topicName: "DNA Helicase and Polymerase Mechanisms",
      },
      navigation: {
        href: "/topics/topic-helicase?tab=notes&noteId=note-dna-helicase",
      },
    };

    const validResponse: SearchApiResponse = {
      query: "helicase",
      mode: "hybrid",
      total: 1,
      limit: 20,
      offset: 0,
      hits: [validHit],
      counts: {
        subject: 0,
        chapter: 0,
        topic: 0,
        material: 0,
        note: 1,
        group: 0,
        flashcard: 0,
      },
    };

    it("validates a compliant SearchHit", () => {
      const res = validateSearchHit(validHit);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(isSearchHit(validHit)).toBe(true);
    });

    it("rejects an invalid SearchHit", () => {
      const badHit = { ...validHit, entityType: "quiz" }; // Quiz is forbidden
      const res = validateSearchHit(badHit);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("entityType must be one of");

      const badNav = { ...validHit, navigation: { href: "http://malicious.com" } }; // Must be relative starting with /
      const navRes = validateSearchHit(badNav);
      expect(navRes.valid).toBe(false);
      expect(navRes.errors[0]).toContain("navigation.href must be a relative URL");
    });

    it("validates a compliant SearchApiResponse", () => {
      const res = validateSearchApiResponse(validResponse);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(isSearchApiResponse(validResponse)).toBe(true);
      expect(() => assertSearchApiResponse(validResponse)).not.toThrow();
    });

    it("rejects an invalid SearchApiResponse", () => {
      const badRes = { ...validResponse, mode: "unknown-mode" };
      const res = validateSearchApiResponse(badRes);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("SearchApiResponse.mode must be one of");

      const negativeTotal = { ...validResponse, total: -5 };
      const negRes = validateSearchApiResponse(negativeTotal);
      expect(negRes.valid).toBe(false);
      expect(negRes.errors[0]).toContain("SearchApiResponse.total must be a non-negative integer");
    });

    it("detects security leakage via assertNoEntityLeak", () => {
      expect(() => {
        assertNoEntityLeak(validResponse, ["note-charlie-secret"]);
      }).not.toThrow();

      expect(() => {
        assertNoEntityLeak(validResponse, ["note-dna-helicase"]);
      }).toThrow(/Security Leak: hit id/);
    });

    it("computes Reciprocal Rank Fusion scores accurately (k=60)", () => {
      // Dual match: lexical rank 1, semantic rank 1
      // score = 1/(60+1) + 1/(60+1) = 2/61 ≈ 0.03278688
      const dualScore = calculateRRFScore(1, 1, 60);
      expect(dualScore).toBeCloseTo(2 / 61, 5);

      // Lexical only match: rank 1
      const lexScore = calculateRRFScore(1, null, 60);
      expect(lexScore).toBeCloseTo(1 / 61, 5);
      expect(dualScore).toBeGreaterThan(lexScore);

      // Semantic only match: rank 2
      const semScore = calculateRRFScore(null, 2, 60);
      expect(semScore).toBeCloseTo(1 / 62, 5);
    });
  });

  // ==========================================================================
  // 4. SEARCH TEST HARNESS & REFERENCE ORACLE
  // ==========================================================================
  describe("SearchTestHarness & Reference Oracle", () => {
    let harness: SearchTestHarness;

    beforeEach(() => {
      harness = new SearchTestHarness();
      harness.reset();
    });

    it("rejects unauthenticated requests with 401", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "helicase" }, null);
      expect(res.status).toBe(401);
      expect(res.data.error).toBe("Unauthorized");
    });

    it("rejects invalid query parameter lengths (<2 or >200 chars) with 400", async () => {
      const alice = { id: "user-alice" };

      // Query length < 2
      const shortRes = await harness.dispatchSearchApiJson({ q: "a" }, alice);
      expect(shortRes.status).toBe(400);
      expect(shortRes.data.error).toContain("at least 2 characters");

      // Query length > 200
      const longQuery = "a".repeat(201);
      const longRes = await harness.dispatchSearchApiJson({ q: longQuery }, alice);
      expect(longRes.status).toBe(400);
      expect(longRes.data.error).toContain("not exceed 200 characters");
    });

    it("rejects forbidden 'quiz' entity type with 400", async () => {
      const alice = { id: "user-alice" };
      const res = await harness.dispatchSearchApiJson({ q: "helicase", types: "note,quiz" }, alice);
      expect(res.status).toBe(400);
      expect(res.data.error).toContain("quiz");
    });

    it("retrieves valid hits for Alice including Notes and Materials with deep links", async () => {
      const alice = { id: "user-alice" };
      const res = await harness.dispatchSearchApiJson({ q: "helicase" }, alice);

      expect(res.status).toBe(200);
      expect(isSearchApiResponse(res.data)).toBe(true);

      const hits: SearchHit[] = res.data.hits;
      expect(hits.length).toBeGreaterThanOrEqual(1);

      // Verify Note hit exists and has tab=notes link
      const noteHit = hits.find((h) => h.id === "note-dna-helicase");
      expect(noteHit).toBeDefined();
      expect(noteHit?.entityType).toBe("note");
      expect(noteHit?.navigation.href).toContain("tab=notes");
      expect(noteHit?.hierarchy.subjectName).toBe("Molecular Biology");

      // Verify Material PDF hit exists and has page parameter
      const matHit = hits.find((h) => h.id === "mat-dna-slides");
      expect(matHit).toBeDefined();
      expect(matHit?.entityType).toBe("material");
      expect(matHit?.navigation.href).toContain("?page=");
    });

    it("enforces multi-tenant isolation: Alice never sees Charlie's private content", async () => {
      const alice = { id: "user-alice" };
      // Search for term in Charlie's confidential relativity notes
      const res = await harness.dispatchSearchApiJson({ q: "Lorentz invariance" }, alice);

      expect(res.status).toBe(200);
      const hits: SearchHit[] = res.data.hits;
      // Alice has no access to Charlie's workspace ws-charlie
      expect(hits.some((h) => h.id === "note-charlie-secret")).toBe(false);
      expect(hits.some((h) => h.id === "mat-charlie-paper")).toBe(false);
      expect(res.data.counts.note).toBe(0);
    });

    it("enforces fail-closed soft deletion: soft-deleted items are never returned", async () => {
      const alice = { id: "user-alice" };
      const res = await harness.dispatchSearchApiJson({ q: "draft" }, alice);

      expect(res.status).toBe(200);
      const hits: SearchHit[] = res.data.hits;
      // note-deleted has deletedAt set
      expect(hits.some((h) => h.id === "note-deleted")).toBe(false);
      expect(hits.some((h) => h.id === "mat-deleted")).toBe(false);
    });

    it("allows shared group content to be found by group members", async () => {
      // Bob is a member of group-1
      const bob = { id: "user-bob" };
      const res = await harness.dispatchSearchApiJson({ q: "benzene" }, bob);

      expect(res.status).toBe(200);
      const hits: SearchHit[] = res.data.hits;
      const groupMatHit = hits.find((h) => h.id === "mat-chem-lecture-audio");
      expect(groupMatHit).toBeDefined();
      expect(groupMatHit?.hierarchy.groupId).toBe("group-1");
    });
  });

  // ==========================================================================
  // 5. ROUTE HANDLER BINDING & DISPATCH PRIORITY
  // ==========================================================================
  describe("Route Handler Binding & Dispatch Priority", () => {
    it("dispatches to custom route handler passed via setRouteHandler", async () => {
      const harness = new SearchTestHarness();
      const mockHandler = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ custom: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      harness.setRouteHandler(mockHandler);
      const res = await harness.dispatchSearchApiJson({ q: "helicase" });

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ custom: true });
    });

    it("prioritizes per-call routeHandler over instance customRouteHandler", async () => {
      const harness = new SearchTestHarness();
      const instanceHandler = vi.fn();
      const perCallHandler = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ perCall: true }), { status: 200 })
      );

      harness.setRouteHandler(instanceHandler);
      const res = await harness.dispatchSearchApiJson({ q: "helicase" }, undefined, perCallHandler);

      expect(instanceHandler).not.toHaveBeenCalled();
      expect(perCallHandler).toHaveBeenCalledTimes(1);
      expect(res.data).toEqual({ perCall: true });
    });

    it("falls back to reference oracle when no custom handler is set and env flag is false", async () => {
      const harness = new SearchTestHarness();
      harness.reset();

      const res = await harness.dispatchSearchApiJson({ q: "biology" });
      expect(res.status).toBe(200);
      expect(res.data.query).toBe("biology");
      expect(Array.isArray(res.data.hits)).toBe(true);
    });
  });
});
