/**
 * Tier 4: Real-World Workload Testing — Scenario 2: Study Group Multi-Tenant Isolation
 *
 * User Journey:
 * Alice (OWNER) and Bob (MEMBER) collaborate in a shared study group ("Biochemistry Study Group", group-1).
 * Charlie is an outsider (member of group-2 only, not group-1).
 *
 * Steps:
 * 1. Alice creates shared study group notes and course materials within group-1.
 * 2. Bob searches for the shared topic ("Aromatic Compounds") and successfully discovers the shared material.
 * 3. Bob searches for Alice's private notes ("Helicase replication fork" in ws-alice) -> zero hits (strict isolation).
 * 4. Alice searches for Bob's private computer science materials ("Algorithms" in ws-bob) -> zero hits (strict isolation).
 * 5. Charlie searches for group-1 shared topics -> zero hits (strict group boundary isolation).
 * 6. Charlie searches for his own private Quantum Physics materials in ws-charlie -> successfully finds only his own content.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, assertNoEntityLeak, SearchHit } from "../harness/contracts";

describe("Tier 4: Scenario 2 — Study Group Multi-Tenant Isolation Workflow", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("executes the complete multi-tenant study group isolation workflow", async () => {
    // ------------------------------------------------------------------------
    // Step 1: Alice and Bob belong to group-1; Charlie does not
    // ------------------------------------------------------------------------
    const data = harness.store.getData();
    const g1 = data.groups.find((g) => g.id === "group-1");
    expect(g1).toBeDefined();

    const g1Members = data.groupMembers.filter((m) => m.groupId === "group-1");
    expect(g1Members.some((m) => m.userId === "user-alice" && m.role === "OWNER")).toBe(true);
    expect(g1Members.some((m) => m.userId === "user-bob" && m.role === "MEMBER")).toBe(true);
    expect(g1Members.some((m) => m.userId === "user-charlie")).toBe(false);

    // ------------------------------------------------------------------------
    // Step 2: Bob searches for shared group-1 content (Organic Chemistry / Aromatic)
    // ------------------------------------------------------------------------
    const bobGroupRes = await harness.dispatchSearchApiJson(
      { q: "Aromatic Compounds", groupId: "group-1" },
      { id: "user-bob" }
    );
    expect(bobGroupRes.status).toBe(200);
    assertSearchApiResponse(bobGroupRes.data);
    expect(bobGroupRes.data.total).toBeGreaterThanOrEqual(1);

    const groupHit = bobGroupRes.data.hits[0];
    expect(groupHit).toBeDefined();
    if (!groupHit) throw new Error("Expected groupHit to be defined");
    expect(groupHit.hierarchy.groupId).toBe("group-1");
    expect(groupHit.hierarchy.groupName).toBe("Biochemistry Study Group");

    // ------------------------------------------------------------------------
    // Step 3: Bob searches for Alice's private notes (stored in ws-alice)
    // ------------------------------------------------------------------------
    const bobPrivateLeakRes = await harness.dispatchSearchApiJson(
      { q: "DNA Helicase Okazaki" },
      { id: "user-bob" }
    );
    expect(bobPrivateLeakRes.status).toBe(200);
    assertSearchApiResponse(bobPrivateLeakRes.data);
    // Bob must NOT see Alice's private note
    assertNoEntityLeak(bobPrivateLeakRes.data, ["note-dna-helicase", "subj-alice-bio"]);

    // ------------------------------------------------------------------------
    // Step 4: Alice searches for Bob's private computer science materials
    // ------------------------------------------------------------------------
    const alicePrivateLeakRes = await harness.dispatchSearchApiJson(
      { q: "distributed systems computer architecture" },
      { id: "user-alice" }
    );
    expect(alicePrivateLeakRes.status).toBe(200);
    assertSearchApiResponse(alicePrivateLeakRes.data);
    assertNoEntityLeak(alicePrivateLeakRes.data, ["subj-bob-cs", "ws-bob"]);

    // ------------------------------------------------------------------------
    // Step 5: Charlie (unauthorized third party) searches for group-1 content
    // ------------------------------------------------------------------------
    const charlieGroupRes = await harness.dispatchSearchApiJson(
      { q: "Aromatic Compounds Benzene", groupId: "group-1" },
      { id: "user-charlie" }
    );
    expect(charlieGroupRes.status).toBe(200);
    assertSearchApiResponse(charlieGroupRes.data);
    expect(charlieGroupRes.data.hits).toEqual([]);
    expect(charlieGroupRes.data.total).toBe(0);
    assertNoEntityLeak(charlieGroupRes.data, ["group-1", "subj-group1-chem"]);

    // ------------------------------------------------------------------------
    // Step 6: Charlie searches for his own private Quantum Physics materials
    // ------------------------------------------------------------------------
    const charlieOwnRes = await harness.dispatchSearchApiJson(
      { q: "Quantum relativity Lorentz" },
      { id: "user-charlie" }
    );
    expect(charlieOwnRes.status).toBe(200);
    assertSearchApiResponse(charlieOwnRes.data);
    expect(charlieOwnRes.data.total).toBeGreaterThanOrEqual(1);

    for (const hit of charlieOwnRes.data.hits) {
      expect(hit.hierarchy.subjectId).toBe("subj-charlie-phys");
    }
  });
});
