/**
 * Zenote PDF Multi-Column Reading Order Layout Engine (Phase 11.3.5B.1)
 *
 * Implements deterministic, left-to-right multi-column PDF reconstruction with:
 * 1. Hard workload caps (10,000 items, 100 slices, 4 gaps/slice, 6 corridors, 150k solver nodes).
 * 2. Unified 30,000,000 abstract synchronous work budget with overflow-safe pre-checks.
 * 3. Baseline-only half-open vertical slicing (Policy A: exactly 1 slice per baseline, zero height clamping).
 * 4. Strict gap interval validation (finite, positive-width, sorted, non-overlapping, non-touching).
 * 5. Bounded bipartite assignment solver (unrounded IEEE 754 score, match count, canonical lexicographic tie-break).
 * 6. Corridor tracking finite state machine with strict invasion detection.
 * 7. Primary whole-band horizontal projection void test for single-column acceptance.
 * 8. Exact item conservation (every item appears exactly once; zero dropped, duplicated, or crossed items).
 * 9. Atomic fail-closed behavior via LayoutAmbiguityError.
 */

// ============================================================================
// 1. HARD WORKLOAD LIMITS & CONFIGURATION CONSTANTS
// ============================================================================

export const MAX_RAW_ITEMS_PER_PAGE = 10_000;
export const MAX_VALID_ITEMS_PER_PAGE = 10_000;
export const MAX_BANDS_PER_PAGE = 5;
export const MAX_COLUMNS_PER_BAND = 3;
export const MAX_REGIONS_PER_PAGE = 15;
export const MAX_SLICES_PER_PAGE = 100;
export const MAX_SLICE_ITEM_MEMBERSHIPS = 10_000;
export const MAX_GAPS_PER_SLICE = 4;
export const MAX_ACTIVE_CORRIDORS = 6;
export const MAX_SOLVER_NODES_PER_SLICE = 1_500;
export const MAX_PAGE_SOLVER_NODES = 150_000;
export const MAX_PAGE_WORK_UNITS = 30_000_000;

export const MIN_GUTTER_WIDTH_PT = 14.0; // Base G_min
export const TEXT_MERGE_TOLERANCE_PT = 4.0;
export const MIN_SLICE_HEIGHT_PT = 10.0;
export const MIN_CORRIDOR_CONFIRMATION_COVERAGE = 0.60; // 60% of non-empty slices

export function computeBodyTextHeight(items: PositionedPdfTextItem[]): number {
  const textItems = items.filter((it) => it.w > 0 && it.str.trim().length > 0);
  if (textItems.length === 0) return 12.0;
  const heights = textItems.map((it) => it.h).sort((a, b) => a - b);
  const mid = Math.floor(heights.length / 2);
  return heights[mid] ?? 12.0;
}

export function computeMinGutterWidth(items: PositionedPdfTextItem[]): number {
  const bodyH = computeBodyTextHeight(items);
  return Math.max(MIN_GUTTER_WIDTH_PT, 1.5 * bodyH);
}

// ============================================================================
// 2. ERROR AND WORK BUDGET
// ============================================================================

export class LayoutAmbiguityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutAmbiguityError";
  }
}

export class WorkBudget {
  public unitsUsed = 0;
  constructor(public readonly maxUnits: number = MAX_PAGE_WORK_UNITS) {}

  public recordWork(units = 1): void {
    if (units > this.maxUnits - this.unitsUsed) {
      throw new LayoutAmbiguityError(
        `Synchronous page processing budget exceeded (${this.unitsUsed + units} > ${this.maxUnits} units)`
      );
    }
    this.unitsUsed += units;
  }
}

// ============================================================================
// 3. CORE GEOMETRY & INTERVAL INTERFACES
// ============================================================================

export interface PositionedPdfTextItem {
  id: number;
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  dir: string;
  hasEOL: boolean;
  hasValidGeometry: boolean;
}

export interface GapInterval {
  start: number;
  end: number;
  isLeftOpen?: boolean;
  isRightOpen?: boolean;
}

export interface Slice {
  index: number;
  yBottom: number;
  yTop: number;
  items: PositionedPdfTextItem[];
  gaps: GapInterval[];
  isEmpty: boolean;
}

export type CorridorState =
  | "ACTIVE_INTERNAL"
  | "ACTIVE_OPEN_LEFT"
  | "ACTIVE_OPEN_RIGHT"
  | "BRIDGING_EMPTY"
  | "CONFIRMED"
  | "TERMINATED_MERGED"
  | "FAILED_AMBIGUOUS";

export interface CandidateCorridor {
  id: number;
  start: number;
  end: number;
  state: CorridorState;
  matchedSlicesCount: number;
  emptySlicesBridged: number;
  initialSlice: number;
  lastMatchedSlice: number;
  isConfirmed: boolean;
  leftLinesCount?: number;
  rightLinesCount?: number;
  leftSlicesCount?: number;
  rightSlicesCount?: number;
}

export interface ContentBand {
  index: number;
  yTop: number;
  yBottom: number;
  type: "FULL_WIDTH" | "MULTI_COLUMN" | "SINGLE_COLUMN";
  items: PositionedPdfTextItem[];
  columns: PositionedPdfTextItem[][];
  gutters: CandidateCorridor[];
}

export interface PageLayout {
  bands: ContentBand[];
  totalRegions: number;
}

export function getPageViewBounds(
  pageView?: number[],
  validItems?: PositionedPdfTextItem[],
  pageRotate?: number
): { minX: number; minY: number; maxX: number; maxY: number; rotation: number } {
  let rotation = 0;
  if (pageRotate !== undefined) {
    if (!Number.isFinite(pageRotate) || pageRotate % 90 !== 0) {
      throw new LayoutAmbiguityError(`Invalid page rotation: ${pageRotate}`);
    }
    rotation = ((pageRotate % 360) + 360) % 360;
  }

  if (pageView && Array.isArray(pageView) && pageView.length >= 4) {
    const [x1, y1, x2, y2] = pageView;
    if (
      typeof x1 === "number" &&
      Number.isFinite(x1) &&
      typeof y1 === "number" &&
      Number.isFinite(y1) &&
      typeof x2 === "number" &&
      Number.isFinite(x2) &&
      typeof y2 === "number" &&
      Number.isFinite(y2)
    ) {
      return {
        minX: Math.min(x1, x2),
        minY: Math.min(y1, y2),
        maxX: Math.max(x1, x2),
        maxY: Math.max(y1, y2),
        rotation,
      };
    }
    throw new LayoutAmbiguityError("Invalid non-finite page view bounds");
  }

  if (!validItems || validItems.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, rotation };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const it of validItems) {
    if (!Number.isFinite(it.x) || !Number.isFinite(it.y) || !Number.isFinite(it.w) || !Number.isFinite(it.h)) {
      throw new LayoutAmbiguityError(`Non-finite item coordinates: [${it.x}, ${it.y}, ${it.w}, ${it.h}]`);
    }
    if (it.x < minX) minX = it.x;
    if (it.x + it.w > maxX) maxX = it.x + it.w;
    if (it.y < minY) minY = it.y;
    if (it.y > maxY) maxY = it.y;
  }

  return { minX, minY, maxX, maxY, rotation };
}

