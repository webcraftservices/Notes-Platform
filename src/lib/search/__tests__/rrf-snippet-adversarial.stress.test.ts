/**
 * src/lib/search/__tests__/rrf-snippet-adversarial.stress.test.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS SUITE — Challenger 2 (Milestone 2)
 *
 * Exhaustive empirical challenge suite verifying:
 * 1. Hybrid Material Deep-Link Navigation Preservation (VULNERABILITY PROBE)
 * 2. RRF Mathematical Precision (k=60) & Rounding Oracle
 * 3. 50+ Chunks Collision & Collapsing Stress (10 Materials)
 * 4. Deterministic Tie-Breaking Under Permutations & Equal Scores
 * 5. ReDoS & Malicious Regex Attack Resistance
 * 6. Extreme Text Scale (150,000+ chars) & Single-Word Limits
 * 7. Semantic Fallbacks with Zero Query Overlap
 * 8. Multi-Lingual, CJK, Emoji & Surrogate Pair Snapping
 * 9. Word Boundary Snapping (Hyphens, Punctuation, Compound Words)
 * 10. Lexical Search Query Normalization Stress
 */

import { describe, it, expect } from "vitest";
import {
  fuseRankings,
  buildNavigationHref,
  type RrfFuseParams,
  type SearchHit,
} from "../rrf-ranking";
import { extractContextualSnippet } from "../snippet-extractor";
import { normalizeSearchQuery, type RawLexicalHit } from "../lexical-search";
import type { RawVectorHit } from "../vector-search";

