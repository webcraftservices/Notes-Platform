/**
 * Tier 1 — Feature 13: Pre-Filtered Server Authorization
 *
 * Verifies multi-tenant isolation, workspace boundaries, and role-based access
 * control across StudyGroup OWNER, ADMIN, MEMBER, and VIEWER roles, ensuring
 * authorization predicates are applied pre-query rather than post-filtered.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, assertNoEntityLeak } from "../harness/contracts";

describe("Tier 1 — Feat 13: Pre-Filtered Server Authorization", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };
  const bob = { id: "user-bob", email: "bob@example.com", name: "Bob Jones" };
  const charlie = { id: "user-charlie", email: "charlie@example.com", name: "Charlie Brown" };
  const dave = { id: "user-dave", email: "dave@example.com", name: "Dave Miller" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("isolates personal workspaces: Bob cannot retrieve Alice's private notes", async () => {
    // Note: note-dna-helicase is in Alice's personal workspace ws-alice
    const res = await harness.dispatchSearchApiJson(
      { q: "DNA Helicase & Polymerase III Machinery", mode: "lexical" },
      bob
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    // Bob must receive zero hits and zero counts for Alice's private notes
    expect(res.data.hits.some((h) => h.id === "note-dna-helicase")).toBe(false);
    expect(res.data.counts.note).toBe(0);
    assertNoEntityLeak(res.data, ["note-dna-helicase", "mat-dna-slides"]);
  });

  it("allows Study Group OWNER (Alice) to retrieve group subjects and materials", async () => {
    // Alice is OWNER of group-1 (Biochemistry Study Group)
    const res = await harness.dispatchSearchApiJson(
      { q: "Organic Chemistry", types: "subject" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    const hit = res.data.hits.find((h) => h.id === "subj-group1-chem");
    expect(hit).toBeDefined();
    expect(hit?.hierarchy.groupId).toBe("group-1");
  });

  it("allows Study Group MEMBER (Bob) to retrieve group subjects and materials", async () => {
    // Bob is MEMBER of group-1
    const res = await harness.dispatchSearchApiJson(
      { q: "Benzene Electrophilic Substitution Lecture", types: "material" },
      bob
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    const hit = res.data.hits.find((h) => h.id === "mat-chem-lecture-audio");
    expect(hit).toBeDefined();
    expect(hit?.hierarchy.groupId).toBe("group-1");
  });

  it("allows Study Group VIEWER (Dave) to search and retrieve group content read-only", async () => {
    // Dave is VIEWER of group-1
    const res = await harness.dispatchSearchApiJson(
      { q: "Benzene Ring Resonance", types: "note" },
      dave
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    const hit = res.data.hits.find((h) => h.id === "note-group-benzene");
    expect(hit).toBeDefined();
    expect(hit?.hierarchy.groupId).toBe("group-1");
  });

  it("blocks non-members (Charlie) from retrieving group-1 materials or notes", async () => {
    // Charlie is NOT in group-1 (only in ws-charlie and group-2)
    const res = await harness.dispatchSearchApiJson(
      { q: "Benzene Ring Resonance" },
      charlie
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    // Charlie must not see note-group-benzene or mat-chem-lecture-audio
    expect(res.data.hits.some((h) => h.id === "note-group-benzene")).toBe(false);
    expect(res.data.hits.some((h) => h.id === "mat-chem-lecture-audio")).toBe(false);
    assertNoEntityLeak(res.data, ["note-group-benzene", "mat-chem-lecture-audio"], ["group-1"]);
  });

  it("compiles tenant scopes directly into user search scope resolver", () => {
    const aliceScope = harness.store.resolveUserSearchScope("user-alice");
    expect(aliceScope.personalWorkspaceId).toBe("ws-alice");
    expect(aliceScope.activeGroupIds).toContain("group-1");
    expect(aliceScope.activeGroupIds).not.toContain("group-2");

    const charlieScope = harness.store.resolveUserSearchScope("user-charlie");
    expect(charlieScope.personalWorkspaceId).toBe("ws-charlie");
    expect(charlieScope.activeGroupIds).toContain("group-2");
    expect(charlieScope.activeGroupIds).not.toContain("group-1");
  });
});