// ============================================================================
// 4. GAP VALIDATION (STRICT DISJOINTNESS & CANONICAL ORDER)
// ============================================================================

export function validateGapIntervals(gaps: GapInterval[]): void {
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i]!;
    if (!Number.isFinite(g.start) || !Number.isFinite(g.end)) {
      throw new LayoutAmbiguityError(
        `Gap interval [${g.start}, ${g.end}] contains non-finite coordinates`
      );
    }
    if (g.end <= g.start) {
      throw new LayoutAmbiguityError(
        `Gap interval [${g.start}, ${g.end}] has non-positive width (${g.end - g.start})`
      );
    }
    if (i > 0) {
      const prev = gaps[i - 1]!;
      // Strict disjointness: curr.start must be strictly greater than prev.end
      // Rejects overlapping, nested, duplicate, and touching intervals
      if (g.start <= prev.end) {
        throw new LayoutAmbiguityError(
          `Gap intervals prev=[${prev.start}, ${prev.end}] and curr=[${g.start}, ${g.end}] overlap, touch, or are out of order`
        );
      }
    }
  }
}

// ============================================================================
// 5. BASELINE-ONLY HALF-OPEN SLICING (POLICY A)
// ============================================================================

export function constructSlices(
  validItems: PositionedPdfTextItem[],
  pageView: number[] | undefined,
  budget: WorkBudget
): Slice[] {
  let minY: number;
  let maxY: number;

  if (pageView && Array.isArray(pageView) && pageView.length >= 4) {
    const pvY1 = pageView[1];
    const pvY2 = pageView[3];
    if (
      typeof pvY1 === "number" &&
      Number.isFinite(pvY1) &&
      typeof pvY2 === "number" &&
      Number.isFinite(pvY2)
    ) {
      minY = Math.min(pvY1, pvY2);
      maxY = Math.max(pvY1, pvY2);
    } else {
      throw new LayoutAmbiguityError("Invalid non-finite page view bounds");
    }
  } else {
    minY = Infinity;
    maxY = -Infinity;
    for (const it of validItems) {
      if (!Number.isFinite(it.y)) {
        throw new LayoutAmbiguityError(`Non-finite item baseline coordinate: y=${it.y}`);
      }
      if (it.y < minY) minY = it.y;
      if (it.y > maxY) maxY = it.y;
    }
  }

  // Fail closed on out-of-bounds or non-finite baselines
  for (const it of validItems) {
    if (!Number.isFinite(it.y) || it.y < minY || it.y > maxY) {
      throw new LayoutAmbiguityError(
        `Item baseline out of page bounds: y=${it.y}, bounds=[${minY}, ${maxY}]`
      );
    }
  }

  const H = maxY - minY;
  if (H <= 0 || validItems.length === 0) {
    return [
      {
        index: 0,
        yBottom: minY,
        yTop: maxY,
        items: [...validItems],
        gaps: [],
        isEmpty: validItems.length === 0,
      },
    ];
  }

  const sliceHeight = Math.max(MIN_SLICE_HEIGHT_PT, H / MAX_SLICES_PER_PAGE);
  const S = Math.ceil(H / sliceHeight);
  if (S > MAX_SLICES_PER_PAGE) {
    throw new LayoutAmbiguityError(
      `Page slice count exceeds budget (${S} > ${MAX_SLICES_PER_PAGE})`
    );
  }

  const slices: Slice[] = [];
  for (let s = 0; s < S; s++) {
    const yBottom = minY + s * sliceHeight;
    const yTop = s === S - 1 ? maxY : minY + (s + 1) * sliceHeight;
    slices.push({
      index: s,
      yBottom,
      yTop,
      items: [],
      gaps: [],
      isEmpty: true,
    });
  }

  // Assign every item to exactly one slice using its baseline coordinate
  for (const it of validItems) {
    let s = Math.floor((it.y - minY) / sliceHeight);
    if (s >= S) {
      if (Math.abs(it.y - maxY) <= 1e-4) {
        s = S - 1; // Top boundary point maps to final slice
      } else {
        throw new LayoutAmbiguityError(
          `Computed slice index out of bounds: s=${s}, S=${S}, y=${it.y}`
        );
      }
    }
    slices[s]!.items.push(it);
    slices[s]!.isEmpty = false;
  }

  // Exact 1:1 item conservation check across slices
  let totalAssigned = 0;
  for (const sl of slices) {
    totalAssigned += sl.items.length;
  }
  if (totalAssigned !== validItems.length) {
    throw new LayoutAmbiguityError(
      `Slice item assignment conservation failed (${totalAssigned} !== ${validItems.length})`
    );
  }

  return slices;
}

// ============================================================================
// 6. SLICE GAP EXTRACTION & CANONICAL SORTING
// ============================================================================

export function extractSliceGaps(
  slice: Slice,
  budget: WorkBudget
): GapInterval[] {
  // Exclude zero-width or whitespace-only items
  const textItems = slice.items.filter(
    (it) => it.w > 0 && it.str.trim().length > 0
  );
  if (textItems.length === 0) {
    return [];
  }

  const intervals: { start: number; end: number }[] = [];
  for (const it of textItems) {
    intervals.push({ start: it.x, end: it.x + it.w });
  }

  // Sort horizontal text intervals
  intervals.sort((a, b) => {
    budget.recordWork(1);
    return a.start - b.start || a.end - b.end;
  });

  // Merge intervals with delta = 4.0 pt
  const merged: { start: number; end: number }[] = [];
  let curr = { start: intervals[0]!.start, end: intervals[0]!.end };
  for (let i = 1; i < intervals.length; i++) {
    budget.recordWork(1);
    const iv = intervals[i]!;
    if (iv.start <= curr.end + TEXT_MERGE_TOLERANCE_PT) {
      curr.end = Math.max(curr.end, iv.end);
    } else {
      merged.push(curr);
      curr = { start: iv.start, end: iv.end };
    }
  }
  merged.push(curr);

  // Internal whitespace gaps between merged text blocks
  const gaps: GapInterval[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    budget.recordWork(1);
    const gStart = merged[i]!.end;
    const gEnd = merged[i + 1]!.start;
    const width = gEnd - gStart;
    if (width >= MIN_GUTTER_WIDTH_PT) {
      gaps.push({ start: gStart, end: gEnd });
    }
  }

  if (gaps.length > MAX_GAPS_PER_SLICE) {
    throw new LayoutAmbiguityError(
      `Slice gap count exceeds maximum budget (${gaps.length} > ${MAX_GAPS_PER_SLICE})`
    );
  }

  // Canonical sort: start ascending, then end ascending
  gaps.sort((a, b) => {
    budget.recordWork(1);
    return a.start - b.start || a.end - b.end;
  });

  // Preflight validation before solver consumption
  validateGapIntervals(gaps);

  slice.gaps = gaps;
  return gaps;
}

// ============================================================================
// 7. EXACT BIPARTITE ASSIGNMENT SOLVER
// ============================================================================

export interface AssignmentMatch {
  corridorId: number;
  gapIndex: number;
  score: number;
}

export interface SolverResult {
  matches: AssignmentMatch[];
  unmatchedCorridors: number[];
  unmatchedGaps: number[];
  totalScore: number;
  matchCount: number;
}

