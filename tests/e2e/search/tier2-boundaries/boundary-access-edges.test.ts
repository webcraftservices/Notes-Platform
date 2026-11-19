/**
 * Tier 2: Boundary Value Analysis — Security & Access Control Edges
 *
 * Systematic boundary testing of security, authorization, and tenant isolation:
 * - StudyGroup Role Hierarchy (OWNER vs MEMBER vs VIEWER vs Non-Member)
 * - Dynamic membership revocation (recently removed group member)
 * - Soft-deleted StudyGroup fail-closed isolation
 * - Cross-workspace private content isolation (Alice vs Bob vs Charlie)
 * - Unauthenticated requests (null session, non-existent users)
 * - Information leakage prevention across titles, snippets, and facet counts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, assertNoEntityLeak } from "../harness/contracts";

describe("Tier 2: Security & Access Boundaries", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  // ==========================================================================
  // 1. STUDY GROUP ROLE BOUNDARIES
  // ==========================================================================
  describe("StudyGroup Role Hierarchy", () => {
    it("allows OWNER (Alice) to search shared group-1 content", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "Organic Chemistry", groupId: "group-1" },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.total).toBeGreaterThanOrEqual(1);
      expect(res.data.hits[0]?.hierarchy.groupId).toBe("group-1");
    });

    it("allows MEMBER (Bob) to search shared group-1 content", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "Organic Chemistry", groupId: "group-1" },
        { id: "user-bob" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.total).toBeGreaterThanOrEqual(1);
      expect(res.data.hits[0]?.hierarchy.groupId).toBe("group-1");
    });

    it("allows VIEWER (Dave) to search shared group-1 content", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "Organic Chemistry", groupId: "group-1" },
        { id: "user-dave" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.total).toBeGreaterThanOrEqual(1);
      expect(res.data.hits[0]?.hierarchy.groupId).toBe("group-1");
    });

    it("forbids Non-Member (Charlie) from searching group-1 content, returning 0 hits", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "Organic Chemistry", groupId: "group-1" },
        { id: "user-charlie" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBe(0);
      assertNoEntityLeak(res.data, ["group-1"]);
    });
  });

  // ==========================================================================
  // 2. DYNAMIC MEMBERSHIP REVOCATION
  // ==========================================================================
  describe("Dynamic Membership Revocation", () => {
    it("immediately prevents a removed member from retrieving group content", async () => {
      // Bob initially has access to group-1
      const initialRes = await harness.dispatchSearchApiJson(
        { q: "Organic Chemistry", groupId: "group-1" },
        { id: "user-bob" }
      );
      expect(initialRes.data.total).toBeGreaterThanOrEqual(1);

      // Revoke Bob's membership in group-1
      const data = harness.store.getData();
      const memberIdx = data.groupMembers.findIndex(
        (m) => m.groupId === "group-1" && m.userId === "user-bob"
      );
      expect(memberIdx).not.toBe(-1);
      data.groupMembers.splice(memberIdx, 1);

      // Repeat search as Bob: access must be immediately severed
      const revokedRes = await harness.dispatchSearchApiJson(
        { q: "Organic Chemistry", groupId: "group-1" },
        { id: "user-bob" }
      );
      expect(revokedRes.status).toBe(200);
      assertSearchApiResponse(revokedRes.data);
      expect(revokedRes.data.hits).toEqual([]);
      expect(revokedRes.data.total).toBe(0);
    });
  });

  // ==========================================================================
  // 3. SOFT-DELETED STUDY GROUP ISOLATION
  // ==========================================================================
  describe("Soft-Deleted StudyGroup Isolation", () => {
    it("denies access to soft-deleted group-deleted even for its OWNER (Alice)", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "Archived Medical", groupId: "group-deleted" },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBe(0);
    });

    it("never includes soft-deleted group items in general unscoped queries", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "Medical" },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      for (const hit of res.data.hits) {
        expect(hit.hierarchy.groupId).not.toBe("group-deleted");
      }
    });
  });

  // ==========================================================================
  // 4. CROSS-WORKSPACE SCOPE ISOLATION
  // ==========================================================================
  describe("Cross-Workspace Scope Isolation", () => {
    it("prevents Alice from discovering Bob's private computer science notes or topics", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "Algorithms distributed systems" },
        { id: "user-alice" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      assertNoEntityLeak(res.data, ["subj-bob-cs", "ws-bob"]);
    });

    it("prevents Bob from discovering Charlie's private quantum physics notes", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "Quantum relativity Lorentz" },
        { id: "user-bob" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      assertNoEntityLeak(res.data, ["subj-charlie-phys", "ws-charlie"]);
    });

    it("prevents Charlie from discovering Alice's private DNA replication notes", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "helicase Okazaki" },
        { id: "user-charlie" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      assertNoEntityLeak(res.data, ["note-dna-helicase", "subj-alice-bio"]);
    });
  });

  // ==========================================================================
  // 5. UNAUTHENTICATED & ANONYMOUS REQUESTS
  // ==========================================================================
  describe("Unauthenticated Access Boundaries", () => {
    it("rejects unauthenticated request (user=null) with 401 Unauthorized", async () => {
      const res = await harness.dispatchSearchApiJson({ q: "dna" }, null);
      expect(res.status).toBe(401);
      expect(res.data?.error).toMatch(/unauthorized/i);
    });

    it("returns zero accessible scope and 0 hits for a non-existent user ID", async () => {
      const res = await harness.dispatchSearchApiJson(
        { q: "dna" },
        { id: "user-ghost-does-not-exist" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);
      expect(res.data.hits).toEqual([]);
      expect(res.data.total).toBe(0);
    });
  });

  // ==========================================================================
  // 6. METADATA & FACET COUNT LEAKAGE PREVENTION
  // ==========================================================================
  describe("Metadata & Facet Count Leakage Prevention", () => {
    it("ensures total count and facet counts reflect ONLY authorized entities", async () => {
      // Alice search for 'chemistry'
      const aliceRes = await harness.dispatchSearchApiJson(
        { q: "chemistry" },
        { id: "user-alice" }
      );
      // Charlie search for 'chemistry' (Charlie is not in group-1)
      const charlieRes = await harness.dispatchSearchApiJson(
        { q: "chemistry" },
        { id: "user-charlie" }
      );

      // Charlie must have 0 counts for group-1 chemistry entities
      expect(charlieRes.data.total).toBe(0);
      expect(charlieRes.data.counts.subject).toBe(0);

      // Alice has access to group-1 chemistry subject
      expect(aliceRes.data.total).toBeGreaterThanOrEqual(1);
      expect(aliceRes.data.counts.subject).toBeGreaterThanOrEqual(1);
    });
  });
});
