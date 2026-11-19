/**
 * src/lib/search/__tests__/challenger-nav-deep-link.stress.test.ts
 *
 * EMPIRICAL ADVERSARIAL CHALLENGER SUITE — Challenger 1 (Milestone 2 Iteration 2)
 * Focused Stress Testing on Navigation Href Synthesis, Deep Linking, and Boundary Edge Cases.
 */

import { describe, it, expect } from "vitest";
import {
  fuseRankings,
  buildNavigationHref,
} from "../rrf-ranking";
import { materialSourceHref } from "@/lib/material-link";
import type { RawLexicalHit } from "../lexical-search";
import type { RawVectorHit } from "../vector-search";

describe("Adversarial Challenger 1: Navigation & Deep-Link Stress Suite", () => {
  const dummyHierarchy = {
    subjectId: "subj-chem-101",
    subjectName: "Organic Chemistry",
    chapterId: "chap-alcohols",
    chapterName: "Alcohols & Ethers",
    topicId: "top-reactions",
    topicName: "Substitution Reactions",
    groupId: "grp-study-chem",
    groupName: "Chem Honors",
  };

  const emptyHierarchy = {};

  // ==========================================================================
  // Section 1: Hybrid Material With Missing Coordinates
  // ==========================================================================
  describe("Section 1: Hybrid Material Missing Coordinates Edge Cases", () => {
    it("CHAL-NAV-01: hybrid material with null page and null startSeconds outputs bare /materials/:id", () => {
      const lexHit: RawLexicalHit = {
        id: "mat-null-coords",
        entityType: "material",
        title: "General Syllabus",
        snippetSourceText: "Syllabus for organic chemistry.",
        rankScore: 0.92,
        hierarchy: dummyHierarchy,
        navigation: { href: "/materials/mat-null-coords" },
      };

      const vecHit: RawVectorHit = {
        chunkId: "c-null-1",
        entityId: "mat-null-coords",
        entityType: "material",
        title: "General Syllabus",
        chunkContent: "Grading rubric and office hours.",
        pageNumber: null,
        startSeconds: null,
        similarityScore: 0.88,
        hierarchy: dummyHierarchy,
      };

      const fused = fuseRankings({
        lexicalHits: [lexHit],
        vectorHits: [vecHit],
        query: "grading",
      });

      expect(fused).toHaveLength(1);
      const hit = fused[0]!;
      expect(hit.matchType).toBe("hybrid");
      expect(hit.navigation.pageNumber).toBeUndefined();
      expect(hit.navigation.timestampSeconds).toBeUndefined();
      expect(hit.navigation.href).toBe("/materials/mat-null-coords");
      expect(hit.navigation.href).not.toContain("?");
    });

    it("CHAL-NAV-02: hybrid material with undefined coordinates outputs bare /materials/:id", () => {
      const lexHit: RawLexicalHit = {
        id: "mat-undef-coords",
        entityType: "material",
        title: "Lab Safety",
        snippetSourceText: "Wear goggles at all times.",
        rankScore: 0.9,
        hierarchy: dummyHierarchy,
      };

      const vecHit: RawVectorHit = {
        chunkId: "c-undef-1",
        entityId: "mat-undef-coords",
        entityType: "material",
        title: "Lab Safety",
        chunkContent: "Safety protocols in chemical handling.",
        pageNumber: null,
        startSeconds: null,
        similarityScore: 0.85,
        hierarchy: dummyHierarchy,
      };

      const fused = fuseRankings({
        lexicalHits: [lexHit],
        vectorHits: [vecHit],
        query: "safety",
      });

      expect(fused).toHaveLength(1);
      const hit = fused[0]!;
      expect(hit.matchType).toBe("hybrid");
      expect(hit.navigation.href).toBe("/materials/mat-undef-coords");
      expect(hit.navigation.href).not.toContain("?");
    });
  });

  // ==========================================================================
  // Section 2: Invalid, Zero, and Negative Page Numbers
  // ==========================================================================
  describe("Section 2: Material Page Number Boundary & Degeneracy Stress", () => {
    it("CHAL-NAV-03: page=0 is omitted and falls back to bare material URL", () => {
      const href = buildNavigationHref({
        id: "mat-page-zero",
        entityType: "material",
        hierarchy: dummyHierarchy,
        pageNumber: 0,
      });
      expect(href).toBe("/materials/mat-page-zero");

      // Also verify via full fuseRankings
      const lexHit: RawLexicalHit = {
        id: "mat-page-zero",
        entityType: "material",
        title: "Zero Page Doc",
        rankScore: 0.9,
        hierarchy: dummyHierarchy,
        navigation: { href: "/materials/mat-page-zero" },
      };
      const vecHit: RawVectorHit = {
        chunkId: "c-p0",
        entityId: "mat-page-zero",
        entityType: "material",
        title: "Zero Page Doc",
        chunkContent: "Content with page zero metadata.",
        pageNumber: 0,
        startSeconds: null,
        similarityScore: 0.9,
        hierarchy: dummyHierarchy,
      };

      const fused = fuseRankings({
        lexicalHits: [lexHit],
        vectorHits: [vecHit],
        query: "metadata",
      });

      expect(fused[0]?.navigation.href).toBe("/materials/mat-page-zero");
    });

    it("CHAL-NAV-04: negative page numbers (-1, -42) fall back to bare material URL", () => {
      const hrefNeg1 = buildNavigationHref({
        id: "mat-neg-page",
        entityType: "material",
        hierarchy: dummyHierarchy,
        pageNumber: -1,
      });
      expect(hrefNeg1).toBe("/materials/mat-neg-page");

      const hrefNeg42 = buildNavigationHref({
        id: "mat-neg-page",
        entityType: "material",
        hierarchy: dummyHierarchy,
        pageNumber: -42,
      });
      expect(hrefNeg42).toBe("/materials/mat-neg-page");

      expect(materialSourceHref({ materialId: "m1", page: -100 })).toBe("/materials/m1");
    });

    it("CHAL-NAV-05: fractional page numbers floor to integer page", () => {
      const href = buildNavigationHref({
        id: "mat-frac-page",
        entityType: "material",
        hierarchy: dummyHierarchy,
        pageNumber: 42.9,
      });
      expect(href).toBe("/materials/mat-frac-page?page=42");

      expect(materialSourceHref({ materialId: "m1", page: 1.001 })).toBe("/materials/m1?page=1");
    });

    it("CHAL-NAV-06: NaN and Infinite page values fall back to bare material URL", () => {
      expect(materialSourceHref({ materialId: "m1", page: Number.NaN })).toBe("/materials/m1");
      expect(materialSourceHref({ materialId: "m1", page: Number.POSITIVE_INFINITY })).toBe("/materials/m1");
      expect(materialSourceHref({ materialId: "m1", page: Number.NEGATIVE_INFINITY })).toBe("/materials/m1");
    });
  });

  // ==========================================================================
  // Section 3: Timestamp Boundary & Degeneracy Stress
  // ==========================================================================
  describe("Section 3: Audio Timestamp Boundary & Degeneracy Stress", () => {
    it("CHAL-NAV-07: timestamp=0 is valid (beginning of audio) and produces ?t=0", () => {
      const href = buildNavigationHref({
        id: "mat-audio-zero",
        entityType: "material",
        hierarchy: dummyHierarchy,
        startSeconds: 0,
      });
      expect(href).toBe("/materials/mat-audio-zero?t=0");

      const lexHit: RawLexicalHit = {
        id: "mat-audio-zero",
        entityType: "material",
        title: "Lecture Intro",
        rankScore: 0.9,
        hierarchy: dummyHierarchy,
        navigation: { href: "/materials/mat-audio-zero" },
      };
      const vecHit: RawVectorHit = {
        chunkId: "c-t0",
        entityId: "mat-audio-zero",
        entityType: "material",
        title: "Lecture Intro",
        chunkContent: "Welcome to class today at zero seconds.",
        pageNumber: null,
        startSeconds: 0,
        similarityScore: 0.9,
        hierarchy: dummyHierarchy,
      };

      const fused = fuseRankings({
        lexicalHits: [lexHit],
        vectorHits: [vecHit],
        query: "welcome",
      });

      expect(fused[0]?.navigation.href).toBe("/materials/mat-audio-zero?t=0");
      expect(fused[0]?.navigation.timestampSeconds).toBe(0);
    });

    it("CHAL-NAV-08: negative timestamps fall back to bare material URL", () => {
      const hrefNeg = buildNavigationHref({
        id: "mat-audio-neg",
        entityType: "material",
        hierarchy: dummyHierarchy,
        startSeconds: -15,
      });
      expect(hrefNeg).toBe("/materials/mat-audio-neg");

      expect(materialSourceHref({ materialId: "m1", timestampSeconds: -1 })).toBe("/materials/m1");
      expect(materialSourceHref({ materialId: "m1", timestampSeconds: -9999 })).toBe("/materials/m1");
    });

    it("CHAL-NAV-09: fractional timestamps floor to integer seconds", () => {
      const hrefFrac = buildNavigationHref({
        id: "mat-audio-frac",
        entityType: "material",
        hierarchy: dummyHierarchy,
        startSeconds: 315.85,
      });
      expect(hrefFrac).toBe("/materials/mat-audio-frac?t=315");
    });

    it("CHAL-NAV-10: when both page and timestamp exist, page takes precedence", () => {
      const hrefBoth = buildNavigationHref({
        id: "mat-both",
        entityType: "material",
        hierarchy: dummyHierarchy,
        pageNumber: 5,
        startSeconds: 300,
      });
      expect(hrefBoth).toBe("/materials/mat-both?page=5");
      expect(hrefBoth).not.toContain("?t=");
    });
  });

  // ==========================================================================
  // Section 4: Pure Vector vs Pure Lexical vs Hybrid Consistency
  // ==========================================================================
  describe("Section 4: Cross-Channel Retrieval Routing Consistency", () => {
    it("CHAL-NAV-11: verifies routing consistency across pure lexical, pure vector, and hybrid", () => {
      // 1. Pure lexical material hit
      const lexOnlyHits: RawLexicalHit[] = [
        {
          id: "mat-common",
          entityType: "material",
          title: "Mechanics Text",
          rankScore: 0.95,
          hierarchy: dummyHierarchy,
          navigation: { href: "/materials/mat-common" },
        },
      ];
      const fusedLex = fuseRankings({
        lexicalHits: lexOnlyHits,
        vectorHits: [],
        query: "mechanics",
      });
      expect(fusedLex[0]?.matchType).toBe("lexical");
      expect(fusedLex[0]?.navigation.href).toBe("/materials/mat-common");
      expect(fusedLex[0]?.navigation.pageNumber).toBeUndefined();

      // 2. Pure vector material hit with page
      const vecOnlyHits: RawVectorHit[] = [
        {
          chunkId: "c-vec-only",
          entityId: "mat-common",
          entityType: "material",
          title: "Mechanics Text",
          chunkContent: "Kinematics equations on page 14.",
          pageNumber: 14,
          startSeconds: null,
          similarityScore: 0.92,
          hierarchy: dummyHierarchy,
        },
      ];
      const fusedVec = fuseRankings({
        lexicalHits: [],
        vectorHits: vecOnlyHits,
        query: "kinematics",
      });
      expect(fusedVec[0]?.matchType).toBe("semantic");
      expect(fusedVec[0]?.navigation.href).toBe("/materials/mat-common?page=14");
      expect(fusedVec[0]?.navigation.pageNumber).toBe(14);

      // 3. Hybrid hit combining both
      const fusedHybrid = fuseRankings({
        lexicalHits: lexOnlyHits,
        vectorHits: vecOnlyHits,
        query: "mechanics kinematics",
      });
      expect(fusedHybrid[0]?.matchType).toBe("hybrid");
      expect(fusedHybrid[0]?.navigation.href).toBe("/materials/mat-common?page=14");
      expect(fusedHybrid[0]?.navigation.pageNumber).toBe(14);
    });

    it("CHAL-NAV-12: verifies pure vector audio hit matches hybrid audio hit routing", () => {
      const vecAudio: RawVectorHit = {
        chunkId: "c-aud-rec",
        entityId: "mat-audio-pod",
        entityType: "material",
        title: "Chem Podcast",
        chunkContent: "Kinetics discussion at 540 seconds.",
        pageNumber: null,
        startSeconds: 540,
        similarityScore: 0.89,
        hierarchy: dummyHierarchy,
      };

      const lexAudio: RawLexicalHit = {
        id: "mat-audio-pod",
        entityType: "material",
        title: "Chem Podcast",
        rankScore: 0.85,
        hierarchy: dummyHierarchy,
        navigation: { href: "/materials/mat-audio-pod" },
      };

      // Pure semantic
      const fusedSem = fuseRankings({
        lexicalHits: [],
        vectorHits: [vecAudio],
        query: "kinetics",
      });
      expect(fusedSem[0]?.navigation.href).toBe("/materials/mat-audio-pod?t=540");

      // Hybrid
      const fusedHyb = fuseRankings({
        lexicalHits: [lexAudio],
        vectorHits: [vecAudio],
        query: "kinetics",
      });
      expect(fusedHyb[0]?.navigation.href).toBe("/materials/mat-audio-pod?t=540");
      expect(fusedHyb[0]?.navigation.timestampSeconds).toBe(540);
    });
  });

  // ==========================================================================
  // Section 5: Non-Material Entities Never Receive Material Query Parameters
  // ==========================================================================
  describe("Section 5: Non-Material Routing Isolation", () => {
    it("CHAL-NAV-13: notes inside hierarchy route to ?tab=notes and never receive ?page= or ?t=", () => {
      const noteHref = buildNavigationHref({
        id: "note-123",
        entityType: "note",
        hierarchy: dummyHierarchy,
        pageNumber: 42, // Adversarial: coordinate injection on a note
        startSeconds: 300,
      });

      expect(noteHref).toBe(
        "/subjects/subj-chem-101/chapters/chap-alcohols/topics/top-reactions?tab=notes"
      );
      expect(noteHref).not.toContain("?page=");
      expect(noteHref).not.toContain("?t=");
    });

    it("CHAL-NAV-14: standalone note routes to /notes/:id and never receives ?page= or ?t=", () => {
      const noteStandalone = buildNavigationHref({
        id: "note-orphan-99",
        entityType: "note",
        hierarchy: emptyHierarchy,
        pageNumber: 10,
        startSeconds: 50,
      });

      expect(noteStandalone).toBe("/notes/note-orphan-99");
      expect(noteStandalone).not.toContain("?");
    });

    it("CHAL-NAV-15: topics, chapters, subjects, groups, flashcards never receive ?page= or ?t=", () => {
      const topicHref = buildNavigationHref({
        id: "top-react",
        entityType: "topic",
        hierarchy: dummyHierarchy,
        pageNumber: 15,
        startSeconds: 120,
      });
      expect(topicHref).toBe("/subjects/subj-chem-101/chapters/chap-alcohols/topics/top-react");
      expect(topicHref).not.toContain("?");

      const chapterHref = buildNavigationHref({
        id: "chap-alc",
        entityType: "chapter",
        hierarchy: dummyHierarchy,
        pageNumber: 8,
      });
      expect(chapterHref).toBe("/subjects/subj-chem-101/chapters/chap-alc");
      expect(chapterHref).not.toContain("?");

      const subjectHref = buildNavigationHref({
        id: "subj-chem",
        entityType: "subject",
        hierarchy: dummyHierarchy,
        pageNumber: 1,
      });
      expect(subjectHref).toBe("/subjects/subj-chem");
      expect(subjectHref).not.toContain("?");

      const groupHref = buildNavigationHref({
        id: "grp-study",
        entityType: "group",
        hierarchy: dummyHierarchy,
        pageNumber: 99,
      });
      expect(groupHref).toBe("/groups/grp-study");
      expect(groupHref).not.toContain("?");

      const flashcardHref = buildNavigationHref({
        id: "deck-rxn",
        entityType: "flashcard",
        hierarchy: dummyHierarchy,
        pageNumber: 12,
      });
      expect(flashcardHref).toBe("/flashcards/deck-rxn");
      expect(flashcardHref).not.toContain("?");
    });

    it("CHAL-NAV-16: hybrid fused Note never receives material deep links", () => {
      const lexNote: RawLexicalHit = {
        id: "note-fused-7",
        entityType: "note",
        title: "Enzyme Catalysis",
        snippetSourceText: "Lock and key model versus induced fit.",
        rankScore: 0.93,
        hierarchy: dummyHierarchy,
        navigation: {
          href: "/subjects/subj-chem-101/chapters/chap-alcohols/topics/top-reactions?tab=notes",
        },
      };

      const vecNote: RawVectorHit = {
        chunkId: "nc-enzyme-1",
        entityId: "note-fused-7",
        entityType: "note",
        title: "Enzyme Catalysis",
        chunkContent: "Active site conformational shifts during binding.",
        pageNumber: null,
        startSeconds: null,
        similarityScore: 0.91,
        hierarchy: dummyHierarchy,
      };

      const fused = fuseRankings({
        lexicalHits: [lexNote],
        vectorHits: [vecNote],
        query: "induced fit",
      });

      expect(fused).toHaveLength(1);
      const hit = fused[0]!;
      expect(hit.matchType).toBe("hybrid");
      expect(hit.navigation.href).toBe(
        "/subjects/subj-chem-101/chapters/chap-alcohols/topics/top-reactions?tab=notes"
      );
      expect(hit.navigation.pageNumber).toBeUndefined();
      expect(hit.navigation.timestampSeconds).toBeUndefined();
    });
  });

  // ==========================================================================
  // Section 6: Material ID URI Encoding Stress
  // ==========================================================================
  describe("Section 6: URI Encoding & Special Characters in Material IDs", () => {
    it("CHAL-NAV-17: encodes special characters in materialId without breaking query parameter syntax", () => {
      const complexId = "mat/2026 #1?doc";
      const href = materialSourceHref({
        materialId: complexId,
        page: 7,
      });

      expect(href).toBe("/materials/mat%2F2026%20%231%3Fdoc?page=7");
      expect(href.startsWith("/materials/")).toBe(true);
      expect(href.endsWith("?page=7")).toBe(true);
    });
  });
});