export function computeOptimalBipartiteAssignment(
  activeCorridors: CandidateCorridor[],
  sliceGaps: GapInterval[],
  budget: WorkBudget,
  pageSolverTracker: { totalNodes: number }
): SolverResult {
  // Sort corridors by id ascending, gaps by start ascending
  const sortedCorridors = [...activeCorridors].sort((a, b) => a.id - b.id);
  const sortedGaps = [...sliceGaps].sort((a, b) => a.start - b.start || a.end - b.end);

  const nC = sortedCorridors.length;
  const nG = sortedGaps.length;

  if (nC === 0 || nG === 0) {
    return {
      matches: [],
      unmatchedCorridors: sortedCorridors.map((c) => c.id),
      unmatchedGaps: sortedGaps.map((_, i) => i),
      totalScore: 0,
      matchCount: 0,
    };
  }

  // Precompute unrounded IEEE 754 score matrix
  const scores: number[][] = [];
  for (let c = 0; c < nC; c++) {
    scores[c] = [];
    const corr = sortedCorridors[c]!;
    for (let g = 0; g < nG; g++) {
      const gap = sortedGaps[g]!;
      const interStart = Math.max(corr.start, gap.start);
      const interEnd = Math.min(corr.end, gap.end);
      const interWidth = interEnd - interStart;
      if (interWidth <= 0) {
        scores[c]![g] = 0;
        continue;
      }
      const unionStart = Math.min(corr.start, gap.start);
      const unionEnd = Math.max(corr.end, gap.end);
      const unionWidth = unionEnd - unionStart;
      const jaccard = unionWidth > 0 ? interWidth / unionWidth : 0;

      const cWidth = corr.end - corr.start;
      const containment = cWidth > 0 ? interWidth / cWidth : 0;
      if (jaccard >= 0.50 || (gap.isLeftOpen || gap.isRightOpen ? containment >= 0.80 : false)) {
        scores[c]![g] = jaccard;
      } else {
        scores[c]![g] = 0;
      }
    }
  }

  let bestMatches: { cIdx: number; gIdx: number; score: number }[] = [];
  let bestScore = -1;
  let bestCount = -1;
  let sliceNodeCount = 0;

  function isLexicographicallyEarlier(
    cand: { cIdx: number; gIdx: number }[],
    best: { cIdx: number; gIdx: number }[]
  ): boolean {
    const candC = cand.map((m) => sortedCorridors[m.cIdx]!.id).sort((a, b) => a - b);
    const bestC = best.map((m) => sortedCorridors[m.cIdx]!.id).sort((a, b) => a - b);
    for (let i = 0; i < candC.length; i++) {
      if (candC[i] !== bestC[i]) {
        return candC[i]! < bestC[i]!;
      }
    }
    return false;
  }

  function search(
    gIdx: number,
    usedCorridorsMask: number,
    currentMatches: { cIdx: number; gIdx: number; score: number }[],
    currentScore: number
  ) {
    sliceNodeCount++;
    pageSolverTracker.totalNodes++;
    budget.recordWork(1);

    if (sliceNodeCount > MAX_SOLVER_NODES_PER_SLICE) {
      throw new LayoutAmbiguityError(
        `Solver search nodes per slice exceeded limit (${sliceNodeCount} > ${MAX_SOLVER_NODES_PER_SLICE})`
      );
    }
    if (pageSolverTracker.totalNodes > MAX_PAGE_SOLVER_NODES) {
      throw new LayoutAmbiguityError(
        `Cumulative solver search nodes per page exceeded limit (${pageSolverTracker.totalNodes} > ${MAX_PAGE_SOLVER_NODES})`
      );
    }

    if (gIdx === nG) {
      // Leaf evaluation with strict 3-tier objective
      const count = currentMatches.length;
      let isBetter = false;
      if (currentScore > bestScore) {
        isBetter = true;
      } else if (currentScore === bestScore) {
        if (count > bestCount) {
          isBetter = true;
        } else if (count === bestCount && isLexicographicallyEarlier(currentMatches, bestMatches)) {
          isBetter = true;
        }
      }

      if (isBetter) {
        bestScore = currentScore;
        bestCount = count;
        bestMatches = [...currentMatches];
      }
      return;
    }

    // Branch 1: Skip gap gIdx
    search(gIdx + 1, usedCorridorsMask, currentMatches, currentScore);

    // Branch 2: Match gap gIdx to unassigned eligible corridor
    for (let c = 0; c < nC; c++) {
      if (!(usedCorridorsMask & (1 << c))) {
        const edgeScore = scores[c]![gIdx]!;
        if (edgeScore > 0) {
          currentMatches.push({ cIdx: c, gIdx, score: edgeScore });
          search(gIdx + 1, usedCorridorsMask | (1 << c), currentMatches, currentScore + edgeScore);
          currentMatches.pop();
        }
      }
    }
  }

  search(0, 0, [], 0);

  const matchedCorridorIndices = new Set(bestMatches.map((m) => m.cIdx));
  const matchedGapIndices = new Set(bestMatches.map((m) => m.gIdx));

  const resultMatches: AssignmentMatch[] = bestMatches.map((m) => ({
    corridorId: sortedCorridors[m.cIdx]!.id,
    gapIndex: m.gIdx,
    score: m.score,
  }));

  const unmatchedCorridors = sortedCorridors
    .filter((_, idx) => !matchedCorridorIndices.has(idx))
    .map((c) => c.id);

  const unmatchedGaps = sortedGaps
    .map((_, idx) => idx)
    .filter((idx) => !matchedGapIndices.has(idx));

  return {
    matches: resultMatches,
    unmatchedCorridors,
    unmatchedGaps,
    totalScore: Math.max(0, bestScore),
    matchCount: Math.max(0, bestCount),
  };
}

export interface VisualPdfLineGroup {
  lineId: number;
  y: number;
  height: number;
  items: PositionedPdfTextItem[];
}

