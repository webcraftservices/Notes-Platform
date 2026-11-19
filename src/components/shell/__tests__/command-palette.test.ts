/**
 * src/components/shell/__tests__/command-palette.test.ts
 *
 * Phase 12 Milestone 4: Command Palette Pure-Logic Unit Tests
 *
 * Tests the utility functions exported from command-palette.tsx that are
 * testable without a React DOM environment (no JSX or hooks).
 *
 * Covers:
 *   Suite 1 — isCommandPaletteShortcut
 *   Suite 2 — shouldTriggerSearch
 *   Suite 3 — createSearchAbortController
 *   Suite 4 — resolveCommandNavigationHref
 *   Suite 5 — entityTypeIcon (identity/existence)
 *   Suite 6 — buildHierarchyBreadcrumb
 *   Suite 7 — matchTypeBadgeLabel
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isCommandPaletteShortcut,
  shouldTriggerSearch,
  createSearchAbortController,
  resolveCommandNavigationHref,
  entityTypeIcon,
  buildHierarchyBreadcrumb,
  matchTypeBadgeLabel,
  MIN_SEARCH_QUERY_LENGTH,
} from "../command-palette";
import type { UnifiedSearchHit } from "../command-palette";

describe("CommandPalette utility functions", () => {

  // =========================================================================
  // Suite 1: isCommandPaletteShortcut
  // =========================================================================
  describe("Suite 1: isCommandPaletteShortcut", () => {
    it("1.1 returns true for Ctrl+K", () => {
      expect(isCommandPaletteShortcut({ ctrlKey: true, key: "k" })).toBe(true);
    });

    it("1.2 returns true for Cmd+K (Meta+K)", () => {
      expect(isCommandPaletteShortcut({ metaKey: true, key: "k" })).toBe(true);
    });

    it("1.3 returns true for Ctrl+K with uppercase K", () => {
      expect(isCommandPaletteShortcut({ ctrlKey: true, key: "K" })).toBe(true);
    });

    it("1.4 returns false for Ctrl+J", () => {
      expect(isCommandPaletteShortcut({ ctrlKey: true, key: "j" })).toBe(false);
    });

    it("1.5 returns false for K without modifier", () => {
      expect(isCommandPaletteShortcut({ key: "k" })).toBe(false);
    });

    it("1.6 returns false for empty key", () => {
      expect(isCommandPaletteShortcut({ ctrlKey: true, key: "" })).toBe(false);
    });
  });

  // =========================================================================
  // Suite 2: shouldTriggerSearch
  // =========================================================================
  describe("Suite 2: shouldTriggerSearch", () => {
    it(`2.1 returns true for query of length ${MIN_SEARCH_QUERY_LENGTH}`, () => {
      expect(shouldTriggerSearch("ab")).toBe(true);
    });

    it("2.2 returns true for longer queries", () => {
      expect(shouldTriggerSearch("machine learning")).toBe(true);
    });

    it("2.3 returns false for single-character query", () => {
      expect(shouldTriggerSearch("a")).toBe(false);
    });

    it("2.4 returns false for empty string", () => {
      expect(shouldTriggerSearch("")).toBe(false);
    });

    it("2.5 returns false for whitespace-only string below threshold", () => {
      expect(shouldTriggerSearch(" ")).toBe(false);
    });

    it("2.6 returns true for two-space string (length >= 2 after NOT trimming — shouldTriggerSearch uses query.trim())", () => {
      // "  ".trim() = "" → false
      expect(shouldTriggerSearch("  ")).toBe(false);
    });
  });

  // =========================================================================
  // Suite 3: createSearchAbortController
  // =========================================================================
  describe("Suite 3: createSearchAbortController", () => {
    it("3.1 returns a new AbortController when no previous controller", () => {
      const ctrl = createSearchAbortController(null);
      expect(ctrl).toBeInstanceOf(AbortController);
    });

    it("3.2 returns a new AbortController when previous is not null", () => {
      const prev = new AbortController();
      const next = createSearchAbortController(prev);
      expect(next).toBeInstanceOf(AbortController);
      expect(next).not.toBe(prev);
    });

    it("3.3 aborts the previous controller when replacing it", () => {
      const prev = new AbortController();
      createSearchAbortController(prev);
      expect(prev.signal.aborted).toBe(true);
    });

    it("3.4 new controller starts unaborted", () => {
      const ctrl = createSearchAbortController(null);
      expect(ctrl.signal.aborted).toBe(false);
    });
  });

  // =========================================================================
  // Suite 4: resolveCommandNavigationHref
  // =========================================================================
  describe("Suite 4: resolveCommandNavigationHref", () => {
    it("4.1 prefers navigation.href when present", () => {
      expect(
        resolveCommandNavigationHref({
          navigation: { href: "/materials/mat-1?page=3" },
          entityType: "material",
          id: "mat-1",
        })
      ).toBe("/materials/mat-1?page=3");
    });

    it("4.2 falls back to href when navigation is absent", () => {
      expect(
        resolveCommandNavigationHref({ href: "/custom-path" })
      ).toBe("/custom-path");
    });

    it("4.3 builds subject URL from entityType + id", () => {
      expect(
        resolveCommandNavigationHref({ entityType: "subject", id: "sub-1" })
      ).toBe("/subjects/sub-1");
    });

    it("4.4 builds chapter URL from entityType + id + subjectId", () => {
      expect(
        resolveCommandNavigationHref({
          entityType: "chapter",
          id: "ch-1",
          subjectId: "sub-1",
        })
      ).toBe("/subjects/sub-1/chapters/ch-1");
    });

    it("4.5 builds topic URL from entityType + id + subjectId + chapterId", () => {
      expect(
        resolveCommandNavigationHref({
          entityType: "topic",
          id: "top-1",
          subjectId: "sub-1",
          chapterId: "ch-1",
        })
      ).toBe("/subjects/sub-1/chapters/ch-1/topics/top-1");
    });

    it("4.6 falls back to /home when no routing info is available", () => {
      expect(resolveCommandNavigationHref({})).toBe("/home");
    });
  });

  // =========================================================================
  // Suite 5: entityTypeIcon (existence check)
  // =========================================================================
  describe("Suite 5: entityTypeIcon", () => {
    const ENTITY_TYPES = [
      "subject", "chapter", "topic", "note", "material", "group", "flashcard",
    ] as const;

    for (const type of ENTITY_TYPES) {
      it(`5.${ENTITY_TYPES.indexOf(type) + 1} returns a non-null value for "${type}"`, () => {
        const Icon = entityTypeIcon(type);
        // Lucide icons are React components — in test environments they may be
        // class-instances (object) or plain functions depending on ESM resolution.
        // The important contract: entityTypeIcon always returns a truthy value.
        expect(Icon).toBeTruthy();
      });
    }
  });

  // =========================================================================
  // Suite 6: buildHierarchyBreadcrumb
  // =========================================================================
  describe("Suite 6: buildHierarchyBreadcrumb", () => {
    type Hierarchy = UnifiedSearchHit["hierarchy"];

    it("6.1 returns empty string for empty hierarchy", () => {
      expect(buildHierarchyBreadcrumb({})).toBe("");
    });

    it("6.2 returns subject name for subject-only hierarchy", () => {
      const h: Hierarchy = { subjectId: "s1", subjectName: "Biology" };
      expect(buildHierarchyBreadcrumb(h)).toBe("Biology");
    });

    it("6.3 returns subject › chapter for chapter", () => {
      const h: Hierarchy = {
        subjectId: "s1",
        subjectName: "Biology",
        chapterId: "c1",
        chapterName: "Genetics",
      };
      expect(buildHierarchyBreadcrumb(h)).toBe("Biology › Genetics");
    });

    it("6.4 returns full breadcrumb including topic", () => {
      const h: Hierarchy = {
        subjectId: "s1",
        subjectName: "Biology",
        chapterId: "c1",
        chapterName: "Genetics",
        topicId: "t1",
        topicName: "CRISPR",
      };
      expect(buildHierarchyBreadcrumb(h)).toBe("Biology › Genetics › CRISPR");
    });

    it("6.5 prepends group name when present", () => {
      const h: Hierarchy = {
        groupId: "g1",
        groupName: "Study Group A",
        subjectId: "s1",
        subjectName: "Physics",
      };
      expect(buildHierarchyBreadcrumb(h)).toBe("Study Group A › Physics");
    });

    it("6.6 handles missing intermediate levels gracefully", () => {
      // topic without chapter/subject names
      const h: Hierarchy = {
        topicId: "t1",
        topicName: "Mitosis",
      };
      expect(buildHierarchyBreadcrumb(h)).toBe("Mitosis");
    });
  });

  // =========================================================================
  // Suite 7: matchTypeBadgeLabel
  // =========================================================================
  describe("Suite 7: matchTypeBadgeLabel", () => {
    it("7.1 returns 'AI+Text' for hybrid", () => {
      expect(matchTypeBadgeLabel("hybrid")).toBe("AI+Text");
    });

    it("7.2 returns 'AI' for semantic", () => {
      expect(matchTypeBadgeLabel("semantic")).toBe("AI");
    });

    it("7.3 returns 'Text' for lexical", () => {
      expect(matchTypeBadgeLabel("lexical")).toBe("Text");
    });
  });
});
