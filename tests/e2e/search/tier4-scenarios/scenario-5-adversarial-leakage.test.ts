/**
 * Tier 4: Real-World Workload Testing — Scenario 5: Adversarial Multi-Tenant Penetration Probe
 *
 * User Journey:
 * An attacker (Charlie) with an authenticated account attempts various adversarial probes
 * to snoop on, enumerate, or leak data from Alice's private workspace (ws-alice) and
 * Alice & Bob's private study group (group-1):
 *
 * Steps:
 * 1. High-frequency dictionary attack: probing common words ("biology", "replication", "helicase")
 *    expecting unauthorized private hits. Must return 0 private records.
 * 2. Scope parameter injection: Charlie directly passes Alice's private subjectId in query params.
 *    Must fail closed with 0 hits without confirming whether the subjectId exists.
 * 3. Unjoined StudyGroup probe: Charlie targets group-1 via `groupId="group-1"`.
 *    Must return 0 hits with group name and details completely concealed.
 * 4. Facet count enumeration probe: Charlie inspects `counts` map to see if private entities increment totals.
 *    Must strictly count only Charlie's accessible records.
 * 5. Full response body audit: Charlie scans all returned titles, snippets, and navigation URLs.
 *    Zero mentions of private tokens, usernames, or workspaces.
 * 6. Soft-deleted entity probe: Charlie probes for soft-deleted subjects and study groups.
 *    Must fail closed.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, assertNoEntityLeak, SearchHit } from "../harness/contracts";

describe("Tier 4: Scenario 5 — Adversarial Multi-Tenant Leakage & Penetration Probe", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("resists all adversarial data-leakage and enumeration attacks from unauthorized tenant", async () => {
    // ------------------------------------------------------------------------
    // Step 1: High-Frequency Dictionary Probe (Targeting Alice's private terms)
    // ------------------------------------------------------------------------
    const dictQueries = ["biology", "helicase", "replication", "okazaki", "polymerase"];

    for (const term of dictQueries) {
      const res = await harness.dispatchSearchApiJson(
        { q: term, mode: "hybrid" },
        { id: "user-charlie" }
      );
      expect(res.status).toBe(200);
      assertSearchApiResponse(res.data);

      // Verify zero hits belong to Alice's private workspace or group-1
      assertNoEntityLeak(res.data, [
        "ws-alice",
        "note-dna-helicase",
        "mat-dna-slides",
        "subj-alice-bio",
      ], ["group-1"]);
    }

    // ------------------------------------------------------------------------
    // Step 2: Scope Parameter Injection (Passing Alice's private subjectId)
    // ------------------------------------------------------------------------
    const scopeInjectRes = await harness.dispatchSearchApiJson(
      { q: "dna", subjectId: "subj-alice-bio" },
      { id: "user-charlie" }
    );
    expect(scopeInjectRes.status).toBe(200);
    assertSearchApiResponse(scopeInjectRes.data);
    expect(scopeInjectRes.data.hits).toEqual([]);
    expect(scopeInjectRes.data.total).toBe(0);

    // ------------------------------------------------------------------------
    // Step 3: Unjoined StudyGroup Snooping Probe (Targeting group-1)
    // ------------------------------------------------------------------------
    const groupSnoopRes = await harness.dispatchSearchApiJson(
      { q: "chemistry", groupId: "group-1" },
      { id: "user-charlie" }
    );
    expect(groupSnoopRes.status).toBe(200);
    assertSearchApiResponse(groupSnoopRes.data);
    expect(groupSnoopRes.data.hits).toEqual([]);
    expect(groupSnoopRes.data.total).toBe(0);

    // ------------------------------------------------------------------------
    // Step 4: Facet Count Enumeration Probe
    // ------------------------------------------------------------------------
    const facetRes = await harness.dispatchSearchApiJson(
      { q: "chemistry" },
      { id: "user-charlie" }
    );
    expect(facetRes.status).toBe(200);
    // Charlie has 0 subjects, 0 notes, 0 materials in chemistry
    expect(facetRes.data.total).toBe(0);
    expect(facetRes.data.counts.subject).toBe(0);
    expect(facetRes.data.counts.material).toBe(0);
    expect(facetRes.data.counts.note).toBe(0);

    // ------------------------------------------------------------------------
    // Step 5: Full Response Body Audit on Charlie's Legitimate Query
    // ------------------------------------------------------------------------
    const charlieLegitRes = await harness.dispatchSearchApiJson(
      { q: "physics relativity", mode: "hybrid" },
      { id: "user-charlie" }
    );
    expect(charlieLegitRes.status).toBe(200);
    assertSearchApiResponse(charlieLegitRes.data);

    for (const hit of charlieLegitRes.data.hits) {
      // Must not leak Alice's or Bob's workspace IDs or names
      expect(hit.hierarchy.subjectId).toBe("subj-charlie-phys");
      expect(hit.title).not.toMatch(/alice|bob|helicase|biochemistry/i);
      if (hit.snippet) {
        expect(hit.snippet).not.toMatch(/alice|bob|helicase|okazaki/i);
      }
    }

    // ------------------------------------------------------------------------
    // Step 6: Soft-Deleted Hierarchy Ancestor Probe
    // ------------------------------------------------------------------------
    const deletedProbeRes = await harness.dispatchSearchApiJson(
      { q: "Sequencing", subjectId: "subj-deleted" },
      { id: "user-charlie" }
    );
    expect(deletedProbeRes.status).toBe(200);
    expect(deletedProbeRes.data.hits).toEqual([]);
    expect(deletedProbeRes.data.total).toBe(0);
  });
});