export function groupItemsIntoVisualLines(
  items: PositionedPdfTextItem[],
  budget: WorkBudget
): { lines: VisualPdfLineGroup[]; itemLineMap: Map<number, number> } {
  const lines: VisualPdfLineGroup[] = [];
  const sortedItems = [...items].sort((a, b) => {
    budget.recordWork(1);
    return b.y - a.y || a.x - b.x;
  });

  for (const item of sortedItems) {
    budget.recordWork(1);
    const tolerance = Math.max(2.5, item.h * 0.25);
    let matchedLine: VisualPdfLineGroup | null = null;

    // Pass 1: Standard baseline tolerance match
    for (const line of lines) {
      budget.recordWork(1);
      if (Math.abs(line.y - item.y) <= tolerance) {
        matchedLine = line;
        break;
      }
    }

    // Pass 2: Superscript / Subscript association
    if (!matchedLine) {
      for (const line of lines) {
        budget.recordWork(1);
        const isScript =
          item.h <= line.height * 0.85 &&
          ((item.y > line.y && item.y - line.y <= line.height * 0.7) ||
            (item.y < line.y && line.y - item.y <= line.height * 0.45)) &&
          line.items.some((it) => {
            budget.recordWork(1);
            return (
              Math.abs(item.x - (it.x + it.w)) <= line.height * 0.75 ||
              Math.abs(item.x - it.x) <= line.height * 0.75
            );
          });

        const isBaseOfScriptLine =
          line.items.every((it) => {
            budget.recordWork(1);
            return it.h <= item.h * 0.85;
          }) &&
          ((line.y > item.y && line.y - item.y <= item.h * 0.7) ||
            (line.y < item.y && item.y - line.y <= item.h * 0.45)) &&
          line.items.some((it) => {
            budget.recordWork(1);
            return (
              Math.abs(item.x - (it.x + it.w)) <= item.h * 0.75 ||
              Math.abs(item.x - it.x) <= item.h * 0.75 ||
              Math.abs(item.x + item.w - it.x) <= item.h * 0.75
            );
          });

        if (isScript) {
          matchedLine = line;
          break;
        } else if (isBaseOfScriptLine) {
          line.y = item.y;
          line.height = item.h;
          matchedLine = line;
          break;
        }
      }
    }

    if (matchedLine) {
      matchedLine.items.push(item);
      if (item.h > matchedLine.height) matchedLine.height = item.h;
    } else {
      lines.push({
        lineId: lines.length,
        y: item.y,
        height: item.h,
        items: [item],
      });
    }
  }

  const itemLineMap = new Map<number, number>();
  for (const line of lines) {
    for (const it of line.items) {
      itemLineMap.set(it.id, line.lineId);
    }
  }

  return { lines, itemLineMap };
}

// ============================================================================
// 8. CORRIDOR TRACKING & FINITE STATE MACHINE
// ============================================================================

export function trackCorridorsAcrossSlices(
  slices: Slice[],
  budget: WorkBudget,
  projectionVoids?: { start: number; end: number }[],
  minGutterWidth: number = MIN_GUTTER_WIDTH_PT
): CandidateCorridor[] {
  const pageSolverTracker = { totalNodes: 0 };
  const corridors: CandidateCorridor[] = [];
  const corridorSliceMatches = new Map<number, Set<number>>();
  const corridorLeftSlices = new Map<number, Set<number>>();
  const corridorRightSlices = new Map<number, Set<number>>();
  const corridorLeftLines = new Map<number, Set<number>>();
  const corridorRightLines = new Map<number, Set<number>>();
  let nextCorridorId = 1;

  // Extract all items across slices and map to visual lines for independent line counting
  const allItems: PositionedPdfTextItem[] = [];
  for (const s of slices) {
    allItems.push(...s.items);
  }
  const { lines: visualLines, itemLineMap } = groupItemsIntoVisualLines(allItems, budget);

  // Initialize candidate corridors from whole-band projection voids (e.g. for staggered columns)
  if (projectionVoids && projectionVoids.length > 0) {
    if (projectionVoids.length > MAX_ACTIVE_CORRIDORS) {
      throw new LayoutAmbiguityError(
        `Active corridors limit exceeded (${projectionVoids.length} > ${MAX_ACTIVE_CORRIDORS})`
      );
    }
    for (const v of projectionVoids) {
      if (v.end - v.start >= minGutterWidth) {
        const cid = nextCorridorId++;
        corridors.push({
          id: cid,
          start: v.start,
          end: v.end,
          state: "ACTIVE_INTERNAL",
          matchedSlicesCount: 0,
          emptySlicesBridged: 0,
          initialSlice: slices.length > 0 ? slices[slices.length - 1]!.index : 0,
          lastMatchedSlice: -1,
          isConfirmed: false,
          leftLinesCount: 0,
          rightLinesCount: 0,
          leftSlicesCount: 0,
          rightSlicesCount: 0,
        });
        corridorSliceMatches.set(cid, new Set());
        corridorLeftSlices.set(cid, new Set());
        corridorRightSlices.set(cid, new Set());
        corridorLeftLines.set(cid, new Set());
        corridorRightLines.set(cid, new Set());
      }
    }
  }

  // Process slices in reading order (top-to-bottom: descending slice index)
  for (let sIdx = slices.length - 1; sIdx >= 0; sIdx--) {
    const slice = slices[sIdx]!;
    const gaps = extractSliceGaps(slice, budget);

    if (slice.isEmpty) {
      // Empty slice: bridge active corridors
      for (const c of corridors) {
        if (
          c.state === "ACTIVE_INTERNAL" ||
          c.state === "ACTIVE_OPEN_LEFT" ||
          c.state === "ACTIVE_OPEN_RIGHT" ||
          c.state === "BRIDGING_EMPTY"
        ) {
          c.state = "BRIDGING_EMPTY";
          c.emptySlicesBridged++;
        }
      }
      continue;
    }

    const activeCorridors = corridors.filter(
      (c) =>
        c.state === "ACTIVE_INTERNAL" ||
        c.state === "ACTIVE_OPEN_LEFT" ||
        c.state === "ACTIVE_OPEN_RIGHT" ||
        c.state === "BRIDGING_EMPTY"
    );

    // 1. Check for text invasion into any active corridor on this non-empty slice
    for (const c of activeCorridors) {
      const hasInvadingText = slice.items.some((it) => {
        budget.recordWork(1);
        if (it.w <= 0 || it.str.trim().length === 0) return false;
        const itStart = it.x;
        const itEnd = it.x + it.w;
        return Math.max(itStart, c.start) < Math.min(itEnd, c.end);
      });

      if (hasInvadingText) {
        c.state = "FAILED_AMBIGUOUS";
        throw new LayoutAmbiguityError(
          `Text invaded active corridor ${c.id} on slice ${slice.index}`
        );
      }

      // Track left and right bounding evidence (both slice sets and independent visual line sets)
      let sliceHasLeft = false;
      let sliceHasRight = false;
      for (const it of slice.items) {
        budget.recordWork(1);
        if (it.w <= 0 || it.str.trim().length === 0) continue;
        const lineId = itemLineMap.get(it.id);

        if (it.x + it.w <= c.start + TEXT_MERGE_TOLERANCE_PT) {
          sliceHasLeft = true;
          if (lineId !== undefined) {
            corridorLeftLines.get(c.id)?.add(lineId);
          }
        }
        if (it.x >= c.end - TEXT_MERGE_TOLERANCE_PT) {
          sliceHasRight = true;
          if (lineId !== undefined) {
            corridorRightLines.get(c.id)?.add(lineId);
          }
        }
      }

      if (sliceHasLeft) {
        corridorLeftSlices.get(c.id)?.add(slice.index);
      }
      if (sliceHasRight) {
        corridorRightSlices.get(c.id)?.add(slice.index);
      }
      if (sliceHasLeft || sliceHasRight) {
        corridorSliceMatches.get(c.id)?.add(slice.index);
        c.lastMatchedSlice = slice.index;
      }
    }

    // 2. Exact Bipartite Assignment Solver for internal slice gaps
    const solverResult = computeOptimalBipartiteAssignment(
      activeCorridors,
      gaps,
      budget,
      pageSolverTracker
    );

    // Process matched gaps: narrow corridor
    for (const match of solverResult.matches) {
      const c = corridors.find((corr) => corr.id === match.corridorId)!;
      const g = gaps[match.gapIndex]!;

      // Narrow corridor core interval
      c.start = Math.max(c.start, g.start);
      c.end = Math.min(c.end, g.end);

      if (c.end - c.start < minGutterWidth) {
        c.state = "FAILED_AMBIGUOUS";
        throw new LayoutAmbiguityError(
          `Corridor ${c.id} collapsed below minimum gutter width (${c.end - c.start} < ${minGutterWidth})`
        );
      }

      corridorSliceMatches.get(c.id)?.add(slice.index);
      c.lastMatchedSlice = slice.index;
      c.state = "ACTIVE_INTERNAL";
    }

    // Process unmatched gaps: initiate new candidate corridors if non-overlapping
    for (const gIdx of solverResult.unmatchedGaps) {
      const g = gaps[gIdx]!;
      const overlapsExisting = corridors.some(
        (c) => Math.max(c.start, g.start) < Math.min(c.end, g.end)
      );
      if (!overlapsExisting) {
        if (corridors.length >= MAX_ACTIVE_CORRIDORS) {
          throw new LayoutAmbiguityError(
            `Active corridors limit exceeded (${corridors.length + 1} > ${MAX_ACTIVE_CORRIDORS})`
          );
        }
        const cid = nextCorridorId++;

        const leftLineSet = new Set<number>();
        const rightLineSet = new Set<number>();
        for (const it of slice.items) {
          if (it.w <= 0 || it.str.trim().length === 0) continue;
          const lineId = itemLineMap.get(it.id);
          if (it.x + it.w <= g.start + TEXT_MERGE_TOLERANCE_PT) {
            if (lineId !== undefined) leftLineSet.add(lineId);
          }
          if (it.x >= g.end - TEXT_MERGE_TOLERANCE_PT) {
            if (lineId !== undefined) rightLineSet.add(lineId);
          }
        }

        corridors.push({
          id: cid,
          start: g.start,
          end: g.end,
          state: "ACTIVE_INTERNAL",
          matchedSlicesCount: 1,
          emptySlicesBridged: 0,
          initialSlice: slice.index,
          lastMatchedSlice: slice.index,
          isConfirmed: false,
          leftLinesCount: leftLineSet.size,
          rightLinesCount: rightLineSet.size,
          leftSlicesCount: 1,
          rightSlicesCount: 1,
        });
        corridorSliceMatches.set(cid, new Set([slice.index]));
        corridorLeftSlices.set(cid, new Set([slice.index]));
        corridorRightSlices.set(cid, new Set([slice.index]));
        corridorLeftLines.set(cid, leftLineSet);
        corridorRightLines.set(cid, rightLineSet);
      }
    }
  }

  // Count non-empty slices
  const nonEmptySlicesCount = slices.filter((s) => !s.isEmpty).length;
  if (nonEmptySlicesCount === 0) {
    return [];
  }

  // Evaluate corridor confirmation rule: requires independent visual lines on both sides
  for (const c of corridors) {
    c.leftLinesCount = corridorLeftLines.get(c.id)?.size || 0;
    c.rightLinesCount = corridorRightLines.get(c.id)?.size || 0;
    c.leftSlicesCount = corridorLeftSlices.get(c.id)?.size || 0;
    c.rightSlicesCount = corridorRightSlices.get(c.id)?.size || 0;
    c.matchedSlicesCount = corridorSliceMatches.get(c.id)?.size || 0;

    const totalLines = visualLines.length;
    const coverage = c.matchedSlicesCount / nonEmptySlicesCount;
    const hasSufficientEvidence =
      (c.leftLinesCount >= 3 && c.rightLinesCount >= 3) ||
      (c.leftLinesCount >= 1 && c.rightLinesCount >= 1 && totalLines < 3);

    if (coverage >= MIN_CORRIDOR_CONFIRMATION_COVERAGE && hasSufficientEvidence) {
      c.isConfirmed = true;
      c.state = "CONFIRMED";
    } else {
      c.state = "FAILED_AMBIGUOUS";
      throw new LayoutAmbiguityError(
        `Candidate corridor ${c.id} [${c.start.toFixed(1)}, ${c.end.toFixed(1)}] failed confirmation (${Math.round(coverage * 100)}% slice coverage, leftLines=${c.leftLinesCount}, rightLines=${c.rightLinesCount})`
      );
    }
  }

  return corridors.filter((c) => c.isConfirmed);
}

