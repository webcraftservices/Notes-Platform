import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  LayoutAmbiguityError,
  WorkBudget,
  constructSlices,
  extractSliceGaps,
  validateGapIntervals,
  computeOptimalBipartiteAssignment,
  trackCorridorsAcrossSlices,
  checkWholeBandProjectionVoid,
  reconstructMultiColumnLayout,
  reconstructPdfPageText,
  reconstructSingleColumnText,
  reconstructPageLayout,
  partitionPageIntoBands,
  decomposeBandColumns,
  getPageViewBounds,
  computeBodyTextHeight,
  computeMinGutterWidth,
  verifyMissingGeometrySingleColumnSafety,
  MAX_BANDS_PER_PAGE,
  MAX_COLUMNS_PER_BAND,
  MAX_REGIONS_PER_PAGE,
  MAX_RAW_ITEMS_PER_PAGE,
  MAX_VALID_ITEMS_PER_PAGE,
  MAX_SLICES_PER_PAGE,
  MAX_GAPS_PER_SLICE,
  MAX_ACTIVE_CORRIDORS,
  MAX_SOLVER_NODES_PER_SLICE,
  MAX_PAGE_SOLVER_NODES,
  MAX_PAGE_WORK_UNITS,
  MIN_GUTTER_WIDTH_PT,
  type PositionedPdfTextItem,
  type GapInterval,
  type CandidateCorridor,
  LocalDocumentProcessingService,
} from "../document-processing-local";

function makeItem(
  id: number,
  str: string,
  x: number,
  y: number,
  w = 50,
  h = 12
): PositionedPdfTextItem {
  return {
    id,
    str,
    x,
    y,
    w,
    h,
    dir: "ltr",
    hasEOL: false,
    hasValidGeometry: true,
  };
}

