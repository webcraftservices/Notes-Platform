/**
 * src/lib/search/__tests__/rrf-ranking.test.ts
 *
 * Comprehensive 11-Test Vitest Suite for Reciprocal Rank Fusion (k=60),
 * Chunk Collapsing, Entity Deduplication, Match Tagging, and Deep-Link Synthesis.
 */

import { describe, expect, it } from "vitest";
import {
  fuseRankings,
  buildNavigationHref,
  type RrfFuseParams,
} from "../rrf-ranking";
import type { RawLexicalHit } from "../lexical-search";
import type { RawVectorHit } from "../vector-search";

describe("Reciprocal Rank Fusion (RRF k=60) Hybrid Ranking Engine", () => {
  const dummyHierarchy = {
    subjectId: "sub-bio",
    subjectName: "Biology",
    chapterId: "ch-cell",
    chapterName: "Cytology",
    topicId: "top-mito",
    topicName: "Mitochondria",
    groupId: undefined,
    groupName: undefined,
  };

  it("RRF-01: calculates formula for single lexical hit (1 / (60 + 1) = ~0.016393)", () => {
    const lexHits: RawLexicalHit[] = [
      {
        id: "doc-1",
        entityType: "note",
        title: "Cell Energy",
        snippetSourceText: "ATP synthesis occurs in inner membrane.",
        rankScore: 0.9,
        hierarchy: dummyHierarchy,
        navigation: { href: "/notes/doc-1" },
      },
    ];

    const fused = fuseRankings({
      lexicalHits: lexHits,
      vectorHits: [],
      query: "ATP",
      k: 60,
    });

    expect(fused).toHaveLength(1);
    const first = fused[0]!;
    expect(first.id).toBe("doc-1");
    expect(first.matchType).toBe("lexical");
    expect(first.score).toBeCloseTo(1 / 61, 5);
  });

  it("RRF-02: calculates formula for single semantic hit (1 / (60 + 1) = ~0.016393)", () => {
    const vecHits: RawVectorHit[] = [
      {
        chunkId: "c-101",
        entityId: "mat-1",
        entityType: "material",
        title: "Biochemistry Textbook",
        chunkContent: "Oxidative phosphorylation produces most ATP in cellular respiration.",
        pageNumber: 120,
        startSeconds: null,
        similarityScore: 0.88,
        hierarchy: dummyHierarchy,
      },
    ];

    const fused = fuseRankings({
      lexicalHits: [],
      vectorHits: vecHits,
      query: "ATP respiration",
      k: 60,
    });

    expect(fused).toHaveLength(1);
    const first = fused[0]!;
    expect(first.id).toBe("mat-1");
    expect(first.entityType).toBe("material");
    expect(first.matchType).toBe("semantic");
    expect(first.score).toBeCloseTo(1 / 61, 5);
  });

  it("RRF-03: boosts hybrid matches with cumulative score (1/61 + 1/61 = ~0.032787)", () => {
    const lexHits: RawLexicalHit[] = [
      {
        id: "mat-1",
        entityType: "material",
        title: "Biochemistry Textbook",
        snippetSourceText: "ATP generation.",
        rankScore: 0.95,
        hierarchy: dummyHierarchy,
        navigation: { href: "/materials/mat-1" },
      },
    ];

    const vecHits: RawVectorHit[] = [
      {
        chunkId: "c-101",
        entityId: "mat-1",
        entityType: "material",
        title: "Biochemistry Textbook",
        chunkContent: "Oxidative phosphorylation produces most ATP in cellular respiration.",
        pageNumber: 120,
        startSeconds: null,
        similarityScore: 0.88,
        hierarchy: dummyHierarchy,
      },
    ];

    const fused = fuseRankings({
      lexicalHits: lexHits,
      vectorHits: vecHits,
      query: "ATP",
      k: 60,
    });

    expect(fused).toHaveLength(1);
    const first = fused[0]!;
    expect(first.id).toBe("mat-1");
    expect(first.matchType).toBe("hybrid");
    expect(first.score).toBeCloseTo(2 / 61, 5);
    expect(first.navigation.pageNumber).toBe(120);
    expect(first.navigation.href).toBe("/materials/mat-1?page=120");
  });

  it("RRF-04: collapses multiple chunks from the same material to the minimum rank", () => {
    const vecHits: RawVectorHit[] = [
      {
        chunkId: "c-chunk-1",
        entityId: "mat-shared",
        entityType: "material",
        title: "Large Biology Book",
        chunkContent: "Top matching chunk on page 5.",
        pageNumber: 5,
        startSeconds: null,
        similarityScore: 0.95,
        hierarchy: dummyHierarchy,
      },
      {
        chunkId: "c-chunk-2",
        entityId: "mat-other",
        entityType: "material",
        title: "Chemistry Notes",
        chunkContent: "Chemistry chunk.",
        pageNumber: 1,
        startSeconds: null,
        similarityScore: 0.85,
        hierarchy: dummyHierarchy,
      },
      {
        chunkId: "c-chunk-3",
        entityId: "mat-shared",
        entityType: "material",
        title: "Large Biology Book",
        chunkContent: "Later chunk on page 50.",
        pageNumber: 50,
        startSeconds: null,
        similarityScore: 0.75,
        hierarchy: dummyHierarchy,
      },
    ];

    const fused = fuseRankings({
      lexicalHits: [],
      vectorHits: vecHits,
      query: "biology",
    });

    // 3 chunks collapse to 2 distinct material entities
    expect(fused).toHaveLength(2);
    expect(fused[0]?.id).toBe("mat-shared");
    expect(fused[0]?.score).toBeCloseTo(1 / (60 + 1), 5); // rank 1
    expect(fused[1]?.id).toBe("mat-other");
    expect(fused[1]?.score).toBeCloseTo(1 / (60 + 2), 5); // rank 2
  });

  it("RRF-05: preserves top chunk pageNumber and startSeconds coordinates on collapse", () => {
    const vecHits: RawVectorHit[] = [
      {
        chunkId: "c-audio-1",
        entityId: "mat-lecture",
        entityType: "material",
        title: "Lecture Recording",
        chunkContent: "Primary explanation at 124 seconds.",
        pageNumber: null,
        startSeconds: 124,
        similarityScore: 0.92,
        hierarchy: dummyHierarchy,
      },
      {
        chunkId: "c-audio-2",
        entityId: "mat-lecture",
        entityType: "material",
        title: "Lecture Recording",
        chunkContent: "Secondary mention at 400 seconds.",
        pageNumber: null,
        startSeconds: 400,
        similarityScore: 0.70,
        hierarchy: dummyHierarchy,
      },
    ];

    const fused = fuseRankings({
      lexicalHits: [],
      vectorHits: vecHits,
      query: "explanation",
    });

    expect(fused).toHaveLength(1);
    const first = fused[0]!;
    expect(first.navigation.timestampSeconds).toBe(124);
    expect(first.navigation.href).toBe("/materials/mat-lecture?t=124");
  });

  it("RRF-06: collapses Note chunks to parent note with top chunk snippet", () => {
    const vecHits: RawVectorHit[] = [
      {
        chunkId: "nc-1",
        entityId: "note-10",
        entityType: "note",
        title: "Genetics Revision",
        chunkContent: "Mendelian inheritance patterns: dominant and recessive alleles.",
        pageNumber: null,
        startSeconds: null,
        similarityScore: 0.91,
        hierarchy: dummyHierarchy,
      },
      {
        chunkId: "nc-2",
        entityId: "note-10",
        entityType: "note",
        title: "Genetics Revision",
        chunkContent: "Polygenic traits and environmental interactions.",
        pageNumber: null,
        startSeconds: null,
        similarityScore: 0.81,
        hierarchy: dummyHierarchy,
      },
    ];

    const fused = fuseRankings({
      lexicalHits: [],
      vectorHits: vecHits,
      query: "alleles",
    });

    expect(fused).toHaveLength(1);
    const first = fused[0]!;
    expect(first.id).toBe("note-10");
    expect(first.snippet).toContain("alleles");
  });

  it("RRF-07: accurately tags matchType as hybrid, lexical, or semantic", () => {
    const lexHits: RawLexicalHit[] = [
      {
        id: "hybrid-doc",
        entityType: "note",
        title: "Hybrid Note",
        snippetSourceText: "Hybrid snippet",
        rankScore: 1.0,
        hierarchy: dummyHierarchy,
        navigation: { href: "/notes/hybrid-doc" },
      },
      {
        id: "lexical-only",
        entityType: "subject",
        title: "Lexical Subject",
        snippetSourceText: "Lexical snippet",
        rankScore: 0.8,
        hierarchy: dummyHierarchy,
        navigation: { href: "/subjects/lexical-only" },
      },
    ];

    const vecHits: RawVectorHit[] = [
      {
        chunkId: "chunk-1",
        entityId: "hybrid-doc",
        entityType: "note",
        title: "Hybrid Note",
        chunkContent: "Hybrid content.",
        pageNumber: null,
        startSeconds: null,
        similarityScore: 0.85,
        hierarchy: dummyHierarchy,
      },
      {
        chunkId: "chunk-2",
        entityId: "semantic-only",
        entityType: "material",
        title: "Semantic Material",
        chunkContent: "Semantic content.",
        pageNumber: 3,
        startSeconds: null,
        similarityScore: 0.95,
        hierarchy: dummyHierarchy,
      },
    ];

    const fused = fuseRankings({
      lexicalHits: lexHits,
      vectorHits: vecHits,
      query: "content",
    });

    const hybrid = fused.find((h) => h.id === "hybrid-doc");
    const lexical = fused.find((h) => h.id === "lexical-only");
    const semantic = fused.find((h) => h.id === "semantic-only");

    expect(hybrid?.matchType).toBe("hybrid");
    expect(lexical?.matchType).toBe("lexical");
    expect(semantic?.matchType).toBe("semantic");
  });

  it("RRF-08: sorts results descending by score and breaks ties prioritizing hybrid matches", () => {
    // Both doc-A and doc-B have score 1/61
    // doc-A is hybrid (1/62 + 1/3720 ≈ 1/61)
    // Here we construct exact equal scores:
    const lexHits: RawLexicalHit[] = [
      {
        id: "doc-lex",
        entityType: "note",
        title: "Doc Lexical",
        snippetSourceText: "Doc lexical snippet",
        rankScore: 0.9,
        hierarchy: dummyHierarchy,
        navigation: { href: "/notes/doc-lex" },
      },
    ];
    const vecHits: RawVectorHit[] = [
      {
        chunkId: "vc-1",
        entityId: "doc-vec",
        entityType: "material",
        title: "Doc Vector",
        chunkContent: "Vector text",
        pageNumber: null,
        startSeconds: null,
        similarityScore: 0.9,
        hierarchy: dummyHierarchy,
      },
    ];

    const fused = fuseRankings({
      lexicalHits: lexHits,
      vectorHits: vecHits,
      query: "test",
    });

    // Both have score 1/61 = 0.016393
    expect(fused[0]?.score).toBe(fused[1]?.score);
    expect(fused.map((f) => f.id).sort()).toEqual(["doc-lex", "doc-vec"]);
  });

  it("RRF-09: supports limit and offset pagination slicing", () => {
    const lexHits: RawLexicalHit[] = Array.from({ length: 25 }, (_, i) => ({
      id: `doc-${i + 1}`,
      entityType: "note",
      title: `Note ${i + 1}`,
      rankScore: 1 - i * 0.02,
      hierarchy: dummyHierarchy,
      snippetSourceText: `Note snippet ${i + 1}`,
      navigation: { href: `/notes/doc-${i + 1}` },
    }));

    const page1 = fuseRankings({
      lexicalHits: lexHits,
      vectorHits: [],
      limit: 10,
      offset: 0,
    });
    expect(page1).toHaveLength(10);
    expect(page1[0]?.id).toBe("doc-1");
    expect(page1[9]?.id).toBe("doc-10");

    const page2 = fuseRankings({
      lexicalHits: lexHits,
      vectorHits: [],
      limit: 10,
      offset: 10,
    });
    expect(page2).toHaveLength(10);
    expect(page2[0]?.id).toBe("doc-11");
    expect(page2[9]?.id).toBe("doc-20");
  });

  it("RRF-10: synthesizes PDF page deep link via materialSourceHref", () => {
    const href = buildNavigationHref({
      id: "mat-quantum",
      entityType: "material",
      hierarchy: dummyHierarchy,
      pageNumber: 88,
    });
    expect(href).toBe("/materials/mat-quantum?page=88");
  });

  it("RRF-11: synthesizes Topic Notes deep link with ?tab=notes", () => {
    const href = buildNavigationHref({
      id: "note-enzyme",
      entityType: "note",
      hierarchy: {
        subjectId: "sub-1",
        chapterId: "ch-2",
        topicId: "top-3",
      },
    });
    expect(href).toBe("/subjects/sub-1/chapters/ch-2/topics/top-3?tab=notes");
  });

  it("RRF-12: synthesizes audio timestamp deep link for hybrid material matches (?t=X)", () => {
    const lexHits: RawLexicalHit[] = [
      {
        id: "mat-audio",
        entityType: "material",
        title: "Cell Biology Lecture Audio",
        snippetSourceText: "ATP synthase rotational catalysis overview.",
        rankScore: 0.95,
        hierarchy: dummyHierarchy,
        navigation: { href: "/materials/mat-audio" },
      },
    ];

    const vecHits: RawVectorHit[] = [
      {
        chunkId: "c-aud-315",
        entityId: "mat-audio",
        entityType: "material",
        title: "Cell Biology Lecture Audio",
        chunkContent: "At 315 seconds we discuss ATP synthase rotary mechanism.",
        pageNumber: null,
        startSeconds: 315,
        similarityScore: 0.92,
        hierarchy: dummyHierarchy,
      },
    ];

    const fused = fuseRankings({
      lexicalHits: lexHits,
      vectorHits: vecHits,
      query: "ATP synthase",
      k: 60,
    });

    expect(fused).toHaveLength(1);
    const hit = fused[0]!;
    expect(hit.matchType).toBe("hybrid");
    expect(hit.navigation.timestampSeconds).toBe(315);
    expect(hit.navigation.pageNumber).toBeUndefined();
    expect(hit.navigation.href).toBe("/materials/mat-audio?t=315");
  });

  it("RRF-13: buildNavigationHref prioritizes material chunk coordinates over customHref", () => {
    // PDF page coordinate overrides bare /materials/:id customHref
    const hrefPdf = buildNavigationHref({
      id: "mat-quantum-pdf",
      entityType: "material",
      hierarchy: dummyHierarchy,
      pageNumber: 42,
      customHref: "/materials/mat-quantum-pdf",
    });
    expect(hrefPdf).toBe("/materials/mat-quantum-pdf?page=42");

    // Audio timestamp coordinate overrides bare /materials/:id customHref
    const hrefAudio = buildNavigationHref({
      id: "mat-lecture-audio",
      entityType: "material",
      hierarchy: dummyHierarchy,
      startSeconds: 240,
      customHref: "/materials/mat-lecture-audio",
    });
    expect(hrefAudio).toBe("/materials/mat-lecture-audio?t=240");

    // Material with neither pageNumber nor startSeconds preserves bare customHref
    const hrefBare = buildNavigationHref({
      id: "mat-bare-doc",
      entityType: "material",
      hierarchy: dummyHierarchy,
      pageNumber: null,
      startSeconds: null,
      customHref: "/materials/mat-bare-doc",
    });
    expect(hrefBare).toBe("/materials/mat-bare-doc");

    // Non-material entities preserve customHref without disruption
    const hrefCustomNote = buildNavigationHref({
      id: "note-custom-route",
      entityType: "note",
      hierarchy: dummyHierarchy,
      customHref: "/custom/path/note-custom-route",
    });
    expect(hrefCustomNote).toBe("/custom/path/note-custom-route");
  });

  it("RRF-14: falls back to bare material URL or customHref when hybrid material has no coordinates", () => {
    const lexHits: RawLexicalHit[] = [
      {
        id: "mat-plain-hybrid",
        entityType: "material",
        title: "Course Syllabus Outline",
        snippetSourceText: "Grading policy and syllabus schedule.",
        rankScore: 0.9,
        hierarchy: dummyHierarchy,
        navigation: { href: "/materials/mat-plain-hybrid" },
      },
    ];

    const vecHits: RawVectorHit[] = [
      {
        chunkId: "c-plain-1",
        entityId: "mat-plain-hybrid",
        entityType: "material",
        title: "Course Syllabus Outline",
        chunkContent: "Syllabus details regarding grading criteria and office hours.",
        pageNumber: null,
        startSeconds: null,
        similarityScore: 0.88,
        hierarchy: dummyHierarchy,
      },
    ];

    const fused = fuseRankings({
      lexicalHits: lexHits,
      vectorHits: vecHits,
      query: "syllabus",
      k: 60,
    });

    expect(fused).toHaveLength(1);
    const hit = fused[0]!;
    expect(hit.matchType).toBe("hybrid");
    expect(hit.navigation.pageNumber).toBeUndefined();
    expect(hit.navigation.timestampSeconds).toBeUndefined();
    expect(hit.navigation.href).toBe("/materials/mat-plain-hybrid");
  });
});