// ============================================================================
// 9. WHOLE-BAND HORIZONTAL PROJECTION VOID CHECK
// ============================================================================

export function checkWholeBandProjectionVoid(
  validItems: PositionedPdfTextItem[],
  budget: WorkBudget,
  minGutterWidth: number = MIN_GUTTER_WIDTH_PT
): { hasVoid: boolean; voidIntervals: { start: number; end: number }[] } {
  const textItems = validItems.filter(
    (it) => it.w > 0 && it.str.trim().length > 0
  );
  if (textItems.length === 0) {
    return { hasVoid: false, voidIntervals: [] };
  }

  const intervals: { start: number; end: number }[] = [];
  for (const it of textItems) {
    intervals.push({ start: it.x, end: it.x + it.w });
  }

  intervals.sort((a, b) => {
    budget.recordWork(1);
    return a.start - b.start || a.end - b.end;
  });

  const merged: { start: number; end: number }[] = [];
  let curr = { start: intervals[0]!.start, end: intervals[0]!.end };
  for (let i = 1; i < intervals.length; i++) {
    budget.recordWork(1);
    const iv = intervals[i]!;
    if (iv.start <= curr.end + TEXT_MERGE_TOLERANCE_PT) {
      curr.end = Math.max(curr.end, iv.end);
    } else {
      merged.push(curr);
      curr = { start: iv.start, end: iv.end };
    }
  }
  merged.push(curr);

  const voidIntervals: { start: number; end: number }[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    budget.recordWork(1);
    const vStart = merged[i]!.end;
    const vEnd = merged[i + 1]!.start;
    if (vEnd - vStart >= minGutterWidth) {
      voidIntervals.push({ start: vStart, end: vEnd });
    }
  }

  return {
    hasVoid: voidIntervals.length > 0,
    voidIntervals,
  };
}

// ============================================================================
// 10. MULTI-COLUMN REGION ASSIGNMENT & RECONSTRUCTION
// ============================================================================