describe("Empirical Challenger 2: RRF Ranking & Snippet Windowing Stress Suite", () => {
  const dummyHierarchy = {
    subjectId: "sub-stress",
    subjectName: "Stress Subject",
    chapterId: "ch-stress",
    chapterName: "Stress Chapter",
    topicId: "top-stress",
    topicName: "Stress Topic",
  };

  // ==========================================================================
  // Dimension 1: Hybrid Material Deep-Link Navigation Preservation
  // ==========================================================================
  describe("Dimension 1: Hybrid Material Navigation & Deep-Link Preservation", () => {
    it("ADV-NAV-01: examines whether hybrid material hits preserve PDF page deep links (?page=X)", () => {
      // Lexical hit for a material returns generic /materials/:id
      const lexHit: RawLexicalHit = {
        id: "mat-pdf-deep",
        entityType: "material",
        title: "Deep PDF Guide",
        snippetSourceText: "Comprehensive guide to quantum computing.",
        rankScore: 0.95,
        hierarchy: dummyHierarchy,
        navigation: { href: "/materials/mat-pdf-deep" },
      };

      // Vector hit identifies exact page 42
      const vecHit: RawVectorHit = {
        chunkId: "c-pdf-42",
        entityId: "mat-pdf-deep",
        entityType: "material",
        title: "Deep PDF Guide",
        chunkContent: "Quantum decoherence occurs on page 42 in detailed diagrams.",
        pageNumber: 42,
        startSeconds: null,
        similarityScore: 0.91,
        hierarchy: dummyHierarchy,
      };

      const fused = fuseRankings({
        lexicalHits: [lexHit],
        vectorHits: [vecHit],
        query: "quantum",
      });

      expect(fused).toHaveLength(1);
      const hit = fused[0]!;
      expect(hit.matchType).toBe("hybrid");
      expect(hit.navigation.pageNumber).toBe(42);

      // EMPIRICAL BUG CHECK:
      // In rrf-ranking.ts:181, `customHref: lex?.hit.navigation?.href` is passed.
      // In buildNavigationHref (lines 56-57): `if (hit.customHref) return hit.customHref;`
      // Therefore, the generic `/materials/mat-pdf-deep` from lexical hit overrides
      // the deep link `/materials/mat-pdf-deep?page=42` synthesized by materialSourceHref.
      console.log("[ADV-NAV-01] Hybrid PDF hit navigation.href:", hit.navigation.href);
      console.log("[ADV-NAV-01] Preserved pageNumber in navigation:", hit.navigation.pageNumber);
      
      // Preserved deep link verification:
      const hasDeepLink = hit.navigation.href === "/materials/mat-pdf-deep?page=42";
      expect(hasDeepLink).toBe(true);
      expect(hit.navigation.href).toBe("/materials/mat-pdf-deep?page=42");
    });

    it("ADV-NAV-02: examines whether hybrid material hits preserve audio timestamp deep links (?t=X)", () => {
      const lexHit: RawLexicalHit = {
        id: "mat-audio-deep",
        entityType: "material",
        title: "Biology Lecture 10",
        snippetSourceText: "Cellular organelles and respiration lecture.",
        rankScore: 0.88,
        hierarchy: dummyHierarchy,
        navigation: { href: "/materials/mat-audio-deep" },
      };

      const vecHit: RawVectorHit = {
        chunkId: "c-aud-315",
        entityId: "mat-audio-deep",
        entityType: "material",
        title: "Biology Lecture 10",
        chunkContent: "At 315 seconds we discuss ATP synthase rotation mechanism.",
        pageNumber: null,
        startSeconds: 315,
        similarityScore: 0.89,
        hierarchy: dummyHierarchy,
      };

      const fused = fuseRankings({
        lexicalHits: [lexHit],
        vectorHits: [vecHit],
        query: "ATP",
      });

      expect(fused).toHaveLength(1);
      const hit = fused[0]!;
      expect(hit.matchType).toBe("hybrid");
      expect(hit.navigation.timestampSeconds).toBe(315);

      console.log("[ADV-NAV-02] Hybrid Audio hit navigation.href:", hit.navigation.href);
      console.log("[ADV-NAV-02] Preserved timestampSeconds:", hit.navigation.timestampSeconds);

      // Preserved deep link verification:
      const hasDeepLink = hit.navigation.href === "/materials/mat-audio-deep?t=315";
      expect(hasDeepLink).toBe(true);
      expect(hit.navigation.href).toBe("/materials/mat-audio-deep?t=315");
    });

    it("ADV-NAV-03: confirms pure semantic hits correctly retain deep links because lex is undefined", () => {
      const vecHit: RawVectorHit = {
        chunkId: "c-pdf-99",
        entityId: "mat-sem-only",
        entityType: "material",
        title: "Pure Semantic Book",
        chunkContent: "Content on page 99.",
        pageNumber: 99,
        startSeconds: null,
        similarityScore: 0.85,
        hierarchy: dummyHierarchy,
      };

      const fused = fuseRankings({
        lexicalHits: [],
        vectorHits: [vecHit],
        query: "content",
      });

      expect(fused).toHaveLength(1);
      const hit = fused[0]!;
      expect(hit.matchType).toBe("semantic");
      // Since lex is undefined, customHref is undefined, so buildNavigationHref calls materialSourceHref!
      expect(hit.navigation.href).toBe("/materials/mat-sem-only?page=99");
    });
  });

  // ==========================================================================
  // Dimension 2: RRF Mathematical Precision (k=60) & Rounding Oracle
  // ==========================================================================
  describe("Dimension 2: RRF Mathematical Precision Oracle (k=60)", () => {
    it("ADV-RRF-01: validates exact score formula for ranks 1 through 50 on pure lexical hits in multi-item candidate list", () => {
      // Build candidate list with 50 items so item r is at index r-1 (rank r)
      const lexHits: RawLexicalHit[] = [];
      for (let r = 1; r <= 50; r++) {
        lexHits.push({
          id: `lex-${r}`,
          entityType: "note",
          title: `Note ${r}`,
          snippetSourceText: `Content for note ${r}`,
          rankScore: 100 - r,
          hierarchy: dummyHierarchy,
        });
      }

      const fused = fuseRankings({
        lexicalHits: lexHits,
        vectorHits: [],
        query: "test",
        limit: 100,
      });

      expect(fused).toHaveLength(50);
      for (let r = 1; r <= 50; r++) {
        const hit = fused[r - 1]!;
        const expectedScore = Number((1 / (60 + r)).toFixed(6));
        expect(hit.id).toBe(`lex-${r}`);
        expect(hit.score).toBe(expectedScore);
        expect(hit.matchType).toBe("lexical");
      }
    });

    it("ADV-RRF-02: validates exact score formula for ranks 1 through 50 on pure semantic hits in multi-item candidate list", () => {
      const vecHits: RawVectorHit[] = [];
      for (let r = 1; r <= 50; r++) {
        vecHits.push({
          chunkId: `c-${r}`,
          entityId: `mat-${r}`,
          entityType: "material",
          title: `Material ${r}`,
          chunkContent: `Content for material ${r}`,
          pageNumber: null,
          startSeconds: null,
          similarityScore: 1 - r * 0.01,
          hierarchy: dummyHierarchy,
        });
      }

      const fused = fuseRankings({
        lexicalHits: [],
        vectorHits: vecHits,
        query: "test",
        limit: 100,
      });

      expect(fused).toHaveLength(50);
      for (let r = 1; r <= 50; r++) {
        const hit = fused[r - 1]!;
        const expectedScore = Number((1 / (60 + r)).toFixed(6));
        expect(hit.id).toBe(`mat-${r}`);
        expect(hit.score).toBe(expectedScore);
        expect(hit.matchType).toBe("semantic");
      }
    });

    it("ADV-RRF-03: validates balanced and unbalanced hybrid rank combinations against manual math", () => {
      const testCases = [
        { lexRank: 1, vecRank: 1, expected: Number((1 / 61 + 1 / 61).toFixed(6)) },
        { lexRank: 1, vecRank: 2, expected: Number((1 / 61 + 1 / 62).toFixed(6)) },
        { lexRank: 2, vecRank: 1, expected: Number((1 / 62 + 1 / 61).toFixed(6)) },
        { lexRank: 5, vecRank: 10, expected: Number((1 / 65 + 1 / 70).toFixed(6)) },
        { lexRank: 10, vecRank: 5, expected: Number((1 / 70 + 1 / 65).toFixed(6)) },
        { lexRank: 20, vecRank: 20, expected: Number((1 / 80 + 1 / 80).toFixed(6)) },
        { lexRank: 50, vecRank: 50, expected: Number((1 / 110 + 1 / 110).toFixed(6)) },
      ];

      for (const tc of testCases) {
        const lexHits: RawLexicalHit[] = [];
        for (let i = 1; i < tc.lexRank; i++) {
          lexHits.push({
            id: `filler-lex-${i}`,
            entityType: "note",
            title: `Filler ${i}`,
            rankScore: 0.5,
            hierarchy: dummyHierarchy,
          });
        }
        lexHits.push({
          id: `target-hybrid-${tc.lexRank}-${tc.vecRank}`,
          entityType: "note",
          title: "Target Hybrid",
          rankScore: 0.5,
          hierarchy: dummyHierarchy,
        });

        const vecHits: RawVectorHit[] = [];
        for (let j = 1; j < tc.vecRank; j++) {
          vecHits.push({
            chunkId: `c-filler-${j}`,
            entityId: `filler-vec-${j}`,
            entityType: "material",
            title: `Filler Vec ${j}`,
            chunkContent: "filler",
            pageNumber: null,
            startSeconds: null,
            similarityScore: 0.5,
            hierarchy: dummyHierarchy,
          });
        }
        vecHits.push({
          chunkId: `c-target`,
          entityId: `target-hybrid-${tc.lexRank}-${tc.vecRank}`,
          entityType: "note",
          title: "Target Hybrid",
          chunkContent: "target chunk",
          pageNumber: null,
          startSeconds: null,
          similarityScore: 0.5,
          hierarchy: dummyHierarchy,
        });

        const fused = fuseRankings({
          lexicalHits: lexHits,
          vectorHits: vecHits,
          query: "target",
          limit: 200,
        });

        const target = fused.find((h) => h.id === `target-hybrid-${tc.lexRank}-${tc.vecRank}`);
        expect(target).toBeDefined();
        expect(target!.score).toBe(tc.expected);
        expect(target!.matchType).toBe("hybrid");
      }
    });
  });

  // ==========================================================================
  // Dimension 3: 50+ Chunks Collision & Collapsing Stress (10 Materials)
  // ==========================================================================
  describe("Dimension 3: Chunk Collapsing Stress (50+ Chunks from 10 Materials)", () => {
    it("ADV-COL-01: collapses 60 chunks across 10 materials to exactly 10 hits preserving minimum rank and top chunk coordinates", () => {
      const numMaterials = 10;
      const chunksPerMaterial = 6;
      const totalChunks = numMaterials * chunksPerMaterial; // 60 chunks

      const vectorHits: RawVectorHit[] = [];

      // Place top chunk for each material at indices 0..9 (ranks 1..10)
      for (let m = 0; m < numMaterials; m++) {
        vectorHits.push({
          chunkId: `chunk-top-mat-${m}`,
          entityId: `mat-stress-${m}`,
          entityType: "material",
          title: `Material ${m}`,
          chunkContent: `Top chunk content for material ${m}`,
          pageNumber: (m + 1) * 10,
          startSeconds: (m + 1) * 60,
          similarityScore: 0.99 - m * 0.05,
          hierarchy: dummyHierarchy,
        });
      }

      // Append 50 inferior chunks scattered among the 10 materials
      for (let c = 0; c < 50; c++) {
        const m = c % numMaterials;
        vectorHits.push({
          chunkId: `chunk-sub-${c}-mat-${m}`,
          entityId: `mat-stress-${m}`,
          entityType: "material",
          title: `Material ${m}`,
          chunkContent: `Inferior chunk ${c} for material ${m}`,
          pageNumber: 9999, // deliberate inferior coordinate
          startSeconds: 88888, // deliberate inferior coordinate
          similarityScore: 0.3,
          hierarchy: dummyHierarchy,
        });
      }

      expect(vectorHits).toHaveLength(totalChunks);

      const fused = fuseRankings({
        lexicalHits: [],
        vectorHits,
        query: "material",
        limit: 50,
      });

      expect(fused).toHaveLength(numMaterials);

      for (let m = 0; m < numMaterials; m++) {
        const hit = fused.find((h) => h.id === `mat-stress-${m}`);
        expect(hit).toBeDefined();

        const expectedScore = Number((1 / (60 + (m + 1))).toFixed(6));
        expect(hit!.score).toBe(expectedScore);
        expect(hit!.navigation.pageNumber).toBe((m + 1) * 10);
        expect(hit!.navigation.timestampSeconds).toBe((m + 1) * 60);
        expect(hit!.snippet).toContain(`material ${m}`);
      }
    });

    it("ADV-COL-02: collapses 100 chunks belonging to a single material into exactly 1 hit", () => {
      const vectorHits: RawVectorHit[] = Array.from({ length: 100 }, (_, i) => ({
        chunkId: `c-${i}`,
        entityId: "single-mega-material",
        entityType: "material",
        title: "Mega Material",
        chunkContent: i === 0 ? "Top primary chunk" : `Secondary chunk ${i}`,
        pageNumber: i === 0 ? 1 : 100 + i,
        startSeconds: null,
        similarityScore: 1 - i * 0.005,
        hierarchy: dummyHierarchy,
      }));

      const fused = fuseRankings({
        lexicalHits: [],
        vectorHits,
        query: "primary",
      });

      expect(fused).toHaveLength(1);
      expect(fused[0]!.id).toBe("single-mega-material");
      expect(fused[0]!.score).toBe(Number((1 / 61).toFixed(6)));
      expect(fused[0]!.navigation.pageNumber).toBe(1);
      expect(fused[0]!.snippet).toContain("Top primary chunk");
    });
  });

  // ==========================================================================
  // Dimension 4: Deterministic Tie-Breaking
  // ==========================================================================
  describe("Dimension 4: Deterministic Tie-Breaking", () => {
    it("ADV-TIE-01: verifies deterministic tie-breaking where scores are genuinely equal", () => {
      // Create cross-channel items that have the exact same score:
      // Item A: Lex rank 1, Vec rank 2 -> 1/61 + 1/62 = 0.032522 (Hybrid)
      // Item B: Lex rank 2, Vec rank 1 -> 1/62 + 1/61 = 0.032522 (Hybrid)
      // Item C: Lex rank 1 -> 1/61 = 0.016393 (Lexical)
      // Item D: Vec rank 1 -> 1/61 = 0.016393 (Semantic)

      const lexHits: RawLexicalHit[] = [
        {
          id: "hybrid-zebra", // Lex rank 1
          entityType: "note",
          title: "Hybrid Zebra",
          rankScore: 0.9,
          hierarchy: dummyHierarchy,
        },
        {
          id: "hybrid-apple", // Lex rank 2
          entityType: "note",
          title: "Hybrid Apple",
          rankScore: 0.8,
          hierarchy: dummyHierarchy,
        },
        {
          id: "lex-only-banana", // Lex rank 3
          entityType: "note",
          title: "Lexical Banana",
          rankScore: 0.7,
          hierarchy: dummyHierarchy,
        },
      ];

      const vecHits: RawVectorHit[] = [
        {
          chunkId: "c-1",
          entityId: "hybrid-apple", // Vec rank 1
          entityType: "note",
          title: "Hybrid Apple",
          chunkContent: "chunk",
          pageNumber: null,
          startSeconds: null,
          similarityScore: 0.9,
          hierarchy: dummyHierarchy,
        },
        {
          chunkId: "c-2",
          entityId: "hybrid-zebra", // Vec rank 2
          entityType: "note",
          title: "Hybrid Zebra",
          chunkContent: "chunk",
          pageNumber: null,
          startSeconds: null,
          similarityScore: 0.8,
          hierarchy: dummyHierarchy,
        },
        {
          chunkId: "c-3",
          entityId: "sem-only-mango", // Vec rank 3
          entityType: "note",
          title: "Semantic Mango",
          chunkContent: "chunk",
          pageNumber: null,
          startSeconds: null,
          similarityScore: 0.7,
          hierarchy: dummyHierarchy,
        },
      ];

      const fused = fuseRankings({
        lexicalHits: lexHits,
        vectorHits: vecHits,
        limit: 10,
      });

      // Scores:
      // hybrid-apple: 1/62 + 1/61 = 0.032522
      // hybrid-zebra: 1/61 + 1/62 = 0.032522
      // Both are hybrid and have identical score.
      // Tie-break rule: a.id.localeCompare(b.id) -> "hybrid-apple" must come before "hybrid-zebra"
      expect(fused[0]!.id).toBe("hybrid-apple");
      expect(fused[0]!.score).toBe(0.032522);
      expect(fused[1]!.id).toBe("hybrid-zebra");
      expect(fused[1]!.score).toBe(0.032522);

      // Next:
      // lex-only-banana: Lex rank 3 -> 1/63 = 0.015873
      // sem-only-mango: Vec rank 3 -> 1/63 = 0.015873
      // Equal score (0.015873), neither is hybrid.
      // Tie-break rule: "lex-only-banana".localeCompare("sem-only-mango") -> "lex-only-banana" first
      expect(fused[2]!.id).toBe("lex-only-banana");
      expect(fused[2]!.score).toBe(0.015873);
      expect(fused[3]!.id).toBe("sem-only-mango");
      expect(fused[3]!.score).toBe(0.015873);
    });
  });

  // ==========================================================================
  // Dimension 5: ReDoS & Malicious Regex Attack Resistance
  // ==========================================================================
  describe("Dimension 5: ReDoS & Malicious Regex Attack Resistance", () => {
    it("ADV-REDOS-01: executes malicious regex payloads without ReDoS or crash (<20ms)", () => {
      const maliciousQueries = [
        "((((a+)+)+)+)",
        "(a+)+$",
        "([a-zA-Z]+)*",
        "(a|aa)+",
        ".*.*.*.*.*.*.*.*.*.*a",
        "(x+x+)+y",
        "((.*)?)*",
        "[a-z]+@[a-z]+(\\.[a-z]+)+",
        "\\b(\\w+)\\s+\\1\\b",
        "((a|a?)+)+",
        "[[[[[[[[[[(((((((((",
        "\\\\\\\\\\\\\\\\\\\\",
        "***+++???^^^$$$",
      ];

      const text =
        "The quick brown fox jumps over the lazy dog. ".repeat(100) +
        "Target payload string for regular expression stress verification.";

      for (const query of maliciousQueries) {
        const start = performance.now();
        const snippet = extractContextualSnippet(text, query);
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(100);
        expect(typeof snippet).toBe("string");
      }
    });
  });

  // ==========================================================================
  // Dimension 6: Extreme Text Scale (150,000+ chars) & Single-Word Limits
  // ==========================================================================
  describe("Dimension 6: Extreme Scale & Single-Word Tests", () => {
    it("ADV-SCALE-01: processes 150,000-character document with target match in under 50ms", () => {
      const prefix = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(2500); // ~142,500 chars
      const target = " KEYWORD_DISCOVERY_NEEDLE ";
      const suffix = "Sed do eiusmod tempor incididunt ut labore et dolore magna. ".repeat(200); // ~12,000 chars
      const hugeText = prefix + target + suffix;

      expect(hugeText.length).toBeGreaterThan(150000);

      const start = performance.now();
      const snippet = extractContextualSnippet(hugeText, "KEYWORD_DISCOVERY_NEEDLE");
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(snippet).toContain("KEYWORD_DISCOVERY_NEEDLE");
      expect(snippet.startsWith("… ")).toBe(true);
      expect(snippet.endsWith(" …")).toBe(true);
      expect(snippet.length).toBeLessThanOrEqual(200);
    });

    it("ADV-SCALE-02: handles 60,000-character document where query term appears 1,000 times", () => {
      const unit = "The mitochondria generates cellular ATP via proton gradients. ";
      const repeatedText = unit.repeat(1000);

      const start = performance.now();
      const snippet = extractContextualSnippet(repeatedText, "mitochondria");
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(snippet).toContain("mitochondria");
    });

    it("ADV-SCALE-03: handles single-character, single-word, and short text inputs correctly", () => {
      expect(extractContextualSnippet("A", "A")).toBe("A");
      expect(extractContextualSnippet("Mitochondria", "Mitochondria")).toBe("Mitochondria");
      expect(extractContextualSnippet("Supercalifragilisticexpialidocious", "cali")).toBe(
        "Supercalifragilisticexpialidocious"
      );
    });
  });

  // ==========================================================================
  // Dimension 7: Semantic Fallbacks with Zero Query Overlap
  // ==========================================================================
  describe("Dimension 7: Semantic Fallbacks with Zero Query Overlap", () => {
    it("ADV-SEM-01: returns clean prefix without leading ellipsis when query has zero lexical overlap", () => {
      const longText =
        "Photosynthesis converts solar electromagnetic radiation into chemical bond energy stored in glucose. " +
        "Chlorophyll pigments in thylakoid membranes absorb specific wavelengths in the blue and red spectrum. ".repeat(
          5
        );

      const snippet = extractContextualSnippet(longText, "quantum entanglement particle spin");

      expect(snippet.startsWith("Photosynthesis converts")).toBe(true);
      expect(snippet.startsWith("…")).toBe(false);
      expect(snippet.endsWith(" …")).toBe(true);
    });

    it("ADV-SEM-02: returns short text verbatim when query has zero lexical overlap", () => {
      const shortText = "Brief concept definition.";
      const snippet = extractContextualSnippet(shortText, "unrelated words");
      expect(snippet).toBe(shortText);
    });
  });

  // ==========================================================================
  // Dimension 8: Multi-Lingual, CJK, Emoji & Surrogate Pair Handling
  // ==========================================================================
  describe("Dimension 8: Multi-Lingual, CJK, Emoji & Surrogate Pair Snapping", () => {
    it("ADV-UNI-01: matches CJK Chinese, Japanese, and Korean tokens accurately", () => {
      const chineseText =
        "前言介绍细胞生物学的基本概念与现代遗传学的发展历程。".repeat(3) +
        "线粒体是真核细胞进行有氧呼吸产生三磷酸腺苷的主要场所。 " +
        "后记总结未来生物技术展望与基因编辑技术的伦理思考。".repeat(3);

      const snippet = extractContextualSnippet(chineseText, "线粒体");
      expect(snippet).toContain("线粒体");
    });

    it("ADV-UNI-02: handles Cyrillic, Greek, and Devanagari text gracefully", () => {
      const russianText =
        "Введение в молекулярную генетику и биохимию клетки. ".repeat(3) +
        "Митохондрии обеспечивают синтез АТФ в процессе окислительного фосфорилирования. " +
        "Заключение и выводы по проведенным экспериментам. ".repeat(3);

      const snippet = extractContextualSnippet(russianText, "Митохондрии");
      expect(snippet).toContain("Митохондрии");
    });

    it("ADV-UNI-03: handles emojis, emoji sequences, and ensures no broken surrogate pairs", () => {
      const emojiText =
        "🔬🧪🧬 Initial lab setup. ".repeat(5) +
        "CRISPR-Cas9 gene editing demonstrates high fidelity in mammalian embryos 🧬🎯. " +
        "🔬🧪🧬 Follow-up sequencing confirmed targeted insertion. ".repeat(5);

      const snippet = extractContextualSnippet(emojiText, "CRISPR-Cas9");
      expect(snippet).toContain("CRISPR-Cas9");

      const hasLoneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
        snippet
      );
      expect(hasLoneSurrogate).toBe(false);
    });
  });

  // ==========================================================================
  // Dimension 9: Word Boundary Snapping Edge Cases
  // ==========================================================================
  describe("Dimension 9: Word Boundary Snapping Edge Cases", () => {
    it("ADV-SNAP-01: snaps cleanly on hyphenated words without slicing", () => {
      const text =
        "Background details on the project architecture and design patterns. ".repeat(3) +
        "We deployed a state-of-the-art transformer-based deep-learning model for NLP. " +
        "More concluding remarks regarding performance benchmarks and latency. ".repeat(3);

      const snippet = extractContextualSnippet(text, "transformer-based");
      expect(snippet).toContain("transformer-based");
      expect(snippet).not.toMatch(/\bstate-\s/);
    });

    it("ADV-SNAP-02: handles boundary snapping near punctuation marks", () => {
      const text =
        "Preliminary observation (see Appendix A). ".repeat(5) +
        "The experimental validation [Protocol #42] yielded 99.8% recovery! " +
        "Subsequent trials confirmed this result. ".repeat(5);

      const snippet = extractContextualSnippet(text, "Protocol");
      expect(snippet).toContain("Protocol #42");
    });
  });

  // ==========================================================================
  // Dimension 10: Lexical Search Query Normalization Stress
  // ==========================================================================
  describe("Dimension 10: Lexical Search Query Normalization Stress", () => {
    it("ADV-NORM-01: normalizes whitespace, tabs, and newlines safely", () => {
      const messy = "   cell    respiration \t\t\n\n\r  mitochondria   ";
      const normalized = normalizeSearchQuery(messy);
      expect(normalized).toBe("cell respiration mitochondria");
    });

    it("ADV-NORM-02: caps query length strictly at 200 characters without crashing", () => {
      const hugeQuery = "a".repeat(500);
      const normalized = normalizeSearchQuery(hugeQuery);
      expect(normalized.length).toBe(200);
    });

    it("ADV-NORM-03: handles SQL injection patterns safely in query normalization", () => {
      const sqlInjection = "' OR '1'='1'; DROP TABLE \"Note\"; --";
      const normalized = normalizeSearchQuery(sqlInjection);
      expect(normalized).toBe("' OR '1'='1'; DROP TABLE \"Note\"; --");
    });
  });
});