describe("Phase 11.3.5B.1: PDF Multi-Column Reading Order Engine", () => {
  // =========================================================================
  // CATEGORY A: Baseline and Slicing (Policy A)
  // =========================================================================
  describe("Category A: Baseline and Slicing", () => {
    it("assigns each baseline to exactly one half-open slice interval [ys, ys+1)", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "A", 50, 100),
        makeItem(1, "B", 50, 115),
        makeItem(2, "C", 50, 150),
        makeItem(3, "D", 50, 200),
      ];

      const slices = constructSlices(items, [0, 100, 600, 200], budget);
      expect(slices.length).toBeGreaterThan(0);
      expect(slices.length).toBeLessThanOrEqual(MAX_SLICES_PER_PAGE);

      // Verify every baseline is in exactly one slice
      let totalAssigned = 0;
      for (const s of slices) {
        totalAssigned += s.items.length;
        for (const it of s.items) {
          expect(it.y).toBeGreaterThanOrEqual(s.yBottom);
          if (s.index < slices.length - 1) {
            expect(it.y).toBeLessThan(s.yTop);
          } else {
            expect(it.y).toBeLessThanOrEqual(s.yTop);
          }
        }
      }
      expect(totalAssigned).toBe(items.length);
    });

    it("handles first and final page boundary items deterministically", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "BottomEdge", 50, 100), // exactly minY
        makeItem(1, "TopEdge", 50, 200), // exactly maxY
      ];

      const slices = constructSlices(items, [0, 100, 600, 200], budget);
      expect(slices[0]!.items.some((it) => it.id === 0)).toBe(true);
      expect(slices[slices.length - 1]!.items.some((it) => it.id === 1)).toBe(true);
    });

    it("fails closed on out-of-range baseline coordinates", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "Valid", 50, 150),
        makeItem(1, "OutOfRange", 50, 50), // below pageView minY=100
      ];

      expect(() => {
        constructSlices(items, [0, 100, 600, 200], budget);
      }).toThrow(LayoutAmbiguityError);
    });

    it("fails closed on invalid and non-finite baseline geometry", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "Finite", 50, 150),
        makeItem(1, "NaN", 50, NaN),
      ];

      expect(() => {
        constructSlices(items, [0, 100, 600, 200], budget);
      }).toThrow(LayoutAmbiguityError);
    });

    it("ensures zero overlapping slice membership (exact 1:1 mapping)", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = Array.from({ length: 50 }, (_, i) =>
        makeItem(i, `Item_${i}`, 50, 100 + i * 2)
      );

      const slices = constructSlices(items, [0, 100, 600, 200], budget);
      const seenIds = new Set<number>();
      for (const s of slices) {
        for (const it of s.items) {
          expect(seenIds.has(it.id)).toBe(false);
          seenIds.add(it.id);
        }
      }
      expect(seenIds.size).toBe(items.length);
    });
  });

  // =========================================================================
  // CATEGORY B: Geometry and Gaps
  // =========================================================================
  describe("Category B: Geometry and Gaps", () => {
    it("accepts valid strictly disjoint gaps", () => {
      const gaps: GapInterval[] = [
        { start: 100, end: 150 },
        { start: 250, end: 300 },
        { start: 400, end: 450 },
      ];
      expect(() => validateGapIntervals(gaps)).not.toThrow();
    });

    it("fails closed on exact duplicate gap intervals", () => {
      const gaps: GapInterval[] = [
        { start: 100, end: 150 },
        { start: 100, end: 150 },
      ];
      expect(() => validateGapIntervals(gaps)).toThrow(LayoutAmbiguityError);
    });

    it("fails closed on partially overlapping gap intervals", () => {
      const gaps: GapInterval[] = [
        { start: 100, end: 200 },
        { start: 180, end: 250 },
      ];
      expect(() => validateGapIntervals(gaps)).toThrow(LayoutAmbiguityError);
    });

    it("fails closed on nested gap intervals", () => {
      const gaps: GapInterval[] = [
        { start: 100, end: 300 },
        { start: 150, end: 250 },
      ];
      expect(() => validateGapIntervals(gaps)).toThrow(LayoutAmbiguityError);
    });

    it("fails closed on touching adjacent gap intervals", () => {
      const gaps: GapInterval[] = [
        { start: 100, end: 200 },
        { start: 200, end: 300 }, // touches at x=200
      ];
      expect(() => validateGapIntervals(gaps)).toThrow(LayoutAmbiguityError);
    });

    it("fails closed on zero-width or negative-width gap intervals", () => {
      expect(() =>
        validateGapIntervals([{ start: 150, end: 150 }])
      ).toThrow(LayoutAmbiguityError);
      expect(() =>
        validateGapIntervals([{ start: 200, end: 150 }])
      ).toThrow(LayoutAmbiguityError);
    });

    it("fails closed on non-finite gap coordinates", () => {
      expect(() =>
        validateGapIntervals([{ start: 100, end: Infinity }])
      ).toThrow(LayoutAmbiguityError);
      expect(() =>
        validateGapIntervals([{ start: NaN, end: 200 }])
      ).toThrow(LayoutAmbiguityError);
    });

    it("extracts gaps correctly from slice text items", () => {
      const budget = new WorkBudget();
      const slice = {
        index: 0,
        yBottom: 100,
        yTop: 120,
        items: [
          makeItem(0, "Left", 50, 110, 100), // x: 50..150
          makeItem(1, "Right", 250, 110, 100), // x: 250..350
        ],
        gaps: [],
        isEmpty: false,
      };

      const gaps = extractSliceGaps(slice, budget);
      expect(gaps.length).toBe(1);
      expect(gaps[0]!.start).toBe(150);
      expect(gaps[0]!.end).toBe(250);
      expect(gaps[0]!.end - gaps[0]!.start).toBeGreaterThanOrEqual(MIN_GUTTER_WIDTH_PT);
    });

    it("computes min gutter width based on modal font height: max(14.0, 1.5 * bodyHeight)", () => {
      const items12 = [makeItem(0, "A", 50, 100, 50, 12), makeItem(1, "B", 50, 120, 50, 12)];
      expect(computeBodyTextHeight(items12)).toBe(12);
      expect(computeMinGutterWidth(items12)).toBe(18);

      const items8 = [makeItem(0, "A", 50, 100, 50, 8), makeItem(1, "B", 50, 120, 50, 8)];
      expect(computeBodyTextHeight(items8)).toBe(8);
      expect(computeMinGutterWidth(items8)).toBe(14);
    });
  });

  // =========================================================================
  // CATEGORY C: Corridor Matching & Solver
  // =========================================================================
  describe("Category C: Corridor Matching & Solver", () => {
    it("solves bipartite matching maximizing exact IEEE 754 unrounded score", () => {
      const budget = new WorkBudget();
      const tracker = { totalNodes: 0 };
      const corridors: CandidateCorridor[] = [
        {
          id: 1,
          start: 200,
          end: 250,
          state: "ACTIVE_INTERNAL",
          matchedSlicesCount: 1,
          emptySlicesBridged: 0,
          initialSlice: 0,
          lastMatchedSlice: 0,
          isConfirmed: false,
        },
      ];
      const gaps: GapInterval[] = [{ start: 202, end: 248 }];

      const res = computeOptimalBipartiteAssignment(corridors, gaps, budget, tracker);
      expect(res.matches.length).toBe(1);
      expect(res.matches[0]!.corridorId).toBe(1);
      expect(res.matches[0]!.score).toBeGreaterThan(0.8);
      expect(tracker.totalNodes).toBeGreaterThan(0);
    });

    it("uses match count as secondary objective and lexicographic tie-breaking as tertiary", () => {
      const budget = new WorkBudget();
      const tracker = { totalNodes: 0 };
      // Two identical corridors competing for one identical gap
      const corridors: CandidateCorridor[] = [
        {
          id: 1,
          start: 200,
          end: 250,
          state: "ACTIVE_INTERNAL",
          matchedSlicesCount: 1,
          emptySlicesBridged: 0,
          initialSlice: 0,
          lastMatchedSlice: 0,
          isConfirmed: false,
        },
        {
          id: 2,
          start: 200,
          end: 250,
          state: "ACTIVE_INTERNAL",
          matchedSlicesCount: 1,
          emptySlicesBridged: 0,
          initialSlice: 0,
          lastMatchedSlice: 0,
          isConfirmed: false,
        },
      ];
      const gaps: GapInterval[] = [{ start: 200, end: 250 }];

      const res = computeOptimalBipartiteAssignment(corridors, gaps, budget, tracker);
      expect(res.matches.length).toBe(1);
      // Canonical tie-break selects earlier corridor ID (ID 1 over ID 2)
      expect(res.matches[0]!.corridorId).toBe(1);
    });

    it("tracks stable corridors across slices", () => {
      const budget = new WorkBudget();
      const slices = [
        {
          index: 0,
          yBottom: 100,
          yTop: 120,
          items: [makeItem(0, "L1", 50, 110, 100), makeItem(1, "R1", 250, 110, 100)],
          gaps: [],
          isEmpty: false,
        },
        {
          index: 1,
          yBottom: 120,
          yTop: 140,
          items: [makeItem(2, "L2", 50, 130, 100), makeItem(3, "R2", 250, 130, 100)],
          gaps: [],
          isEmpty: false,
        },
      ];

      const confirmed = trackCorridorsAcrossSlices(slices, budget);
      expect(confirmed.length).toBe(1);
      expect(confirmed[0]!.isConfirmed).toBe(true);
      expect(confirmed[0]!.start).toBe(150);
      expect(confirmed[0]!.end).toBe(250);
    });

    it("fails closed when text invades an active corridor", () => {
      const budget = new WorkBudget();
      const slices = [
        {
          index: 0,
          yBottom: 100,
          yTop: 120,
          // Invading text across the gutter [150, 250]
          items: [makeItem(0, "InvadingText", 140, 110, 120)],
          gaps: [],
          isEmpty: false,
        },
        {
          index: 1,
          yBottom: 120,
          yTop: 140,
          items: [makeItem(1, "L", 50, 130, 100), makeItem(2, "R", 250, 130, 100)],
          gaps: [],
          isEmpty: false,
        },
      ];

      expect(() => {
        trackCorridorsAcrossSlices(slices, budget);
      }).toThrow(LayoutAmbiguityError);
    });

    it("tracks distinct visual lines rather than item counts: 5 items on one baseline contribute 1 line", () => {
      const budget = new WorkBudget();
      // Corridor between x=150 and x=250.
      // Left side: Slice 0 has 5 items all on baseline y=100.
      // Right side: Slices 0, 1, 2 each have 1 item on baselines y=100, y=120, y=140.
      // Slices 1 and 2 have no items on left.
      // Total lines on left = 1 (< 3). Corridor cannot be confirmed!
      const slices = [
        {
          index: 0,
          yBottom: 90,
          yTop: 110,
          items: [
            makeItem(0, "A", 50, 100, 15),
            makeItem(1, "B", 70, 100, 15),
            makeItem(2, "C", 90, 100, 15),
            makeItem(3, "D", 110, 100, 15),
            makeItem(4, "E", 130, 100, 15),
            makeItem(5, "R0", 260, 100, 50),
          ],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
        {
          index: 1,
          yBottom: 110,
          yTop: 130,
          items: [makeItem(6, "R1", 260, 120, 50)],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
        {
          index: 2,
          yBottom: 130,
          yTop: 150,
          items: [makeItem(7, "R2", 260, 140, 50)],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
      ];

      // Fails closed because leftLinesCount is 1, not 5 (requiring at least 3 distinct visual lines)
      expect(() => {
        trackCorridorsAcrossSlices(slices, budget);
      }).toThrow(LayoutAmbiguityError);
    });

    it("tracks distinct visual lines across slices: items sharing a visual line only contribute 1 line", () => {
      const budget = new WorkBudget();
      const slices = [
        {
          index: 0,
          yBottom: 90,
          yTop: 110,
          items: [
            makeItem(0, "L0", 50, 100, 50),
            makeItem(1, "R0", 260, 100, 50),
          ],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
        {
          index: 1,
          yBottom: 110,
          yTop: 130,
          // Same baseline item re-encountered across slice boundaries
          items: [
            makeItem(2, "L0_cont", 50, 100, 50),
            makeItem(3, "R1", 260, 120, 50),
          ],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
        {
          index: 2,
          yBottom: 130,
          yTop: 150,
          items: [
            makeItem(4, "L1", 50, 140, 50),
            makeItem(5, "R2", 260, 140, 50),
          ],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
      ];

      // Left side only has 2 distinct visual lines (y=100 and y=140), so corridor cannot be confirmed (< 3)
      expect(() => {
        trackCorridorsAcrossSlices(slices, budget);
      }).toThrow(LayoutAmbiguityError);
    });

    it("confirms corridor when both left and right sides have at least 3 independent visual lines", () => {
      const budget = new WorkBudget();
      const slices = [
        {
          index: 0,
          yBottom: 90,
          yTop: 110,
          items: [makeItem(0, "L0", 50, 100, 50), makeItem(1, "R0", 260, 100, 50)],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
        {
          index: 1,
          yBottom: 110,
          yTop: 130,
          items: [makeItem(2, "L1", 50, 120, 50), makeItem(3, "R1", 260, 120, 50)],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
        {
          index: 2,
          yBottom: 130,
          yTop: 150,
          items: [makeItem(4, "L2", 50, 140, 50), makeItem(5, "R2", 260, 140, 50)],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
      ];

      const corrs = trackCorridorsAcrossSlices(slices, budget);
      expect(corrs.length).toBe(1);
      expect(corrs[0]!.isConfirmed).toBe(true);
      expect(corrs[0]!.leftLinesCount).toBe(3);
      expect(corrs[0]!.rightLinesCount).toBe(3);
    });

    it("fails closed on candidate corridor with insufficient left or right slice evidence in multi-line document", () => {
      const budget = new WorkBudget();
      const slices = [
        {
          index: 0,
          yBottom: 100,
          yTop: 120,
          items: [makeItem(0, "L0", 50, 110, 100), makeItem(1, "R0", 250, 110, 100)],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
        {
          index: 1,
          yBottom: 120,
          yTop: 140,
          items: [makeItem(2, "L1", 50, 130, 100), makeItem(3, "R1", 250, 130, 100)],
          gaps: [{ start: 150, end: 250 }],
          isEmpty: false,
        },
        {
          index: 2,
          yBottom: 140,
          yTop: 160,
          items: [makeItem(4, "L2", 50, 150, 100)],
          gaps: [],
          isEmpty: false,
        },
        {
          index: 3,
          yBottom: 160,
          yTop: 180,
          items: [makeItem(5, "L3", 50, 170, 100)],
          gaps: [],
          isEmpty: false,
        },
      ];

      expect(() => {
        trackCorridorsAcrossSlices(slices, budget);
      }).toThrow(LayoutAmbiguityError);
    });
  });

  // =========================================================================
  // CATEGORY D: Region Assignment and Item Conservation
  // =========================================================================
  describe("Category D: Region Assignment and Item Conservation", () => {
    it("reconstructs two-column layout in correct left-to-right reading order", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "Left line one.", 50, 350, 100),
        makeItem(1, "Left line two.", 50, 330, 100),
        makeItem(2, "Right line one.", 250, 350, 100),
        makeItem(3, "Right line two.", 250, 330, 100),
      ];
      const corridors: CandidateCorridor[] = [
        {
          id: 1,
          start: 160,
          end: 240,
          state: "CONFIRMED",
          matchedSlicesCount: 5,
          emptySlicesBridged: 0,
          initialSlice: 0,
          lastMatchedSlice: 4,
          isConfirmed: true,
        },
      ];

      const text = reconstructMultiColumnLayout(
        items,
        corridors,
        (colItems, b) => reconstructSingleColumnText(colItems, b),
        budget
      );

      // Verify left column lines appear BEFORE right column lines
      const leftIdx = text.indexOf("Left line two.");
      const rightIdx = text.indexOf("Right line one.");
      expect(leftIdx).toBeGreaterThan(-1);
      expect(rightIdx).toBeGreaterThan(-1);
      expect(leftIdx).toBeLessThan(rightIdx);
    });

    it("verifies exact item identity conservation (zero dropped, zero duplicated)", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "A", 50, 350, 80),
        makeItem(1, "B", 50, 320, 80),
        makeItem(2, "C", 250, 350, 80),
      ];
      const corridors: CandidateCorridor[] = [
        {
          id: 1,
          start: 150,
          end: 230,
          state: "CONFIRMED",
          matchedSlicesCount: 5,
          emptySlicesBridged: 0,
          initialSlice: 0,
          lastMatchedSlice: 4,
          isConfirmed: true,
        },
      ];

      const text = reconstructMultiColumnLayout(
        items,
        corridors,
        (colItems, b) => reconstructSingleColumnText(colItems, b),
        budget
      );

      expect(text).toContain("A");
      expect(text).toContain("B");
      expect(text).toContain("C");
    });

    it("fails closed if an item intrudes into a confirmed corridor", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "A", 50, 350, 80),
        makeItem(1, "Intruding", 160, 320, 50), // crosses into corridor [150, 230]
        makeItem(2, "C", 250, 350, 80),
      ];
      const corridors: CandidateCorridor[] = [
        {
          id: 1,
          start: 150,
          end: 230,
          state: "CONFIRMED",
          matchedSlicesCount: 5,
          emptySlicesBridged: 0,
          initialSlice: 0,
          lastMatchedSlice: 4,
          isConfirmed: true,
        },
      ];

      expect(() => {
        reconstructMultiColumnLayout(
          items,
          corridors,
          (colItems, b) => reconstructSingleColumnText(colItems, b),
          budget
        );
      }).toThrow(LayoutAmbiguityError);
    });

    it("rejects item straddling column boundary without midpoint assignment hack", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "Left", 50, 350, 100),
        makeItem(1, "Straddler", 190, 330, 30),
        makeItem(2, "Right", 320, 350, 100),
      ];
      const corridors: CandidateCorridor[] = [
        {
          id: 1,
          start: 200,
          end: 300,
          state: "CONFIRMED",
          matchedSlicesCount: 5,
          emptySlicesBridged: 0,
          initialSlice: 0,
          lastMatchedSlice: 4,
          isConfirmed: true,
        },
      ];

      expect(() =>
        reconstructMultiColumnLayout(
          items,
          corridors,
          (col, b) => reconstructSingleColumnText(col, b),
          budget
        )
      ).toThrow(LayoutAmbiguityError);
    });

    it("strictly enforces column containment tolerance (OVERHANG_TOL = 2.0 pt) and zero-tolerance gutter intrusion", () => {
      const budget = new WorkBudget();
      const pageBounds = { minX: 0, minY: 0, maxX: 600, maxY: 600 };
      const contentMinX = 50;
      const contentMaxX = 450;
      // 3 visual lines in left column [50, 200] and 3 in right column [300, 450]
      // Corridor [200, 300] is confirmed
      const baseItems: PositionedPdfTextItem[] = [
        makeItem(0, "L0", 50, 300, 50, 12), makeItem(1, "R0", 320, 300, 50, 12),
        makeItem(2, "L1", 50, 280, 50, 12), makeItem(3, "R1", 320, 280, 50, 12),
        makeItem(4, "L2", 50, 260, 50, 12), makeItem(5, "R2", 320, 260, 50, 12),
      ];

      // Test 1: Item immediately inside tolerance at contentMinX - 1.99 (x = 48.01) is admitted
      const band1 = {
        index: 0, yBottom: 250, yTop: 310, type: "SINGLE_COLUMN" as const,
        items: [...baseItems, makeItem(6, "Admitted1_99", 48.01, 280, 50, 12)],
        columns: [] as PositionedPdfTextItem[][],
        gutters: [] as CandidateCorridor[],
      };
      decomposeBandColumns(band1, 18, contentMinX, contentMaxX, pageBounds, budget);
      expect(band1.type).toBe("MULTI_COLUMN");
      expect(band1.columns[0]!.some((it) => it.str === "Admitted1_99")).toBe(true);

      // Test 2: Item exactly at tolerance boundary at contentMinX - 2.00 (x = 48.00) is admitted
      const band2 = {
        index: 0, yBottom: 250, yTop: 310, type: "SINGLE_COLUMN" as const,
        items: [...baseItems, makeItem(7, "Admitted2_00", 48.00, 280, 50, 12)],
        columns: [] as PositionedPdfTextItem[][],
        gutters: [] as CandidateCorridor[],
      };
      decomposeBandColumns(band2, 18, contentMinX, contentMaxX, pageBounds, budget);
      expect(band2.type).toBe("MULTI_COLUMN");
      expect(band2.columns[0]!.some((it) => it.str === "Admitted2_00")).toBe(true);

      // Test 3: Item outside tolerance boundary at contentMinX - 2.01 (x = 47.99) is rejected
      const band3 = {
        index: 0, yBottom: 250, yTop: 310, type: "SINGLE_COLUMN" as const,
        items: [...baseItems, makeItem(8, "Rejected2_01", 47.99, 280, 50, 12)],
        columns: [] as PositionedPdfTextItem[][],
        gutters: [] as CandidateCorridor[],
      };
      expect(() =>
        decomposeBandColumns(band3, 18, contentMinX, contentMaxX, pageBounds, budget)
      ).toThrow("cannot be assigned confidently to any column region");

      // Test 4: Gutter intrusion check runs with zero tolerance before containment
      const confirmedCorrs: CandidateCorridor[] = [
        {
          id: 1,
          start: 200,
          end: 300,
          state: "CONFIRMED",
          matchedSlicesCount: 5,
          emptySlicesBridged: 0,
          initialSlice: 0,
          lastMatchedSlice: 4,
          isConfirmed: true,
        },
      ];
      // Item intrudes into confirmed gutter [200, 300] by 0.01 pt (x = 150, w = 50.01 -> end = 200.01 > 200.00)
      const intrudingItems: PositionedPdfTextItem[] = [
        makeItem(0, "L", 50, 300, 50, 12),
        makeItem(1, "Intruder", 150, 300, 50.01, 12),
        makeItem(2, "R", 320, 300, 50, 12),
      ];
      expect(() =>
        reconstructMultiColumnLayout(intrudingItems, confirmedCorrs, (c, b) => reconstructSingleColumnText(c, b), budget)
      ).toThrow("crosses confirmed gutter [200, 300]");
    });

    it("fails closed on duplicate item ID during page layout reconstruction (item conservation)", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(1, "Original", 50, 350, 80),
        makeItem(1, "Duplicate", 50, 320, 80),
      ];

      expect(() =>
        reconstructPageLayout(
          items,
          [0, 0, 600, 400],
          (col, b) => reconstructSingleColumnText(col, b),
          budget
        )
      ).toThrow("Duplicate item assignment detected");
    });
  });

  // =========================================================================
  // CATEGORY E: Work-Budget and Adversarial Workload Caps
  // =========================================================================
  describe("Category E: Work-Budget & Hard Workload Caps", () => {
    it("enforces MAX_RAW_ITEMS_PER_PAGE (10,000 passes, 10,001 fails closed)", () => {
      const validMockItems = Array.from({ length: MAX_RAW_ITEMS_PER_PAGE }, (_, i) => ({
        str: `word${i}`,
        dir: "ltr",
        fontName: "g_d0_f1",
        hasEOL: false,
        transform: [1, 0, 0, 1, 50, 100 + (i % 50) * 10],
        width: 20,
        height: 10,
      }));

      // 10,000 items should not throw raw item error
      // (will proceed and may classify as single column)
      expect(() => reconstructPdfPageText(validMockItems)).not.toThrow(
        "Page exceeds raw text item budget"
      );

      // 10,001 items must throw immediately
      const overLimitItems = [
        ...validMockItems,
        {
          str: "overflow",
          dir: "ltr",
          fontName: "g_d0_f1",
          hasEOL: false,
          transform: [1, 0, 0, 1, 50, 100],
          width: 20,
          height: 10,
        },
      ];
      expect(() => reconstructPdfPageText(overLimitItems)).toThrow(
        "Page exceeds raw text item budget"
      );
    });

    it("enforces MAX_SLICES_PER_PAGE cap (<= 100)", () => {
      const budget = new WorkBudget();
      const items = [makeItem(0, "A", 50, 100), makeItem(1, "B", 50, 5000)];
      // constructSlices calculates sliceHeight = max(10, H/100)
      // which mathematically clamps S <= 100
      const slices = constructSlices(items, undefined, budget);
      expect(slices.length).toBeLessThanOrEqual(MAX_SLICES_PER_PAGE);
    });

    it("enforces MAX_GAPS_PER_SLICE cap (> 4 fails closed)", () => {
      const budget = new WorkBudget();
      // 6 text blocks creating 5 internal gaps
      const items = [
        makeItem(0, "T0", 50, 100, 20),
        makeItem(1, "T1", 100, 100, 20), // gap 70..100 (30pt)
        makeItem(2, "T2", 150, 100, 20), // gap 120..150 (30pt)
        makeItem(3, "T3", 200, 100, 20), // gap 170..200 (30pt)
        makeItem(4, "T4", 250, 100, 20), // gap 220..250 (30pt)
        makeItem(5, "T5", 300, 100, 20), // gap 270..300 (30pt) -> 5 gaps total!
      ];
      const slice = {
        index: 0,
        yBottom: 90,
        yTop: 110,
        items,
        gaps: [],
        isEmpty: false,
      };

      expect(() => extractSliceGaps(slice, budget)).toThrow(
        "Slice gap count exceeds maximum budget"
      );
    });

    it("enforces MAX_PAGE_WORK_UNITS (overflow-safe fail-closed behavior)", () => {
      const smallBudget = new WorkBudget(100);
      smallBudget.recordWork(50);
      expect(smallBudget.unitsUsed).toBe(50);

      smallBudget.recordWork(50);
      expect(smallBudget.unitsUsed).toBe(100);

      // Next single unit exhausts budget
      expect(() => smallBudget.recordWork(1)).toThrow(LayoutAmbiguityError);
    });

    it("verifies WorkBudget limit: immediately below, exactly at, and exceeding by 1", () => {
      const budget1 = new WorkBudget(MAX_PAGE_WORK_UNITS);
      budget1.recordWork(MAX_PAGE_WORK_UNITS - 1);
      expect(budget1.unitsUsed).toBe(MAX_PAGE_WORK_UNITS - 1);

      const budget2 = new WorkBudget(MAX_PAGE_WORK_UNITS);
      budget2.recordWork(MAX_PAGE_WORK_UNITS);
      expect(budget2.unitsUsed).toBe(MAX_PAGE_WORK_UNITS);

      const budget3 = new WorkBudget(MAX_PAGE_WORK_UNITS);
      budget3.recordWork(MAX_PAGE_WORK_UNITS);
      expect(() => budget3.recordWork(1)).toThrow(LayoutAmbiguityError);
    });
  });

  // =========================================================================
  // CATEGORY G: Hierarchical XY-Cut Decomposition (Page -> Bands -> Columns)
  // =========================================================================
  describe("Category G: Hierarchical XY-Cut Decomposition", () => {
    it("partitions page into full-width heading band and multi-column body band", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "Large Document Heading Spanning Width", 50, 360, 500, 16),
        makeItem(1, "Col1 Line 1", 50, 300, 150, 12),
        makeItem(2, "Col2 Line 1", 350, 300, 150, 12),
        makeItem(3, "Col1 Line 2", 50, 270, 150, 12),
        makeItem(4, "Col2 Line 2", 350, 270, 150, 12),
        makeItem(5, "Col1 Line 3", 50, 240, 150, 12),
        makeItem(6, "Col2 Line 3", 350, 240, 150, 12),
      ];

      const bands = partitionPageIntoBands(items, 50, 550, 18, budget);
      expect(bands.length).toBe(2);
      expect(bands[0]!.type).toBe("FULL_WIDTH");
      expect(bands[0]!.items.map((it) => it.id)).toEqual([0]);
      expect(bands[1]!.type).toBe("SINGLE_COLUMN");
      expect(bands[1]!.items.length).toBe(6);
    });

    it("enforces MAX_BANDS_PER_PAGE cap (> 5 fails closed)", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [];
      let id = 0;
      for (let b = 0; b < 3; b++) {
        const hy = 550 - b * 120;
        const by = 500 - b * 120;
        items.push(makeItem(id++, `Heading ${b}`, 50, hy, 400, 16));
        items.push(makeItem(id++, `Body ${b}`, 50, by, 100, 12));
      }

      const bands = partitionPageIntoBands(items, 50, 450, 18, budget);
      expect(bands.length).toBe(6);

      expect(() =>
        reconstructPageLayout(
          items,
          [0, 0, 600, 600],
          (col, b) => reconstructSingleColumnText(col, b),
          budget
        )
      ).toThrow("Page exceeds maximum band budget");
    });

    it("enforces MAX_COLUMNS_PER_BAND cap (> 3 fails closed)", () => {
      const budget = new WorkBudget();
      const band = {
        index: 0,
        yBottom: 100,
        yTop: 300,
        type: "SINGLE_COLUMN" as const,
        items: [
          makeItem(0, "C0_1", 50, 250, 50, 12), makeItem(1, "C1_1", 150, 250, 50, 12),
          makeItem(2, "C2_1", 250, 250, 50, 12), makeItem(3, "C3_1", 350, 250, 50, 12),
          makeItem(4, "C0_2", 50, 200, 50, 12), makeItem(5, "C1_2", 150, 200, 50, 12),
          makeItem(6, "C2_2", 250, 200, 50, 12), makeItem(7, "C3_2", 350, 200, 50, 12),
          makeItem(8, "C0_3", 50, 150, 50, 12), makeItem(9, "C1_3", 150, 150, 50, 12),
          makeItem(10, "C2_3", 250, 150, 50, 12), makeItem(11, "C3_3", 350, 150, 50, 12),
        ],
        columns: [],
        gutters: [],
      };

      expect(() =>
        decomposeBandColumns(band, 18, 50, 400, { minX: 0, minY: 0, maxX: 600, maxY: 600 }, budget)
      ).toThrow("Band exceeds maximum column budget");
    });

    it("verifies MAX_REGIONS_PER_PAGE mathematical bound", () => {
      expect(MAX_REGIONS_PER_PAGE).toBe(15);
      expect(MAX_BANDS_PER_PAGE * MAX_COLUMNS_PER_BAND).toBe(15);
    });

    it("computes page bounds accurately handling non-zero origins, cropbox, fallbacks, and rotation", () => {
      const bounds1 = getPageViewBounds([50, 50, 550, 350]);
      expect(bounds1).toEqual({ minX: 50, minY: 50, maxX: 550, maxY: 350, rotation: 0 });

      const bounds2 = getPageViewBounds([0, 0, 600, 800], undefined, 90);
      expect(bounds2).toEqual({ minX: 0, minY: 0, maxX: 600, maxY: 800, rotation: 90 });

      expect(getPageViewBounds([0, 0, 600, 800], undefined, 180).rotation).toBe(180);
      expect(getPageViewBounds([0, 0, 600, 800], undefined, 270).rotation).toBe(270);
      expect(getPageViewBounds([0, 0, 600, 800], undefined, 360).rotation).toBe(0);
      expect(getPageViewBounds([0, 0, 600, 800], undefined, -90).rotation).toBe(270);

      expect(() => getPageViewBounds([0, 0, 600, 800], undefined, 45)).toThrow(LayoutAmbiguityError);
      expect(() => getPageViewBounds([0, 0, 600, 800], undefined, NaN)).toThrow(LayoutAmbiguityError);
      expect(() => getPageViewBounds([0, 0, 600, 800], undefined, Infinity)).toThrow(LayoutAmbiguityError);

      const items = [makeItem(0, "A", 40, 100), makeItem(1, "B", 400, 700)];
      const bounds3 = getPageViewBounds(undefined, items);
      expect(bounds3.minX).toBe(40);
      expect(bounds3.minY).toBe(100);
      expect(bounds3.maxX).toBe(450);
      expect(bounds3.maxY).toBe(700);
      expect(bounds3.rotation).toBe(0);
    });

    it("fails closed on out-of-bounds item coordinates", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "Valid", 50, 200, 100),
        makeItem(1, "OutOfBounds", 950, 200, 100),
      ];

      expect(() =>
        reconstructPageLayout(
          items,
          [0, 0, 600, 400],
          (col, b) => reconstructSingleColumnText(col, b),
          budget
        )
      ).toThrow("out of page bounds");
    });

    it("fails closed when page has multi-column evidence (internal gaps) but corridors cannot be confirmed", () => {
      const budget = new WorkBudget();
      // 4 lines: Line 0 has 2 items with a 100pt gap; Lines 1-3 are single items spanning across
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "LeftHeader", 50, 350, 80),
        makeItem(1, "RightHeader", 280, 350, 80),
        makeItem(2, "BodyLineOne spanning across the width of the page", 50, 335, 350),
        makeItem(3, "BodyLineTwo spanning across the width of the page", 50, 320, 350),
        makeItem(4, "BodyLineThree spanning across the width of the page", 50, 305, 350),
      ];

      // Multi-column evidence exists (gap on line 0), but only 1 line on each side (< 3 lines)
      // Must fail closed with LayoutAmbiguityError, never silently fall back to single-column!
      expect(() =>
        reconstructPageLayout(
          items,
          [0, 0, 600, 400],
          (col, b) => reconstructSingleColumnText(col, b),
          budget
        )
      ).toThrow(LayoutAmbiguityError);
    });

    it("handles full-width heading between two multi-column bands in hierarchical XY-cut", () => {
      const budget = new WorkBudget();
      const items: PositionedPdfTextItem[] = [
        // Band 0: Intro (2 columns, 3 lines each)
        makeItem(0, "Intro L1", 50, 450, 100, 12), makeItem(1, "Intro R1", 320, 450, 100, 12),
        makeItem(2, "Intro L2", 50, 430, 100, 12), makeItem(3, "Intro R2", 320, 430, 100, 12),
        makeItem(4, "Intro L3", 50, 410, 100, 12), makeItem(5, "Intro R3", 320, 410, 100, 12),

        // Band 1: Spanning intermediate heading (height 16, clearance > 3 * 12)
        makeItem(6, "Full-Width Intermediate Heading Between Bands", 50, 330, 450, 16),

        // Band 2: Body (2 columns, 3 lines each)
        makeItem(7, "Body L1", 50, 250, 100, 12), makeItem(8, "Body R1", 320, 250, 100, 12),
        makeItem(9, "Body L2", 50, 230, 100, 12), makeItem(10, "Body R2", 320, 230, 100, 12),
        makeItem(11, "Body L3", 50, 210, 100, 12), makeItem(12, "Body R3", 320, 210, 100, 12),
      ];

      const text = reconstructPageLayout(
        items,
        [0, 0, 600, 500],
        (col, b) => reconstructSingleColumnText(col, b),
        budget
      );

      expect(text).toContain("Intro L3");
      expect(text).toContain("Intro R1");
      expect(text).toContain("Full-Width Intermediate Heading Between Bands");
      expect(text).toContain("Body L3");
      expect(text).toContain("Body R1");

      const introL3 = text.indexOf("Intro L3");
      const introR1 = text.indexOf("Intro R1");
      const heading = text.indexOf("Full-Width Intermediate Heading Between Bands");
      const bodyL3 = text.indexOf("Body L3");
      const bodyR1 = text.indexOf("Body R1");

      expect(introL3).toBeLessThan(introR1);
      expect(introR1).toBeLessThan(heading);
      expect(heading).toBeLessThan(bodyL3);
      expect(bodyL3).toBeLessThan(bodyR1);
    });

    it("retains ordinary bottom-of-page text as body text and does not promote it to a heading", () => {
      const budget = new WorkBudget();
      // Body items: Line 0 is body, Line 1 is body at bottom of page with no font prominence
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "Normal line one of body text", 50, 300, 200, 12),
        makeItem(1, "Ordinary bottom-of-page line without font prominence", 50, 200, 450, 12),
      ];

      const bands = partitionPageIntoBands(items, 50, 500, 18, budget);
      // Both lines belong to single-column band; bottom line is NOT classified as FULL_WIDTH
      expect(bands.length).toBe(1);
      expect(bands[0]!.type).toBe("SINGLE_COLUMN");
    });

    it("fails closed when all items lack geometric transforms in a multi-item page", () => {
      const rawItems = [
        { str: "First line without geometry", transform: undefined as any, width: 100, height: 12, hasEOL: true },
        { str: "Second line without geometry", transform: [1, 0, 0, 1, NaN, 100], width: 100, height: 12, hasEOL: true },
      ];
      expect(() => reconstructPdfPageText(rawItems as any)).toThrow(LayoutAmbiguityError);
    });

    it("fails closed when one item is missing geometry in an otherwise valid multi-column page", () => {
      const rawItems = [
        // Left column lines
        { str: "Left 1", transform: [1, 0, 0, 1, 50, 350], width: 60, height: 12, hasEOL: true },
        { str: "Left 2", transform: [1, 0, 0, 1, 50, 330], width: 60, height: 12, hasEOL: true },
        { str: "Left 3", transform: [1, 0, 0, 1, 50, 310], width: 60, height: 12, hasEOL: true },
        // Right column lines
        { str: "Right 1", transform: [1, 0, 0, 1, 320, 350], width: 60, height: 12, hasEOL: true },
        { str: "Right 2", transform: [1, 0, 0, 1, 320, 330], width: 60, height: 12, hasEOL: true },
        { str: "Right 3", transform: [1, 0, 0, 1, 320, 310], width: 60, height: 12, hasEOL: true },
        // Item with missing geometry
        { str: "Unplaced inline note", transform: undefined as any, width: 40, height: 12, hasEOL: false },
      ];
      expect(() => reconstructPdfPageText(rawItems as any)).toThrow(LayoutAmbiguityError);
    });

    it("fails closed when missing right-column item is inserted between two valid same-baseline left-column anchors with hasEOL false (Counterexample 1)", () => {
      // Counterexample: Two geometrically valid items belong to left column on same baseline (y=350).
      // Horizontal gap (85 - (50 + 30) = 5 pt) is smaller than minGutterWidth.
      // An item with missing geometry actually belongs to the right column, has hasEOL: false,
      // and appears between them in the PDF content stream without provenance.
      const rawItems = [
        { str: "Left column part 1", transform: [1, 0, 0, 1, 50, 350], width: 30, height: 12, hasEOL: false },
        // Right-column item whose transform was lost, emitted between left-column tokens in stream
        { str: "Right col fragment", transform: undefined as any, width: 40, height: 12, hasEOL: false },
        { str: "Left column part 2", transform: [1, 0, 0, 1, 85, 350], width: 30, height: 12, hasEOL: true },
        { str: "Left column line 2", transform: [1, 0, 0, 1, 50, 335], width: 120, height: 12, hasEOL: true },
      ];

      // Stream adjacency is NOT physical enclosure. Without independent provenance,
      // the engine must fail closed with LayoutAmbiguityError.
      expect(() => reconstructPdfPageText(rawItems as any)).toThrow(LayoutAmbiguityError);
    });

    it("fails closed when missing item occurs between valid anchors that otherwise satisfy every current helper condition (Counterexample 2)", () => {
      // Anchors satisfy same baseline (y=300), gap < minGutterWidth, monotonicity.
      // But the missing item lacks independent provenance proving run membership.
      const rawItems = [
        { str: "Anchor left", transform: [1, 0, 0, 1, 50, 300], width: 30, height: 12, hasEOL: false },
        { str: "Missing unproven item", transform: undefined as any, width: 30, height: 12, hasEOL: false },
        { str: "Anchor right", transform: [1, 0, 0, 1, 85, 300], width: 30, height: 12, hasEOL: true },
      ];
      expect(() => reconstructPdfPageText(rawItems as any)).toThrow(LayoutAmbiguityError);
    });

    it("safely reconstructs single-column page containing a solitary unanchored item where provenance is self-contained", () => {
      const singleItem = [
        { str: "Single unanchored document header", transform: undefined as any, width: 0, height: 0, hasEOL: false },
      ];
      expect(reconstructPdfPageText(singleItem as any)).toBe("Single unanchored document header");
    });

    it("fails closed when partial missing geometry occurs in a multi-item page because raw extraction provides no trustworthy provenance", () => {
      const rawItems = [
        { str: "Paragraph 1 start", transform: [1, 0, 0, 1, 50, 350], width: 60, height: 12, hasEOL: false },
        { str: "inline symbol", transform: undefined as any, width: 20, height: 12, hasEOL: false },
        { str: "Paragraph 1 end.", transform: [1, 0, 0, 1, 115, 350], width: 60, height: 12, hasEOL: true },
        { str: "Paragraph 2 text line one.", transform: [1, 0, 0, 1, 50, 335], width: 120, height: 12, hasEOL: true },
      ];
      expect(() => reconstructPdfPageText(rawItems as any)).toThrow(LayoutAmbiguityError);
    });

    it("fails closed when missing geometry occurs in a page with heading or band transitions", () => {
      const rawItems = [
        // Spanning title heading
        { str: "Document Title Spanning Full Width", transform: [1, 0, 0, 1, 50, 380], width: 450, height: 16, hasEOL: true },
        // Item with missing geometry at transition
        { str: "Subtitle with missing transform", transform: undefined as any, width: 150, height: 12, hasEOL: true },
        // Body lines
        { str: "Body line one text", transform: [1, 0, 0, 1, 50, 300], width: 200, height: 12, hasEOL: true },
        { str: "Body line two text", transform: [1, 0, 0, 1, 50, 280], width: 200, height: 12, hasEOL: true },
      ];
      expect(() => reconstructPdfPageText(rawItems as any)).toThrow(LayoutAmbiguityError);
    });

    it("confirms that no items disappear and paragraph structure is preserved during single-column reconstruction", () => {
      const rawItems = [
        { str: "Paragraph 1 line 1.", transform: [1, 0, 0, 1, 50, 350], width: 120, height: 12, hasEOL: true },
        { str: "Paragraph 1 line 2 with", transform: [1, 0, 0, 1, 50, 335], width: 80, height: 12, hasEOL: false },
        { str: "continued line 2.", transform: [1, 0, 0, 1, 135, 335], width: 50, height: 12, hasEOL: true },
        { str: "Paragraph 2 line 1.", transform: [1, 0, 0, 1, 50, 290], width: 120, height: 12, hasEOL: true },
      ];

      const text = reconstructPdfPageText(rawItems as any);

      // Verify zero dropped items
      expect(text).toContain("Paragraph 1 line 1.");
      expect(text).toContain("Paragraph 1 line 2 with");
      expect(text).toContain("continued line 2.");
      expect(text).toContain("Paragraph 2 line 1.");

      // Verify paragraph structure (\n\n) is preserved
      expect(text).toContain("\n\n");
      const paragraphs = text.split("\n\n");
      expect(paragraphs.length).toBe(2);
      expect(paragraphs[0]).toContain("Paragraph 1");
      expect(paragraphs[1]).toContain("Paragraph 2");
    });

    it("fails closed with LayoutAmbiguityError when partial missing geometry could belong to an adjacent column or separate region (Adversarial Case)", () => {
      // Known geometrical items appear to form an ordinary single column:
      // 3 lines spanning x in [50, 170], no horizontal projection void, single band, SINGLE_COLUMN.
      // An item with missing geometry actually belongs to a separate column or region (e.g. Column 2).
      const adversarialRawItems = [
        { str: "Column 1 line 1.", transform: [1, 0, 0, 1, 50, 350], width: 120, height: 12, hasEOL: true },
        { str: "Column 1 line 2.", transform: [1, 0, 0, 1, 50, 330], width: 120, height: 12, hasEOL: true },
        { str: "Column 1 line 3.", transform: [1, 0, 0, 1, 50, 310], width: 120, height: 12, hasEOL: true },
        // Unanchored item from separate column that lost its geometry
        { str: "Column 2 text line from separate column", transform: undefined as any, width: 120, height: 12, hasEOL: true },
      ];

      // Geometrical items alone satisfy single-column checks, but the engine must NOT silently
      // assume the missing item belongs to the single column or interleave/append it.
      expect(() => reconstructPdfPageText(adversarialRawItems as any)).toThrow(LayoutAmbiguityError);
    });

    it("fails closed when geometry-missing item appears between lines without baseline proof", () => {
      const rawItems = [
        { str: "Column 1 line 1.", transform: [1, 0, 0, 1, 50, 350], width: 120, height: 12, hasEOL: true },
        // Missing item between lines (prev item had hasEOL: true)
        { str: "Marginal note or col 2 heading", transform: undefined as any, width: 80, height: 12, hasEOL: false },
        { str: "Column 1 line 2.", transform: [1, 0, 0, 1, 50, 330], width: 120, height: 12, hasEOL: true },
      ];
      expect(() => reconstructPdfPageText(rawItems as any)).toThrow(LayoutAmbiguityError);
    });

    it("verifies verifyMissingGeometrySingleColumnSafety helper logic across boundaries", () => {
      const minGutter = 18;
      // 1. Missing item at start of stream
      expect(
        verifyMissingGeometrySingleColumnSafety(
          [
            { id: 0, str: "Start missing", x: 0, y: 0, w: 0, h: 0, dir: "ltr", hasEOL: false, hasValidGeometry: false },
            { id: 1, str: "Valid text", x: 50, y: 300, w: 50, h: 12, dir: "ltr", hasEOL: true, hasValidGeometry: true },
          ],
          minGutter
        )
      ).toBe(false);

      // 2. Missing item at end of stream
      expect(
        verifyMissingGeometrySingleColumnSafety(
          [
            { id: 0, str: "Valid text", x: 50, y: 300, w: 50, h: 12, dir: "ltr", hasEOL: false, hasValidGeometry: true },
            { id: 1, str: "End missing", x: 0, y: 0, w: 0, h: 0, dir: "ltr", hasEOL: false, hasValidGeometry: false },
          ],
          minGutter
        )
      ).toBe(false);

      // 3. Missing item has hasEOL: true
      expect(
        verifyMissingGeometrySingleColumnSafety(
          [
            { id: 0, str: "Start", x: 50, y: 300, w: 50, h: 12, dir: "ltr", hasEOL: false, hasValidGeometry: true },
            { id: 1, str: "Terminating missing", x: 0, y: 0, w: 0, h: 0, dir: "ltr", hasEOL: true, hasValidGeometry: false },
            { id: 2, str: "End", x: 105, y: 300, w: 50, h: 12, dir: "ltr", hasEOL: true, hasValidGeometry: true },
          ],
          minGutter
        )
      ).toBe(false);

      // 4. Missing item flanked by items on different baselines (y=300 vs y=280)
      expect(
        verifyMissingGeometrySingleColumnSafety(
          [
            { id: 0, str: "Line 1", x: 50, y: 300, w: 50, h: 12, dir: "ltr", hasEOL: false, hasValidGeometry: true },
            { id: 1, str: "Missing between", x: 0, y: 0, w: 0, h: 0, dir: "ltr", hasEOL: false, hasValidGeometry: false },
            { id: 2, str: "Line 2", x: 50, y: 280, w: 50, h: 12, dir: "ltr", hasEOL: true, hasValidGeometry: true },
          ],
          minGutter
        )
      ).toBe(false);

      // 5. Gap >= minGutterWidth (gap is 25 >= 18)
      expect(
        verifyMissingGeometrySingleColumnSafety(
          [
            { id: 0, str: "Left word", x: 50, y: 300, w: 50, h: 12, dir: "ltr", hasEOL: false, hasValidGeometry: true },
            { id: 1, str: "Missing", x: 0, y: 0, w: 0, h: 0, dir: "ltr", hasEOL: false, hasValidGeometry: false },
            { id: 2, str: "Right word", x: 125, y: 300, w: 50, h: 12, dir: "ltr", hasEOL: true, hasValidGeometry: true },
          ],
          minGutter
        )
      ).toBe(false);

      // 6. Multi-item page containing missing geometry -> FAILS CLOSED (stream adjacency != physical enclosure, no trusted provenance)
      expect(
        verifyMissingGeometrySingleColumnSafety(
          [
            { id: 0, str: "Hello", x: 50, y: 300, w: 30, h: 12, dir: "ltr", hasEOL: false, hasValidGeometry: true },
            { id: 1, str: "[symbol]", x: 0, y: 0, w: 0, h: 0, dir: "ltr", hasEOL: false, hasValidGeometry: false },
            { id: 2, str: "World", x: 85, y: 300, w: 30, h: 12, dir: "ltr", hasEOL: true, hasValidGeometry: true },
          ],
          minGutter
        )
      ).toBe(false);

      // 7. All items have valid geometry -> SUCCEEDS
      expect(
        verifyMissingGeometrySingleColumnSafety(
          [
            { id: 0, str: "Hello", x: 50, y: 300, w: 30, h: 12, dir: "ltr", hasEOL: false, hasValidGeometry: true },
            { id: 1, str: "World", x: 85, y: 300, w: 30, h: 12, dir: "ltr", hasEOL: true, hasValidGeometry: true },
          ],
          minGutter
        )
      ).toBe(true);

      // 8. Solitary item without geometry -> SUCCEEDS (trivially safe)
      expect(
        verifyMissingGeometrySingleColumnSafety(
          [
            { id: 0, str: "Solitary", x: 0, y: 0, w: 0, h: 0, dir: "ltr", hasEOL: false, hasValidGeometry: false },
          ],
          minGutter
        )
      ).toBe(true);
    });

    it("throws LayoutAmbiguityError on work-budget exhaustion through the actual engine", () => {
      const budget = new WorkBudget(5); // tiny budget that will immediately exhaust
      const items: PositionedPdfTextItem[] = [
        makeItem(0, "A", 50, 300, 100),
        makeItem(1, "B", 50, 280, 100),
      ];

      expect(() =>
        reconstructPageLayout(
          items,
          [0, 0, 600, 400],
          (col, b) => reconstructSingleColumnText(col, b),
          budget
        )
      ).toThrow(/budget exceeded/i);
    });
  });

  // =========================================================================
  // CATEGORY F: Physical PDF Fixtures Integration Tests
  // =========================================================================
  describe("Category F: Physical PDF Fixtures Integration", () => {
    const fixturesDir = path.resolve(__dirname, "fixtures");
    let service: LocalDocumentProcessingService;

    beforeEach(async () => {
      const storageModule = await import("../storage");
      const { LocalStorageService } = await import("../storage-local");
      const localStorage = new LocalStorageService(fixturesDir);
      vi.spyOn(storageModule, "getStorageService").mockReturnValue(localStorage);
      service = new LocalDocumentProcessingService();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("extracts two-column-symmetric.pdf in left-to-right reading order", async () => {
      const result = await service.extractText({
        storageKey: "two-column-symmetric.pdf",
        mimeType: "application/pdf",
      });

      expect(result.text).toContain("Left column line one.");
      expect(result.text).toContain("Left column line three.");
      expect(result.text).toContain("Right column line one.");
      expect(result.text).toContain("Right column line three.");

      // Check non-interleaved reading order: left column completes before right column starts
      const leftThreeIdx = result.text.indexOf("Left column line three.");
      const rightOneIdx = result.text.indexOf("Right column line one.");
      expect(leftThreeIdx).toBeLessThan(rightOneIdx);
    });

    it("extracts two-column-staggered.pdf in correct order despite staggered baselines", async () => {
      const result = await service.extractText({
        storageKey: "two-column-staggered.pdf",
        mimeType: "application/pdf",
      });

      expect(result.text).toContain("Staggered left line three.");
      expect(result.text).toContain("Staggered right line one.");

      const leftLastIdx = result.text.indexOf("Staggered left line three.");
      const rightFirstIdx = result.text.indexOf("Staggered right line one.");
      expect(leftLastIdx).toBeLessThan(rightFirstIdx);
    });

    it("extracts three-column-unequal.pdf in left-to-right column order", async () => {
      const result = await service.extractText({
        storageKey: "three-column-unequal.pdf",
        mimeType: "application/pdf",
      });

      expect(result.text).toContain("Col one line two.");
      expect(result.text).toContain("Col two line one.");
      expect(result.text).toContain("Col three single line.");

      const col1End = result.text.indexOf("Col one line two.");
      const col2Start = result.text.indexOf("Col two line one.");
      const col3Start = result.text.indexOf("Col three single line.");

      expect(col1End).toBeLessThan(col2Start);
      expect(col2Start).toBeLessThan(col3Start);
    });

    it("fails closed on crossing-gutter-ambiguous.pdf without silently interleaving", async () => {
      await expect(
        service.extractText({
          storageKey: "crossing-gutter-ambiguous.pdf",
          mimeType: "application/pdf",
        })
      ).rejects.toThrow();
    });

    it("extracts heading-spanning.pdf in correct order (Title -> Col 1 lines -> Col 2 lines)", async () => {
      const result = await service.extractText({
        storageKey: "heading-spanning.pdf",
        mimeType: "application/pdf",
      });

      expect(result.text).toContain("Full-Width Document Title Heading Spanning Content Width");
      expect(result.text).toContain("Column one text line one.");
      expect(result.text).toContain("Column one text line three.");
      expect(result.text).toContain("Column two text line one.");
      expect(result.text).toContain("Column two text line three.");

      const titleIdx = result.text.indexOf("Full-Width Document Title Heading Spanning Content Width");
      const col1EndIdx = result.text.indexOf("Column one text line three.");
      const col2StartIdx = result.text.indexOf("Column two text line one.");

      expect(titleIdx).toBeLessThan(col1EndIdx);
      expect(col1EndIdx).toBeLessThan(col2StartIdx);
    });

    it("extracts cropbox-offset.pdf with non-zero CropBox coordinates correctly in reading order", async () => {
      const result = await service.extractText({
        storageKey: "cropbox-offset.pdf",
        mimeType: "application/pdf",
      });

      expect(result.text).toContain("Offset col one line one.");
      expect(result.text).toContain("Offset col one line three.");
      expect(result.text).toContain("Offset col two line one.");
      expect(result.text).toContain("Offset col two line three.");

      const col1EndIdx = result.text.indexOf("Offset col one line three.");
      const col2StartIdx = result.text.indexOf("Offset col two line one.");

      expect(col1EndIdx).toBeLessThan(col2StartIdx);
    });

    it("fails closed on ambiguous-multicol-insufficient-evidence.pdf without falling back to single-column", async () => {
      await expect(
        service.extractText({
          storageKey: "ambiguous-multicol-insufficient-evidence.pdf",
          mimeType: "application/pdf",
        })
      ).rejects.toThrow(LayoutAmbiguityError);
    });

    it("extracts heading-between-multicolumn-bands.pdf with correct reading order across bands and columns", async () => {
      const result = await service.extractText({
        storageKey: "heading-between-multicolumn-bands.pdf",
        mimeType: "application/pdf",
      });

      expect(result.text).toContain("Intro col one line three.");
      expect(result.text).toContain("Intro col two line one.");
      expect(result.text).toContain("Intermediate Full-Width Section Header");
      expect(result.text).toContain("Body col one line three.");
      expect(result.text).toContain("Body col two line one.");

      const intro1End = result.text.indexOf("Intro col one line three.");
      const intro2Start = result.text.indexOf("Intro col two line one.");
      const headerIdx = result.text.indexOf("Intermediate Full-Width Section Header");
      const body1End = result.text.indexOf("Body col one line three.");
      const body2Start = result.text.indexOf("Body col two line one.");

      expect(intro1End).toBeLessThan(intro2Start);
      expect(intro2Start).toBeLessThan(headerIdx);
      expect(headerIdx).toBeLessThan(body1End);
      expect(body1End).toBeLessThan(body2Start);
    });

    it("extracts rotated-90.pdf in left-to-right reading order (Col 1 lines -> Col 2 lines)", async () => {
      const result = await service.extractText({
        storageKey: "rotated-90.pdf",
        mimeType: "application/pdf",
      });

      expect(result.text).toContain("Rotated90 col one line three.");
      expect(result.text).toContain("Rotated90 col two line one.");

      const col1End = result.text.indexOf("Rotated90 col one line three.");
      const col2Start = result.text.indexOf("Rotated90 col two line one.");
      expect(col1End).toBeLessThan(col2Start);
    });

    it("extracts rotated-180.pdf in left-to-right reading order (Col 1 lines -> Col 2 lines)", async () => {
      const result = await service.extractText({
        storageKey: "rotated-180.pdf",
        mimeType: "application/pdf",
      });

      expect(result.text).toContain("Rotated180 col one line three.");
      expect(result.text).toContain("Rotated180 col two line one.");

      const col1End = result.text.indexOf("Rotated180 col one line three.");
      const col2Start = result.text.indexOf("Rotated180 col two line one.");
      expect(col1End).toBeLessThan(col2Start);
    });

    it("extracts rotated-270.pdf in left-to-right reading order (Col 1 lines -> Col 2 lines)", async () => {
      const result = await service.extractText({
        storageKey: "rotated-270.pdf",
        mimeType: "application/pdf",
      });

      expect(result.text).toContain("Rotated270 col one line three.");
      expect(result.text).toContain("Rotated270 col two line one.");

      const col1End = result.text.indexOf("Rotated270 col one line three.");
      const col2Start = result.text.indexOf("Rotated270 col two line one.");
      expect(col1End).toBeLessThan(col2Start);
    });
  });
});