export function reconstructMultiColumnLayout(
  validItems: PositionedPdfTextItem[],
  confirmedCorridors: CandidateCorridor[],
  reconstructColumnFn: (items: PositionedPdfTextItem[], budget: WorkBudget) => string,
  budget: WorkBudget
): string {
  // Sort confirmed corridors by start coordinate ascending
  const sortedCorrs = [...confirmedCorridors].sort((a, b) => a.start - b.start);

  // Compute page X bounds
  let minX = Infinity;
  let maxX = -Infinity;
  for (const it of validItems) {
    budget.recordWork(1);
    if (it.x < minX) minX = it.x;
    if (it.x + it.w > maxX) maxX = it.x + it.w;
  }

  // Define column boundaries
  // Column 0: [minX, Corr[0].start]
  // Column j: [Corr[j-1].end, Corr[j].start]
  // Column K: [Corr[K-1].end, maxX]
  const K = sortedCorrs.length;
  const colBounds: { left: number; right: number }[] = [];

  colBounds.push({ left: minX, right: sortedCorrs[0]!.start });
  for (let j = 1; j < K; j++) {
    colBounds.push({ left: sortedCorrs[j - 1]!.end, right: sortedCorrs[j]!.start });
  }
  colBounds.push({ left: sortedCorrs[K - 1]!.end, right: maxX });

  const columns: PositionedPdfTextItem[][] = colBounds.map(() => []);

  // Strict region assignment (No midpoint hack)
  const OVERHANG_TOL = 2.0;
  for (const it of validItems) {
    budget.recordWork(1);
    // Check for gutter intrusion
    for (const corr of sortedCorrs) {
      if (Math.max(it.x, corr.start) < Math.min(it.x + it.w, corr.end)) {
        throw new LayoutAmbiguityError(
          `Item "${it.str}" crosses confirmed gutter [${corr.start}, ${corr.end}]`
        );
      }
    }

    let assignedCol = -1;
    for (let c = 0; c < colBounds.length; c++) {
      const b = colBounds[c]!;
      if (it.x >= b.left - OVERHANG_TOL && it.x + it.w <= b.right + OVERHANG_TOL) {
        if (assignedCol !== -1) {
          throw new LayoutAmbiguityError(
            `Item "${it.str}" ambiguously spans multiple column boundaries`
          );
        }
        assignedCol = c;
      }
    }

    if (assignedCol === -1) {
      throw new LayoutAmbiguityError(
        `Item "${it.str}" cannot be assigned confidently to any column region`
      );
    }

    columns[assignedCol]!.push(it);
  }

  // Exact Item Identity Conservation Invariant Check
  let totalAssigned = 0;
  const assignedIds = new Set<number>();
  for (const col of columns) {
    totalAssigned += col.length;
    for (const it of col) {
      budget.recordWork(1);
      if (assignedIds.has(it.id)) {
        throw new LayoutAmbiguityError(`Duplicate item assignment detected (id: ${it.id})`);
      }
      assignedIds.add(it.id);
    }
  }

  if (totalAssigned !== validItems.length || assignedIds.size !== validItems.length) {
    throw new LayoutAmbiguityError(
      `Item conservation violated: assigned ${totalAssigned} items, expected ${validItems.length}`
    );
  }

  // Reconstruct each column independently using proven line bucketing logic
  const columnTexts: string[] = [];
  for (let c = 0; c < columns.length; c++) {
    const colItems = columns[c]!;
    if (colItems.length === 0) continue;
    const text = reconstructColumnFn(colItems, budget);
    if (text.trim().length > 0) {
      columnTexts.push(text.trim());
    }
  }

  // Output columns in left-to-right reading order
  return columnTexts.join("\n\n");
}

// ============================================================================
// 11. BOUNDED PAGE -> BANDS -> COLUMNS HIERARCHICAL XY-CUT DECOMPOSITION
// ============================================================================

interface VisualLine {
  y: number;
  height: number;
  items: PositionedPdfTextItem[];
  isFullWidth: boolean;
}

export function partitionPageIntoBands(
  validItems: PositionedPdfTextItem[],
  contentMinX: number,
  contentMaxX: number,
  minGutterWidth: number,
  budget: WorkBudget
): ContentBand[] {
  const contentWidth = contentMaxX - contentMinX;

  // Visual line bucketing based on baseline Y coordinates
  const lines: VisualLine[] = [];
  const sortedItems = [...validItems].sort((a, b) => {
    budget.recordWork(1);
    return b.y - a.y || a.x - b.x;
  });

  for (const item of sortedItems) {
    budget.recordWork(1);
    const tolerance = Math.max(2.5, item.h * 0.25);
    let matchedLine: VisualLine | null = null;

    // Pass 1: Standard baseline tolerance match
    for (const line of lines) {
      budget.recordWork(1);
      if (Math.abs(line.y - item.y) <= tolerance) {
        matchedLine = line;
        break;
      }
    }

    // Pass 2: Superscript / Subscript association
    if (!matchedLine) {
      for (const line of lines) {
        budget.recordWork(1);
        const isScript =
          item.h <= line.height * 0.85 &&
          ((item.y > line.y && item.y - line.y <= line.height * 0.7) ||
            (item.y < line.y && line.y - item.y <= line.height * 0.45)) &&
          line.items.some((it) => {
            budget.recordWork(1);
            return (
              Math.abs(item.x - (it.x + it.w)) <= line.height * 0.75 ||
              Math.abs(item.x - it.x) <= line.height * 0.75
            );
          });

        const isBaseOfScriptLine =
          line.items.every((it) => {
            budget.recordWork(1);
            return it.h <= item.h * 0.85;
          }) &&
          ((line.y > item.y && line.y - item.y <= item.h * 0.7) ||
            (line.y < item.y && item.y - line.y <= item.h * 0.45)) &&
          line.items.some((it) => {
            budget.recordWork(1);
            return (
              Math.abs(item.x - (it.x + it.w)) <= item.h * 0.75 ||
              Math.abs(item.x - it.x) <= item.h * 0.75 ||
              Math.abs(item.x + item.w - it.x) <= item.h * 0.75
            );
          });

        if (isScript) {
          matchedLine = line;
          break;
        } else if (isBaseOfScriptLine) {
          line.y = item.y;
          line.height = item.h;
          matchedLine = line;
          break;
        }
      }
    }

    if (matchedLine) {
      matchedLine.items.push(item);
      if (item.h > matchedLine.height) matchedLine.height = item.h;
    } else {
      lines.push({
        y: item.y,
        height: item.h,
        items: [item],
        isFullWidth: false,
      });
    }
  }

  const bodyHeight = computeBodyTextHeight(validItems);

  // Classify each line as full-width heading or body line
  for (let i = 0; i < lines.length; i++) {
    budget.recordWork(1);
    const line = lines[i]!;
    const textItems = line.items.filter((it) => it.w > 0 && it.str.trim().length > 0);
    if (textItems.length === 0) continue;

    let lineMinX = Infinity;
    let lineMaxX = -Infinity;
    for (const it of textItems) {
      budget.recordWork(1);
      if (it.x < lineMinX) lineMinX = it.x;
      if (it.x + it.w > lineMaxX) lineMaxX = it.x + it.w;
    }
    const lineWidth = lineMaxX - lineMinX;

    // Check if line has internal gaps >= minGutterWidth
    const intervals = textItems.map((it) => ({ start: it.x, end: it.x + it.w }));
    intervals.sort((a, b) => a.start - b.start);
    let hasInternalGutter = false;
    let mergedEnd = intervals[0]!.end;
    for (let j = 1; j < intervals.length; j++) {
      budget.recordWork(1);
      const iv = intervals[j]!;
      if (iv.start - mergedEnd >= minGutterWidth) {
        hasInternalGutter = true;
        break;
      }
      mergedEnd = Math.max(mergedEnd, iv.end);
    }

    // A line is full-width if it has no internal gutter AND spans widely across content width
    const spansWidth =
      contentWidth > 0 &&
      (lineWidth >= 0.65 * contentWidth ||
        (lineMinX <= contentMinX + 0.15 * contentWidth && lineMaxX >= contentMaxX - 0.15 * contentWidth));

    const hasFontProminence = line.height >= 1.15 * bodyHeight;

    // Measured vertical clearance
    const deltaBelow = i < lines.length - 1 ? line.y - lines[i + 1]!.y : 0;
    const deltaAbove = i > 0 ? lines[i - 1]!.y - line.y : 0;

    const hasClearance =
      i === 0
        ? deltaBelow >= 3.0 * bodyHeight
        : deltaAbove >= 3.0 * bodyHeight && deltaBelow >= 3.0 * bodyHeight;

    // Bottom-of-page lines without font prominence are strictly barred from heading status (prevents intrusive lines or quotes from splitting bands)
    const isBottomLine = i === lines.length - 1;
    const isHeading = !hasInternalGutter && spansWidth && (hasFontProminence || (hasClearance && !isBottomLine));

    line.isFullWidth = isHeading;
  }

  // Group lines into bands (Y-cuts)
  const bands: ContentBand[] = [];
  let currentBandItems: PositionedPdfTextItem[] = [];
  let currentBandIsFullWidth: boolean | null = null;

  function flushBand() {
    if (currentBandItems.length === 0) return;
    let yBottom = Infinity;
    let yTop = -Infinity;
    for (const it of currentBandItems) {
      budget.recordWork(1);
      if (it.y < yBottom) yBottom = it.y;
      if (it.y > yTop) yTop = it.y;
    }
    bands.push({
      index: bands.length,
      yBottom,
      yTop,
      type: currentBandIsFullWidth ? "FULL_WIDTH" : "SINGLE_COLUMN",
      items: currentBandItems,
      columns: [],
      gutters: [],
    });
    currentBandItems = [];
    currentBandIsFullWidth = null;
  }

  for (const line of lines) {
    budget.recordWork(1);
    if (currentBandIsFullWidth === null) {
      currentBandIsFullWidth = line.isFullWidth;
      currentBandItems.push(...line.items);
    } else if (currentBandIsFullWidth === line.isFullWidth) {
      currentBandItems.push(...line.items);
    } else {
      flushBand();
      currentBandIsFullWidth = line.isFullWidth;
      currentBandItems.push(...line.items);
    }
  }
  flushBand();

  return bands;
}

