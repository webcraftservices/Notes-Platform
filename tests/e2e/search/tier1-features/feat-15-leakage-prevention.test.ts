/**
 * Tier 1 — Feature 15: Leakage Prevention
 *
 * Verifies that unauthorized content never leaks through search hits, titles,
 * snippets, metadata, total counts, or entity-specific counts under any query.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, assertNoEntityLeak } from "../harness/contracts";

describe("Tier 1 — Feat 15: Leakage Prevention", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };
  const charlie = { id: "user-charlie", email: "charlie@example.com", name: "Charlie Brown" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("never leaks unauthorized entity titles in search hit titles", async () => {
    // Charlie has a confidential paper: "Charlie Advanced Relativity Notes and Tensors.pdf"
    // Alice queries for relativity
    const res = await harness.dispatchSearchApiJson(
      { q: "Advanced Relativity Notes" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    for (const hit of res.data.hits) {
      expect(hit.title).not.toContain("Charlie Advanced Relativity");
      expect(hit.id).not.toBe("mat-charlie-paper");
      expect(hit.id).not.toBe("note-charlie-secret");
    }
  });

  it("never leaks confidential text snippets from unauthorized documents", async () => {
    // Charlie's secret note contains: "Lorentz invariance constitutes the exact spacetime symmetry"
    // Alice queries specifically for spacetime symmetry
    const res = await harness.dispatchSearchApiJson(
      { q: "spacetime symmetry" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    for (const hit of res.data.hits) {
      if (hit.snippet) {
        expect(hit.snippet).not.toContain("exact spacetime symmetry");
        expect(hit.snippet).not.toContain("Einstein tensor");
      }
    }
    assertNoEntityLeak(res.data, ["note-charlie-secret", "mat-charlie-paper"]);
  });

  it("never leaks existence of unauthorized documents through counts or totals", async () => {
    // Charlie has 1 note and 1 material with "Lorentz invariance"
    // Charlie gets hits for his notes
    const charlieRes = await harness.dispatchSearchApiJson({ q: "Lorentz invariance", mode: "lexical" }, charlie);
    expect(charlieRes.status).toBe(200);
    expect(charlieRes.data.total).toBeGreaterThanOrEqual(1);

    // Alice queries "Lorentz invariance" - must receive total = 0 and all counts = 0
    const aliceRes = await harness.dispatchSearchApiJson({ q: "Lorentz invariance", mode: "lexical" }, alice);
    expect(aliceRes.status).toBe(200);
    assertSearchApiResponse(aliceRes.data);

    expect(aliceRes.data.total).toBe(0);
    expect(aliceRes.data.hits).toHaveLength(0);
    expect(aliceRes.data.counts.note).toBe(0);
    expect(aliceRes.data.counts.material).toBe(0);
    expect(aliceRes.data.counts.subject).toBe(0);
  });

  it("prevents timing/existence probing via exact UUID queries for unauthorized entities", async () => {
    // Probing with Charlie's secret note UUID
    const res = await harness.dispatchSearchApiJson(
      { q: "note-charlie-secret", mode: "lexical" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.total).toBe(0);
    expect(res.data.hits).toHaveLength(0);
  });

  it("prevents metadata leakage during common stopword queries across tenants", async () => {
    // Querying a common term like "overview" or "notes"
    const res = await harness.dispatchSearchApiJson({ q: "notes" }, alice);

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    // None of Charlie's notes or materials should leak even with a generic word like "notes"
    for (const hit of res.data.hits) {
      expect(hit.id).not.toBe("note-charlie-secret");
      expect(hit.id).not.toBe("mat-charlie-paper");
      expect(hit.id).not.toBe("deck-charlie-cards");
    }
  });

  it("prevents unjoined group leakage when unauthorized user queries group names", async () => {
    // Charlie is not in group-1 ("Biochemistry Study Group")
    const res = await harness.dispatchSearchApiJson(
      { q: "Biochemistry", mode: "lexical", types: "group" },
      charlie
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    expect(res.data.hits.some((h) => h.id === "group-1")).toBe(false);
    expect(res.data.counts.group).toBe(0);
  });
});
