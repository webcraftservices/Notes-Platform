/**
 * Tier 4: Real-World Workload Testing — Scenario 3: Command Palette Keyboard & Debounce Flow
 *
 * User Journey:
 * Fast keyboard-driven search navigation workflow:
 * 1. User activates command palette via shortcut detection (initial empty state).
 * 2. Rapid typing simulation with threshold gating and AbortController request cancellation:
 *    - "b" (1 char): below threshold (<2 chars), withheld by shouldTriggerSearch.
 *    - "bi" (2 chars): meets threshold, starts in-flight request controller.
 *    - "bio" (3 chars): rapid typing aborts previous request via createSearchAbortController.
 *    - "biology" (7 chars): resolves successfully with multi-tenant SearchApiResponse.
 * 3. Search hits verification: structure, monotonic ranking, hierarchy metadata.
 * 4. Hit selection, navigation resolution & UI store action dispatch (New Subject / New Group).
 * 5. Dynamic facet filter toggle within palette (restricting view to notes only).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, SearchHit } from "../harness/contracts";
import {
  isCommandPaletteShortcut,
  shouldTriggerSearch,
  createSearchAbortController,
  resolveCommandNavigationHref,
} from "@/components/shell/command-palette";
import { useUIStore } from "@/lib/stores/ui-store";

describe("Tier 4: Scenario 3 — Command Palette Keyboard & Debounce Workflow", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
    useUIStore.setState({
      createSubjectOpen: false,
      createGroupOpen: false,
      mobileNavOpen: false,
    });
  });

  it("simulates full interactive command palette keyboard workflow with request cancellation", async () => {
    // ------------------------------------------------------------------------
    // Step 1: Open Palette (Shortcut Verification & Initial empty state)
    // ------------------------------------------------------------------------
    expect(isCommandPaletteShortcut({ metaKey: true, key: "k" })).toBe(true);
    expect(isCommandPaletteShortcut({ ctrlKey: true, key: "K" })).toBe(true);

    let activeQuery = "";
    expect(shouldTriggerSearch(activeQuery)).toBe(false);

    // ------------------------------------------------------------------------
    // Step 2: Rapid Typing Simulation & AbortController Cancellation
    // ------------------------------------------------------------------------
    // Keystroke 1: "b" (1 char -> below minimum 2-char threshold)
    activeQuery = "b";
    expect(shouldTriggerSearch(activeQuery)).toBe(false);
    const keystroke1Res = await harness.dispatchSearchApiJson({ q: activeQuery });
    expect(keystroke1Res.status).toBe(400); // 400 Bad Request, <2 chars

    // Keystroke 2: "bi" (2 chars -> valid, starts in-flight request)
    activeQuery = "bi";
    expect(shouldTriggerSearch(activeQuery)).toBe(true);
    let activeController = createSearchAbortController(null);
    expect(activeController.signal.aborted).toBe(false);

    // Keystroke 3: "bio" rapidly typed before "bi" finishes -> aborts previous controller
    activeQuery = "bio";
    const previousController = activeController;
    activeController = createSearchAbortController(previousController);
    expect(previousController.signal.aborted).toBe(true);
    expect(activeController.signal.aborted).toBe(false);

    // Keystroke 4: "biology" completes
    activeQuery = "biology";
    const finalRes = await harness.dispatchSearchApiJson({ q: activeQuery, mode: "hybrid" });
    expect(finalRes.status).toBe(200);
    assertSearchApiResponse(finalRes.data);
    expect(finalRes.data.total).toBeGreaterThanOrEqual(2);

    const currentHits: SearchHit[] = finalRes.data.hits;
    expect(currentHits.length).toBeGreaterThanOrEqual(2);

    // ------------------------------------------------------------------------
    // Step 3: Search Hits Traversal & Hierarchy Metadata Validation
    // ------------------------------------------------------------------------
    // Verify score monotonicity
    for (let i = 0; i < currentHits.length - 1; i++) {
      const hitA = currentHits[i];
      const hitB = currentHits[i + 1];
      expect(hitA).toBeDefined();
      expect(hitB).toBeDefined();
      if (hitA && hitB) {
        expect(hitA.score).toBeGreaterThanOrEqual(hitB.score);
      }
    }

    // Verify first hit contains valid hierarchy and navigation
    const topHit = currentHits[0];
    expect(topHit).toBeDefined();
    if (!topHit) throw new Error("Expected topHit to be defined");
    expect(topHit.id).toBeDefined();
    expect(topHit.title).toBeDefined();
    expect(topHit.hierarchy).toBeDefined();
    expect(topHit.navigation.href.startsWith("/")).toBe(true);

    // ------------------------------------------------------------------------
    // Step 4: Selection Navigation & UI Store Action Dispatch
    // ------------------------------------------------------------------------
    // Resolve navigation href for active hit
    const resolvedHref = resolveCommandNavigationHref(topHit);
    expect(resolvedHref).toBe(topHit.navigation.href);

    // Test palette action execution: New Subject modal trigger via UI store
    expect(useUIStore.getState().createSubjectOpen).toBe(false);
    useUIStore.getState().setCreateSubjectOpen(true);
    expect(useUIStore.getState().createSubjectOpen).toBe(true);
    useUIStore.getState().setCreateSubjectOpen(false);

    // Test palette action execution: New Group modal trigger via UI store
    expect(useUIStore.getState().createGroupOpen).toBe(false);
    useUIStore.getState().setCreateGroupOpen(true);
    expect(useUIStore.getState().createGroupOpen).toBe(true);

    // ------------------------------------------------------------------------
    // Step 5: Filter Pill Toggle within Palette (Notes only)
    // ------------------------------------------------------------------------
    const filteredRes = await harness.dispatchSearchApiJson({
      q: "biology",
      types: ["note"],
    });
    expect(filteredRes.status).toBe(200);
    assertSearchApiResponse(filteredRes.data);

    for (const hit of filteredRes.data.hits) {
      expect(hit.entityType).toBe("note");
      expect(resolveCommandNavigationHref(hit).startsWith("/")).toBe(true);
    }
  });
});