export function decomposeBandColumns(
  band: ContentBand,
  minGutterWidth: number,
  contentMinX: number,
  contentMaxX: number,
  pageBounds: { minX: number; minY: number; maxX: number; maxY: number },
  budget: WorkBudget
): void {
  // If the band was pre-classified as FULL_WIDTH: 1 column
  if (band.type === "FULL_WIDTH") {
    band.columns = [band.items];
    band.gutters = [];
    return;
  }

  // Check for vertical gutters in body band
  const projection = checkWholeBandProjectionVoid(band.items, budget, minGutterWidth);
  const slices = constructSlices(
    band.items,
    [pageBounds.minX, band.yBottom, pageBounds.maxX, band.yTop],
    budget
  );

  let hasSliceGaps = false;
  for (const s of slices) {
    const gaps = extractSliceGaps(s, budget);
    if (gaps.some((g) => g.end - g.start >= minGutterWidth)) {
      hasSliceGaps = true;
    }
  }

  // Safe single-column band: strictly zero horizontal projection void AND zero internal slice gaps
  if (!projection.hasVoid && !hasSliceGaps) {
    band.columns = [band.items];
    band.gutters = [];
    band.type = "SINGLE_COLUMN";
    return;
  }

  // Evidence of multiple columns exists (projection void or slice gaps)
  const confirmedCorridors = trackCorridorsAcrossSlices(
    slices,
    budget,
    projection.voidIntervals,
    minGutterWidth
  );

  if (confirmedCorridors.length > 0) {
    if (confirmedCorridors.length > MAX_COLUMNS_PER_BAND - 1) {
      throw new LayoutAmbiguityError(
        `Band exceeds maximum column budget (${confirmedCorridors.length + 1} > ${MAX_COLUMNS_PER_BAND})`
      );
    }

    const sortedCorrs = [...confirmedCorridors].sort((a, b) => a.start - b.start);
    const K = sortedCorrs.length;
    const colBounds: { left: number; right: number }[] = [];

    colBounds.push({ left: contentMinX, right: sortedCorrs[0]!.start });
    for (let j = 1; j < K; j++) {
      colBounds.push({ left: sortedCorrs[j - 1]!.end, right: sortedCorrs[j]!.start });
    }
    colBounds.push({ left: sortedCorrs[K - 1]!.end, right: contentMaxX });

    const columns: PositionedPdfTextItem[][] = colBounds.map(() => []);

    // Strict Region Assignment (NO Midpoint Hack)
    const OVERHANG_TOL = 2.0;
    for (const it of band.items) {
      budget.recordWork(1);
      // Gutter intrusion check
      for (const corr of sortedCorrs) {
        if (Math.max(it.x, corr.start) < Math.min(it.x + it.w, corr.end)) {
          throw new LayoutAmbiguityError(
            `Item "${it.str}" crosses confirmed gutter [${corr.start}, ${corr.end}]`
          );
        }
      }

      // Horizontal containment test
      let assignedCol = -1;
      for (let c = 0; c < colBounds.length; c++) {
        const b = colBounds[c]!;
        if (it.x >= b.left - OVERHANG_TOL && it.x + it.w <= b.right + OVERHANG_TOL) {
          if (assignedCol !== -1) {
            throw new LayoutAmbiguityError(
              `Item "${it.str}" ambiguously spans multiple column boundaries`
            );
          }
          assignedCol = c;
        }
      }

      if (assignedCol === -1) {
        throw new LayoutAmbiguityError(
          `Item "${it.str}" cannot be assigned confidently to any column region`
        );
      }

      columns[assignedCol]!.push(it);
    }

    band.columns = columns;
    band.gutters = sortedCorrs;
    band.type = "MULTI_COLUMN";
    return;
  }

  // Zero confirmed corridors despite multi-column evidence (void or slice gaps)
  throw new LayoutAmbiguityError(
    `Ambiguous layout: band has evidence of multiple columns (${
      projection.hasVoid ? "horizontal projection void" : "internal slice gaps"
    }) but failed corridor confirmation`
  );
}

