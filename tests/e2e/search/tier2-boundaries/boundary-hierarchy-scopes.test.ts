/**
 * Tier 2: Boundary Value Analysis — Hierarchy Scopes & Filters
 *
 * Systematic boundary testing of hierarchy scoping parameters:
 * - Malformed / non-UUID parameters (`groupId`, `subjectId`, `chapterId`, `topicId`)
 * - Non-existent UUIDs across all hierarchy levels
 * - Cross-tenant mismatch (passing another user's subjectId or unjoined groupId)
 * - Conflicting hierarchy combinations (e.g., subjectId of A with topicId of B)
 * - Empty string parameter values (`""`)
 * - Fail-closed exclusion under soft-deleted ancestors (deleted subjects, chapters, topics, groups)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, assertNoEntityLeak } from "../harness/contracts";

describe("Tier 2: Hierarchy Scope & Ancestor Boundaries", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  // ==========================================================================
  // 1. NON-EXISTENT & RANDOM UUIDS
  // ==========================================================================
  describe("Non-existent Hierarchy Identifiers", () => {
    const NON_EXISTENT_UUID = "00000000-0000-0000-0000-000000000000";

    it("returns 0 hits safely when subjectId does not exist", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "dna",
        subjectId: NON_EXISTENT_UUID,
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBe(0);
      expect(res.data.counts.note).toBe(0);
      expect(res.data.counts.material).toBe(0);
    });

    it("returns 0 hits safely when chapterId does not exist", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "dna",
        chapterId: NON_EXISTENT_UUID,
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBe(0);
    });

    it("returns 0 hits safely when topicId does not exist", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "dna",
        topicId: NON_EXISTENT_UUID,
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBe(0);
    });

    it("returns 0 hits safely when groupId does not exist", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "dna",
        groupId: NON_EXISTENT_UUID,
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBe(0);
    });
  });

  // ==========================================================================
  // 2. MALFORMED SCOPE PARAMETERS
  // ==========================================================================
  describe("Malformed Scope Parameters", () => {
    it("handles non-UUID string subjectId='not-a-uuid' without crashing", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "dna",
        subjectId: "not-a-uuid-string",
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });

    it("handles numeric string chapterId='12345' without crashing", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "dna",
        chapterId: "12345",
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });

    it("handles literal 'null' string as topicId safely", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "dna",
        topicId: "null",
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });

    it("handles literal '[object Object]' string as groupId safely", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "dna",
        groupId: "[object Object]",
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });
  });

  // ==========================================================================
  // 3. EMPTY STRING SCOPE PARAMETERS
  // ==========================================================================
  describe("Empty String Scope Parameters", () => {
    it("treats empty subjectId='' as omitted, returning unscoped hits", async () => {
      const resEmpty = await harness.dispatchSearchApiJson({ q: "dna", subjectId: "" });
      const resOmitted = await harness.dispatchSearchApiJson({ q: "dna" });
      expect(resEmpty.status).toBe(200);
      expect(resOmitted.status).toBe(200);
      expect(resEmpty.data.total).toBe(resOmitted.data.total);
    });

    it("treats empty groupId='' as omitted, returning unscoped hits", async () => {
      const resEmpty = await harness.dispatchSearchApiJson({ q: "dna", groupId: "" });
      const resOmitted = await harness.dispatchSearchApiJson({ q: "dna" });
      expect(resEmpty.status).toBe(200);
      expect(resEmpty.data.total).toBe(resOmitted.data.total);
    });
  });

  // ==========================================================================
  // 4. CROSS-TENANT SCOPE MISMATCH & ISOLATION
  // ==========================================================================
  describe("Cross-Tenant Scope Mismatch", () => {
    it("returns 0 hits when Alice specifies Bob's subjectId in query", async () => {
      // Alice is current user, passes Bob's math subject id
      const res = await harness.dispatchSearchApiJson(
        { q: "math", subjectId: "subj-bob-math" },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      assertNoEntityLeak(res.data, ["subj-bob-math"]);
    });

    it("returns 0 hits when Alice specifies Bob's private study group (group-2)", async () => {
      // Alice is not in group-2 (only Bob & Charlie are)
      const res = await harness.dispatchSearchApiJson(
        { q: "group", groupId: "group-2" },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      assertNoEntityLeak(res.data, ["group-2"]);
    });

    it("returns 0 hits when Bob specifies Alice's private subjectId", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "dna", subjectId: "subj-alice-bio" },
        { id: "user-bob" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });

    it("returns 0 hits when Charlie specifies group-1 (Biochemistry Study Group)", async () => {
      // Charlie is not a member of group-1
      const res = await harness.dispatchSearchApiJson(
        { q: "biochemistry", groupId: "group-1" },
        { id: "user-charlie" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });
  });

  // ==========================================================================
  // 5. CONFLICTING HIERARCHY SCOPES
  // ==========================================================================
  describe("Conflicting Hierarchy Scopes", () => {
    it("returns 0 hits when subjectId and chapterId belong to mutually disjoint subjects", async () => {
      // subj-alice-bio with a chapter from another subject or mismatched hierarchy
      const res = await harness.dispatchSearchApiJson({
        q: "dna",
        subjectId: "subj-alice-bio",
        chapterId: "chap-bob-calculus", // Bob's chapter
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });

    it("returns 0 hits when subjectId does not match the parent of topicId", async () => {
      const res = await harness.dispatchSearchApiJson({
        q: "dna",
        subjectId: "subj-bob-cs",
        topicId: "topic-helicase", // Topic belongs to Alice's bio subject
      });
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
    });
  });

  // ==========================================================================
  // 6. FAIL-CLOSED EXCLUSION OF SOFT-DELETED ANCESTORS
  // ==========================================================================
  describe("Fail-Closed Hierarchy Soft Deletion", () => {
    it("excludes all notes, materials, and topics when parent subject is soft-deleted", async () => {
      // Soft-delete Alice's biology subject
      const data = harness.store.getData();
      const bioSubj = data.subjects.find((s) => s.id === "subj-alice-bio");
      expect(bioSubj).toBeDefined();
      if (bioSubj) {
        bioSubj.deletedAt = new Date();
      }

      // Search for terms previously in Alice's bio notes
      const res = await harness.dispatchSearchApiJson(
        { q: "helicase replication" },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);

      // Verify no hits under the deleted subject are returned
      for (const hit of res.data.hits) {
        expect(hit.hierarchy.subjectId).not.toBe("subj-alice-bio");
      }
    });

    it("excludes notes and topics when parent chapter is soft-deleted", async () => {
      const data = harness.store.getData();
      const chap = data.chapters.find((c) => c.id === "chap-dna");
      expect(chap).toBeDefined();
      if (chap) {
        chap.deletedAt = new Date();
      }

      const res = await harness.dispatchSearchApiJson(
        { q: "helicase" },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      for (const hit of res.data.hits) {
        expect(hit.hierarchy.chapterId).not.toBe("chap-dna");
      }
    });

    it("excludes notes when topic is soft-deleted", async () => {
      const data = harness.store.getData();
      const topic = data.topics.find((t) => t.id === "topic-helicase");
      expect(topic).toBeDefined();
      if (topic) {
        topic.deletedAt = new Date();
      }

      const res = await harness.dispatchSearchApiJson(
        { q: "helicase" },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      for (const hit of res.data.hits) {
        expect(hit.hierarchy.topicId).not.toBe("topic-helicase");
      }
    });

    it("excludes soft-deleted study group (group-deleted) even for owner", async () => {
      // Alice is owner of group-deleted, but it is soft-deleted
      const res = await harness.dispatchSearchApiJson(
        { q: "Archived Medical", groupId: "group-deleted" },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBe(0);
    });
  });
});