export function reconstructPageLayout(
  validItems: PositionedPdfTextItem[],
  pageView: number[] | undefined,
  reconstructColumnFn: (items: PositionedPdfTextItem[], budget: WorkBudget) => string,
  budget: WorkBudget,
  pageRotate?: number
): string {
  // 1. Validate coordinate bounds against page view
  const bounds = getPageViewBounds(pageView, validItems, pageRotate);
  const BOUND_TOL = 2.0;

  for (const it of validItems) {
    budget.recordWork(1);
    if (!Number.isFinite(it.x) || !Number.isFinite(it.y) || !Number.isFinite(it.w) || !Number.isFinite(it.h)) {
      throw new LayoutAmbiguityError(`Non-finite item coordinates: [${it.x}, ${it.y}, ${it.w}, ${it.h}]`);
    }
    if (
      it.x < bounds.minX - BOUND_TOL ||
      it.x + it.w > bounds.maxX + BOUND_TOL ||
      it.y < bounds.minY - BOUND_TOL ||
      it.y > bounds.maxY + BOUND_TOL
    ) {
      throw new LayoutAmbiguityError(
        `Item "${it.str}" out of page bounds: x=[${it.x}, ${it.x + it.w}], y=${it.y}, bounds=[${bounds.minX}, ${bounds.minY}, ${bounds.maxX}, ${bounds.maxY}]`
      );
    }
  }

  // Verify 1:1 item identity conservation: no duplicate item IDs allowed
  const initialSeenIds = new Set<number>();
  for (const it of validItems) {
    budget.recordWork(1);
    if (initialSeenIds.has(it.id)) {
      throw new LayoutAmbiguityError(`Duplicate item assignment detected (id: ${it.id})`);
    }
    initialSeenIds.add(it.id);
  }

  // 2. Compute content dimensions and body text height
  let contentMinX = Infinity;
  let contentMaxX = -Infinity;
  for (const it of validItems) {
    budget.recordWork(1);
    if (it.w > 0 && it.str.trim().length > 0) {
      if (it.x < contentMinX) contentMinX = it.x;
      if (it.x + it.w > contentMaxX) contentMaxX = it.x + it.w;
    }
  }

  if (!Number.isFinite(contentMinX)) {
    return "";
  }

  const minGutterWidth = computeMinGutterWidth(validItems);

  // 3. Hierarchical Band Partitioning (Page -> Bands Y-cut)
  const bands = partitionPageIntoBands(validItems, contentMinX, contentMaxX, minGutterWidth, budget);
  if (bands.length > MAX_BANDS_PER_PAGE) {
    throw new LayoutAmbiguityError(
      `Page exceeds maximum band budget (${bands.length} > ${MAX_BANDS_PER_PAGE})`
    );
  }

  // 4. Column Decomposition within each Band (Bands -> Columns X-cut)
  let totalRegions = 0;
  for (const band of bands) {
    budget.recordWork(1);
    decomposeBandColumns(band, minGutterWidth, contentMinX, contentMaxX, bounds, budget);
    if (band.columns.length > MAX_COLUMNS_PER_BAND) {
      throw new LayoutAmbiguityError(
        `Band exceeds maximum column budget (${band.columns.length} > ${MAX_COLUMNS_PER_BAND})`
      );
    }
    totalRegions += band.columns.length;
  }

  if (totalRegions > MAX_REGIONS_PER_PAGE) {
    throw new LayoutAmbiguityError(
      `Page exceeds maximum region budget (${totalRegions} > ${MAX_REGIONS_PER_PAGE})`
    );
  }

  // If every band is SINGLE_COLUMN (no confirmed multi-column corridors exist anywhere),
  // unify under single-column engine for proper paragraph spacing.
  const hasMultiColumn = bands.some((b) => b.type === "MULTI_COLUMN");
  if (!hasMultiColumn) {
    return reconstructColumnFn(validItems, budget);
  }

  // 5. Exact Item Identity Conservation Invariant Across All Regions
  let totalAssigned = 0;
  const assignedIds = new Set<number>();
  for (const band of bands) {
    for (const col of band.columns) {
      totalAssigned += col.length;
      for (const it of col) {
        budget.recordWork(1);
        if (assignedIds.has(it.id)) {
          throw new LayoutAmbiguityError(`Duplicate item assignment detected (id: ${it.id})`);
        }
        assignedIds.add(it.id);
      }
    }
  }

  if (totalAssigned !== validItems.length || assignedIds.size !== validItems.length) {
    throw new LayoutAmbiguityError(
      `Item conservation violated: assigned ${totalAssigned} items, expected ${validItems.length}`
    );
  }

  // 6. Deterministic Reconstruction: Top-to-Bottom Bands, Left-to-Right Columns
  const bandTexts: string[] = [];
  for (const band of bands) {
    const colTexts: string[] = [];
    for (const col of band.columns) {
      if (col.length === 0) continue;
      const t = reconstructColumnFn(col, budget);
      if (t.trim().length > 0) {
        colTexts.push(t.trim());
      }
    }
    if (colTexts.length > 0) {
      bandTexts.push(colTexts.join("\n\n"));
    }
  }

  return bandTexts.join("\n\n");
}

/**
 * Safely reconstructs text in stream order for known single-column pages where
 * geometry is partially unavailable.
 * Preserves all items (zero loss) and reconstructs line and paragraph breaks
 * using PDF.js hasEOL markers and text stream formatting.
 */
export function reconstructSingleColumnStreamText(
  items: PositionedPdfTextItem[],
  budget?: WorkBudget
): string {
  if (items.length === 0) return "";

  const itemsWithGeom = items.filter((it) => it.hasValidGeometry);
  const bodyHeight = computeBodyTextHeight(itemsWithGeom);

  let result = "";
  for (let i = 0; i < items.length; i++) {
    budget?.recordWork(1);
    const it = items[i]!;
    const str = it.str;
    if (
      result.length > 0 &&
      !result.endsWith("\n") &&
      !result.endsWith(" ") &&
      !str.startsWith(" ") &&
      !str.startsWith("\n")
    ) {
      result += " ";
    }
    result += str;

    if (it.hasEOL) {
      // Find the last item with valid geometry up to index i
      let prevWithGeom: PositionedPdfTextItem | null = null;
      for (let j = i; j >= 0; j--) {
        if (items[j]!.hasValidGeometry) {
          prevWithGeom = items[j]!;
          break;
        }
      }

      // Find the next item with valid geometry after index i
      let nextWithGeom: PositionedPdfTextItem | null = null;
      for (let j = i + 1; j < items.length; j++) {
        if (items[j]!.hasValidGeometry) {
          nextWithGeom = items[j]!;
          break;
        }
      }

      if (prevWithGeom && nextWithGeom && prevWithGeom.y - nextWithGeom.y >= 1.75 * bodyHeight) {
        result += "\n\n";
      } else {
        result += "\n";
      }
    }
  }

  // Preserve paragraphs while cleaning multiple whitespace runs
  return result
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Evaluates whether geometry-missing items in a page stream have independent,
 * trustworthy provenance proving physical membership in a verified text run.
 *
 * Mandatory safety invariant (Phase 11.3.5B.1 Final Safety Closure):
 * Stream adjacency is NOT physical enclosure. In PDF content streams, operators
 * can execute in arbitrary order, meaning a geometry-missing item from an adjacent
 * column or separate region can appear between two geometrically valid items of the
 * same line in the stream. Anchor relationships (same baseline, gap < minGutterWidth)
 * establish relationships between the anchors, NOT the physical location of the missing item.
 *
 * Because raw PDF.js extraction data (`page.getTextContent()`) provides no trusted
 * structural provenance (e.g. Tagged PDF structure tree hierarchy or MCID markers),
 * caller-controlled matching strings cannot arbitrarily claim trusted provenance.
 *
 * Therefore, any multi-item page containing geometry-missing items must fail closed.
 */
export function verifyMissingGeometrySingleColumnSafety(
  items: PositionedPdfTextItem[],
  _minGutterWidth?: number
): boolean {
  // If there are no missing geometry items, layout is completely geometrically verifiable.
  if (items.every((it) => it.hasValidGeometry)) {
    return true;
  }

  // Trivial single-item page has no reading-order ambiguity
  if (items.length <= 1) {
    return true;
  }

  // Multi-item page with missing geometry: PDF.js extraction data provides no trustworthy
  // provenance proving physical run membership. Reject partial missing geometry.
  return false;
}

