/**
 * Phase 13 — Spaced-Repetition Scheduling Engine (FSRS-4.5)
 *
 * Implements the Free Spaced Repetition Scheduler v4.5 (DSR memory model:
 * Difficulty D, Stability S, Retrievability R) as a pure, deterministic,
 * side-effect-free module separated from database persistence.
 *
 * Technical Rationale for FSRS-4.5 over SM-2:
 * 1. `docs/ROADMAP.md` §4 & §6 (Task 13-01) explicitly specify calculating
 *    "stability, difficulty, interval, and next due date". Memory stability S
 *    (days for recall probability to decay from 100% to 90%) and item
 *    difficulty D in [1, 10] are the foundational state variables of FSRS-4.5.
 * 2. FSRS-4.5 models actual elapsed time `t` and retrievability
 *    `R(t, S) = (1 + (19/81) * (t / S))^-0.5`, handling early and overdue
 *    reviews gracefully without SM-2's rigid ease-factor penalty loop.
 */

export const FSRS_ALGORITHM_VERSION = "fsrs-4.5" as const;

/**
 * Standard published FSRS-4.5 default parameter weights (w[0] .. w[16]):
 * - w[0..3]: Initial stability S_0(G) for ratings AGAIN (1), HARD (2), GOOD (3), EASY (4)
 * - w[4]:    Initial difficulty D_0(3) for GOOD rating
 * - w[5]:    Initial difficulty slope across ratings
 * - w[6]:    Difficulty delta factor on subsequent reviews
 * - w[7]:    Mean-reversion weight toward D_0(3)
 * - w[8]:    Recall stability growth exponent
 * - w[9]:    Recall stability saturation power (S^-w[9])
 * - w[10]:   Retrievability gain factor (exp(w[10] * (1 - R)) - 1)
 * - w[11]:   Post-lapse stability base coefficient
 * - w[12]:   Post-lapse difficulty sensitivity power (D^-w[12])
 * - w[13]:   Post-lapse prior stability power ((S + 1)^w[13] - 1)
 * - w[14]:   Post-lapse retrievability sensitivity (exp(w[14] * (1 - R)))
 * - w[15]:   HARD recall stability penalty multiplier (< 1)
 * - w[16]:   EASY recall stability bonus multiplier (> 1)
 */
export const FSRS_DEFAULT_WEIGHTS: readonly number[] = Object.freeze([
  0.4,  // w0: initial stability for AGAIN
  0.6,  // w1: initial stability for HARD
  2.4,  // w2: initial stability for GOOD
  5.8,  // w3: initial stability for EASY
  4.93, // w4: initial difficulty for GOOD
  0.94, // w5: initial difficulty rating step
  0.86, // w6: difficulty update step
  0.01, // w7: difficulty mean reversion weight
  1.49, // w8: stability recall base exponent
  0.14, // w9: stability damping exponent
  0.94, // w10: stability retrievability exponent
  2.18, // w11: post-lapse stability base
  0.05, // w12: post-lapse difficulty exponent
  0.34, // w13: post-lapse stability exponent
  1.26, // w14: post-lapse retrievability exponent
  0.29, // w15: HARD penalty
  2.61, // w16: EASY bonus
]);

export const FSRS_DEFAULT_RETENTION = 0.9;
export const FSRS_DECAY = -0.5;
export const FSRS_FACTOR = 19 / 81; // (0.9^(-1 / -0.5) - 1) = 100/81 - 1 = 19/81

export const FSRS_MIN_STABILITY = 0.1;
export const FSRS_MAX_STABILITY = 36500;
export const FSRS_MIN_DIFFICULTY = 1.0;
export const FSRS_MAX_DIFFICULTY = 10.0;
export const FSRS_MAX_INTERVAL_DAYS = 36500;

/** Intra-day step in minutes when a card is rated AGAIN in NEW/LEARNING/REVIEW/RELEARNING. */
export const FSRS_INTRADAY_LEARNING_MINUTES = 10;

/** Default window (ms) within which an identical rapid repeat click without a new idempotencyKey is flagged. */
export const DEFAULT_DUPLICATE_SUBMISSION_WINDOW_MS = 2_000;

export const REVIEW_RATINGS = ["AGAIN", "HARD", "GOOD", "EASY"] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

export const CARD_LEARNING_STATES = [
  "NEW",
  "LEARNING",
  "REVIEW",
  "RELEARNING",
  "SUSPENDED",
] as const;
export type CardLearningState = (typeof CARD_LEARNING_STATES)[number];

export interface CardScheduleState {
  state: CardLearningState;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  dueAt: Date | null;
  lastReviewedAt: Date | null;
  algorithmVersion: string;
}

export interface SchedulingResult {
  rating: ReviewRating;
  wasCorrect: boolean;
  selfRating: "EASY" | "MEDIUM" | "HARD";
  stateBefore: CardLearningState;
  state: CardLearningState;
  stability: number;
  difficulty: number;
  retrievability: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  dueAt: Date;
  reviewedAt: Date;
  algorithmVersion: string;
}

export interface IntervalPreview {
  rating: ReviewRating;
  state: CardLearningState;
  scheduledDays: number;
  dueAt: Date;
  label: string;
}

export interface PersistedReviewRecord {
  id?: string;
  wasCorrect: boolean;
  selfRating?: "EASY" | "MEDIUM" | "HARD" | string | null;
  rating?: ReviewRating | string | null;
  stateBefore?: CardLearningState | string | null;
  state?: CardLearningState | string | null;
  stability?: number | null;
  difficulty?: number | null;
  elapsedDays?: number | null;
  scheduledDays?: number | null;
  reps?: number | null;
  lapses?: number | null;
  dueAt?: Date | string | null;
  algorithmVersion?: string | null;
  idempotencyKey?: string | null;
  reviewedAt: Date | string;
}

export class CardSuspendedError extends Error {
  constructor(message = "Cannot record a review for a suspended card. Unsuspend the card first.") {
    super(message);
    this.name = "CardSuspendedError";
  }
}

export class CardNotSuspendedError extends Error {
  constructor(message = "Card is not suspended.") {
    super(message);
    this.name = "CardNotSuspendedError";
  }
}

export class InvalidScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScheduleInputError";
  }
}

// ============================================================================
// Validation & Rating Helpers
// ============================================================================

export function isValidReviewRating(value: unknown): value is ReviewRating {
  return typeof value === "string" && (REVIEW_RATINGS as readonly string[]).includes(value);
}

export function isValidCardLearningState(value: unknown): value is CardLearningState {
  return typeof value === "string" && (CARD_LEARNING_STATES as readonly string[]).includes(value);
}

export function ratingToNumericGrade(rating: ReviewRating): 1 | 2 | 3 | 4 {
  switch (rating) {
    case "AGAIN":
      return 1;
    case "HARD":
      return 2;
    case "GOOD":
      return 3;
    case "EASY":
      return 4;
    default:
      throw new InvalidScheduleInputError(`Invalid review rating: ${String(rating)}`);
  }
}

export function ratingToWasCorrect(rating: ReviewRating): boolean {
  if (!isValidReviewRating(rating)) {
    throw new InvalidScheduleInputError(`Invalid review rating: ${String(rating)}`);
  }
  return rating !== "AGAIN";
}

export function wasCorrectToDefaultRating(wasCorrect: boolean): ReviewRating {
  return wasCorrect ? "GOOD" : "AGAIN";
}

export function ratingToSelfRatingDifficulty(rating: ReviewRating): "EASY" | "MEDIUM" | "HARD" {
  switch (rating) {
    case "AGAIN":
    case "HARD":
      return "HARD";
    case "GOOD":
      return "MEDIUM";
    case "EASY":
      return "EASY";
    default:
      throw new InvalidScheduleInputError(`Invalid review rating: ${String(rating)}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function assertValidDate(date: Date, label: string): void {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new InvalidScheduleInputError(`Invalid ${label} date supplied to scheduler.`);
  }
}

// ============================================================================
// Timezone & Calendar Day Utilities
// ============================================================================

/**
 * Validates an IANA timezone identifier via `Intl.DateTimeFormat`.
 * Falls back safely to `"UTC"` if empty or invalid.
 */
export function normalizeTimezone(timezone?: string | null): string {
  if (!timezone || typeof timezone !== "string" || timezone.trim().length === 0) {
    return "UTC";
  }
  const trimmed = timezone.trim();
  try {
    Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return "UTC";
  }
}

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  dateKey: string;
}

/**
 * Extracts calendar `{ year, month, day, dateKey }` ("YYYY-MM-DD") for a `Date`
 * in the specified user timezone.
 */
export function getZonedDateParts(date: Date, timezone?: string | null): ZonedDateParts {
  assertValidDate(date, "input");
  const tz = normalizeTimezone(timezone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? date.getUTCFullYear());
  const month = Number(parts.find((p) => p.type === "month")?.value ?? date.getUTCMonth() + 1);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? date.getUTCDate());
  const dateKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, dateKey };
}

/**
 * Computes the UTC instant corresponding to 00:00:00.000 on the user's local calendar day.
 */
export function startOfUserDay(date: Date, timezone?: string | null): Date {
  assertValidDate(date, "startOfUserDay");
  const tz = normalizeTimezone(timezone);
  const { year, month, day } = getZonedDateParts(date, tz);

  // Start from midnight UTC of that calendar date and adjust by the timezone's offset at that instant
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offsetMs = getTimezoneOffsetMs(new Date(utcGuess), tz);
  const candidate = new Date(utcGuess - offsetMs);
  // Second pass handles DST transition mornings accurately
  const refinedOffsetMs = getTimezoneOffsetMs(candidate, tz);
  return new Date(utcGuess - refinedOffsetMs);
}

/**
 * Computes the UTC instant corresponding to 23:59:59.999 on the user's local calendar day.
 */
export function endOfUserDay(date: Date, timezone?: string | null): Date {
  assertValidDate(date, "endOfUserDay");
  const tz = normalizeTimezone(timezone);
  const { year, month, day } = getZonedDateParts(date, tz);
  const nextDayUtcGuess = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0);
  const nextDayStart = startOfUserDay(new Date(nextDayUtcGuess), tz);
  return new Date(nextDayStart.getTime() - 1);
}

function getTimezoneOffsetMs(date: Date, tz: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? 1970);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 1);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 1);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const second = Number(parts.find((p) => p.type === "second")?.value ?? 0);

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, date.getUTCMilliseconds());
  return asUtc - date.getTime();
}

/**
 * Computes non-negative elapsed days between two timestamps.
 * Uses exact fractional days (`(to - from) / 86_400_000`) clamped to `>= 0`.
 */
export function computeElapsedDays(from: Date | null, to: Date): number {
  assertValidDate(to, "to");
  if (!from) return 0;
  assertValidDate(from, "from");
  const diffMs = to.getTime() - from.getTime();
  if (diffMs <= 0) return 0;
  return roundTo4(diffMs / 86_400_000);
}

/**
 * Computes integer calendar day difference in the user's timezone (`>= 0`).
 */
export function elapsedCalendarDays(from: Date, to: Date, timezone?: string | null): number {
  assertValidDate(from, "from");
  assertValidDate(to, "to");
  const pFrom = getZonedDateParts(from, timezone);
  const pTo = getZonedDateParts(to, timezone);
  const utcFrom = Date.UTC(pFrom.year, pFrom.month - 1, pFrom.day);
  const utcTo = Date.UTC(pTo.year, pTo.month - 1, pTo.day);
  return Math.max(0, Math.round((utcTo - utcFrom) / 86_400_000));
}

// ============================================================================
// Core FSRS-4.5 Equations
// ============================================================================

/**
 * Initial stability S_0(G) in days for a NEW card upon its first review.
 */
export function computeInitialStability(
  rating: ReviewRating,
  weights: readonly number[] = FSRS_DEFAULT_WEIGHTS
): number {
  const grade = ratingToNumericGrade(rating);
  const raw = weights[grade - 1] ?? FSRS_MIN_STABILITY;
  return roundTo4(clamp(raw, FSRS_MIN_STABILITY, FSRS_MAX_STABILITY));
}

/**
 * Initial difficulty D_0(G) in [1.0, 10.0] for a NEW card upon its first review:
 * D_0(G) = clamp(w4 - (G - 3) * w5, 1, 10)
 */
export function computeInitialDifficulty(
  rating: ReviewRating,
  weights: readonly number[] = FSRS_DEFAULT_WEIGHTS
): number {
  const grade = ratingToNumericGrade(rating);
  const w4 = weights[4] ?? 4.93;
  const w5 = weights[5] ?? 0.94;
  const raw = w4 - (grade - 3) * w5;
  return roundTo4(clamp(raw, FSRS_MIN_DIFFICULTY, FSRS_MAX_DIFFICULTY));
}

/**
 * Next difficulty D'(D, G) with linear damping and mean reversion toward D_0(3):
 *   delta_D = -w6 * (G - 3)
 *   D_prime = D + delta_D * ((10 - D) / 9)
 *   D_next  = clamp(w7 * D_0(3) + (1 - w7) * D_prime, 1, 10)
 */
export function computeNextDifficulty(
  currentDifficulty: number,
  rating: ReviewRating,
  weights: readonly number[] = FSRS_DEFAULT_WEIGHTS
): number {
  const grade = ratingToNumericGrade(rating);
  const d = clamp(currentDifficulty, FSRS_MIN_DIFFICULTY, FSRS_MAX_DIFFICULTY);
  const w4 = weights[4] ?? 4.93;
  const w6 = weights[6] ?? 0.86;
  const w7 = weights[7] ?? 0.01;

  const deltaD = -w6 * (grade - 3);
  const damped = d + deltaD * ((10 - d) / 9);
  const reverted = w7 * w4 + (1 - w7) * damped;
  return roundTo4(clamp(reverted, FSRS_MIN_DIFFICULTY, FSRS_MAX_DIFFICULTY));
}

/**
 * Power forgetting curve in FSRS-4.5:
 *   R(t, S) = (1 + (19/81) * (t / S))^-0.5
 * When t = 0, R = 1.0. When t = S, R = 0.9.
 */
export function computeRetrievability(elapsedDays: number, stability: number): number {
  if (elapsedDays <= 0) return 1.0;
  const s = Math.max(FSRS_MIN_STABILITY, stability);
  const r = Math.pow(1 + FSRS_FACTOR * (elapsedDays / s), FSRS_DECAY);
  return roundTo4(clamp(r, 0.0001, 1.0));
}

/**
 * Stability after successful recall S'_r(D, S, R, G) for G in {2 (HARD), 3 (GOOD), 4 (EASY)}:
 *   S'_r = S * (1 + exp(w8) * (11 - D) * S^(-w9) * (exp(w10 * (1 - R)) - 1) * hardPenalty * easyBonus)
 */
export function computeStabilityAfterRecall(
  difficulty: number,
  stability: number,
  retrievability: number,
  rating: Exclude<ReviewRating, "AGAIN">,
  weights: readonly number[] = FSRS_DEFAULT_WEIGHTS
): number {
  const d = clamp(difficulty, FSRS_MIN_DIFFICULTY, FSRS_MAX_DIFFICULTY);
  const s = clamp(stability, FSRS_MIN_STABILITY, FSRS_MAX_STABILITY);
  const r = clamp(retrievability, 0.0001, 1.0);

  const w8 = weights[8] ?? 1.49;
  const w9 = weights[9] ?? 0.14;
  const w10 = weights[10] ?? 0.94;
  const w15 = weights[15] ?? 0.29;
  const w16 = weights[16] ?? 2.61;

  const hardPenalty = rating === "HARD" ? w15 : 1.0;
  const easyBonus = rating === "EASY" ? w16 : 1.0;

  // Ensure even same-day reviews (where R == 1.0) provide a small deterministic stability gain for GOOD/EASY
  const effectiveOneMinusR = Math.max(1 - r, 0.02);

  const growth =
    Math.exp(w8) *
    (11 - d) *
    Math.pow(s, -w9) *
    (Math.exp(w10 * effectiveOneMinusR) - 1) *
    hardPenalty *
    easyBonus;

  const nextS = s * (1 + Math.max(0, growth));
  return roundTo4(clamp(nextS, FSRS_MIN_STABILITY, FSRS_MAX_STABILITY));
}

/**
 * Stability after forgetting / lapse S'_f(D, S, R) when rated AGAIN (G = 1):
 *   S'_f = min(S, w11 * D^(-w12) * ((S + 1)^w13 - 1) * exp(w14 * (1 - R)))
 */
export function computeStabilityAfterLapse(
  difficulty: number,
  stability: number,
  retrievability: number,
  weights: readonly number[] = FSRS_DEFAULT_WEIGHTS
): number {
  const d = clamp(difficulty, FSRS_MIN_DIFFICULTY, FSRS_MAX_DIFFICULTY);
  const s = clamp(stability, FSRS_MIN_STABILITY, FSRS_MAX_STABILITY);
  const r = clamp(retrievability, 0.0001, 1.0);

  const w11 = weights[11] ?? 2.18;
  const w12 = weights[12] ?? 0.05;
  const w13 = weights[13] ?? 0.34;
  const w14 = weights[14] ?? 1.26;

  const raw =
    w11 *
    Math.pow(d, -w12) *
    (Math.pow(s + 1, w13) - 1) *
    Math.exp(w14 * (1 - r));

  return roundTo4(clamp(Math.min(s, raw), FSRS_MIN_STABILITY, FSRS_MAX_STABILITY));
}

/**
 * Converts stability S (days) into an integer day interval for target retention `r`:
 *   I(S, r) = clamp(round((S / FACTOR) * (r^(1 / DECAY) - 1)), 1, maxInterval)
 */
export function computeIntervalDays(
  stability: number,
  requestRetention: number = FSRS_DEFAULT_RETENTION,
  maxInterval: number = FSRS_MAX_INTERVAL_DAYS
): number {
  const s = clamp(stability, FSRS_MIN_STABILITY, FSRS_MAX_STABILITY);
  const r = clamp(requestRetention, 0.7, 0.99);
  const multiplier = (Math.pow(r, 1 / FSRS_DECAY) - 1) / FSRS_FACTOR;
  const rawDays = Math.round(s * multiplier);
  return clamp(rawDays, 1, maxInterval);
}

// ============================================================================
// Card State Construction & Hydration
// ============================================================================

export function createInitialCardState(): CardScheduleState {
  return {
    state: "NEW",
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: null,
    lastReviewedAt: null,
    algorithmVersion: FSRS_ALGORITHM_VERSION,
  };
}

/**
 * Hydrates a complete `CardScheduleState` from a persisted `FlashcardReview` row
 * (including legacy Phase 8.6 rows where only `wasCorrect` and `reviewedAt` exist)
 * or returns `createInitialCardState()` when `review` is null/undefined.
 */
export function deriveCardStateFromReview(
  review: PersistedReviewRecord | null | undefined
): CardScheduleState {
  if (!review) {
    return createInitialCardState();
  }

  const reviewedAt =
    review.reviewedAt instanceof Date ? review.reviewedAt : new Date(review.reviewedAt);

  // If the review row carries full Phase 13 FSRS-4.5 parameters, use them directly.
  // Suspended and NEW cards legally store `dueAt: null`, so handle them directly here
  // instead of falling through to legacy GOOD-grade hydration.
  if (
    review.state &&
    isValidCardLearningState(review.state) &&
    typeof review.stability === "number" &&
    typeof review.difficulty === "number" &&
    review.dueAt !== undefined &&
    (review.dueAt !== null || review.state === "SUSPENDED" || review.state === "NEW")
  ) {
    const dueAt =
      review.dueAt !== null
        ? review.dueAt instanceof Date
          ? review.dueAt
          : new Date(review.dueAt)
        : null;
    const isNullDueState = review.state === "SUSPENDED" || review.state === "NEW";
    return {
      state: review.state,
      stability: review.stability,
      difficulty: review.difficulty,
      elapsedDays: typeof review.elapsedDays === "number" ? review.elapsedDays : 0,
      scheduledDays: typeof review.scheduledDays === "number" ? review.scheduledDays : 0,
      reps: isNullDueState
        ? typeof review.reps === "number" && review.reps >= 0
          ? review.reps
          : 0
        : typeof review.reps === "number" && review.reps > 0
          ? review.reps
          : 1,
      lapses: typeof review.lapses === "number" && review.lapses >= 0 ? review.lapses : 0,
      dueAt,
      lastReviewedAt: reviewedAt,
      algorithmVersion: review.algorithmVersion || FSRS_ALGORITHM_VERSION,
    };
  }

  // Fallback for legacy Phase 8.6 review rows (only `wasCorrect` and `reviewedAt` populated):
  // deterministically compute initial FSRS-4.5 state as of `reviewedAt`.
  const inferredRating: ReviewRating =
    review.rating && isValidReviewRating(review.rating)
      ? review.rating
      : wasCorrectToDefaultRating(review.wasCorrect);

  const scheduled = scheduleNextReview(createInitialCardState(), inferredRating, reviewedAt);
  return {
    state: review.state && isValidCardLearningState(review.state) ? review.state : scheduled.state,
    stability: scheduled.stability,
    difficulty: scheduled.difficulty,
    elapsedDays: scheduled.elapsedDays,
    scheduledDays: scheduled.scheduledDays,
    reps: typeof review.reps === "number" && review.reps > 0 ? review.reps : 1,
    lapses: typeof review.lapses === "number" ? review.lapses : 0,
    dueAt:
      review.dueAt !== undefined && review.dueAt !== null
        ? review.dueAt instanceof Date
          ? review.dueAt
          : new Date(review.dueAt)
        : scheduled.dueAt,
    lastReviewedAt: reviewedAt,
    algorithmVersion: review.algorithmVersion || FSRS_ALGORITHM_VERSION,
  };
}

// ============================================================================
// Core State Transition Function
// ============================================================================

export interface ScheduleOptions {
  timezone?: string | null;
  weights?: readonly number[];
  requestRetention?: number;
}

/**
 * Computes the next FSRS-4.5 scheduling state given the current card state,
 * the learner's rating (`AGAIN | HARD | GOOD | EASY`), and the review timestamp.
 *
 * State Machine Transitions:
 * - `SUSPENDED`: Throws `CardSuspendedError` (suspended cards must be unsuspended before reviewing).
 * - `NEW`:
 *   - `AGAIN` -> `LEARNING` (scheduledDays = 0, due in 10 minutes)
 *   - `HARD`  -> `LEARNING` (scheduledDays = 1, due in 1 day)
 *   - `GOOD`  -> `REVIEW`   (scheduledDays = I(S_0(GOOD)) = 2 days)
 *   - `EASY`  -> `REVIEW`   (scheduledDays = max(I(S_0(EASY)), I(S_0(GOOD)) + 1) = 6 days)
 * - `LEARNING` / `RELEARNING`:
 *   - `AGAIN` -> stays in `LEARNING` / `RELEARNING` (scheduledDays = 0, due in 10 minutes)
 *   - `HARD`  -> stays in `LEARNING` / `RELEARNING` (scheduledDays = 1, due in 1 day)
 *   - `GOOD`  -> graduates to `REVIEW` (scheduledDays = max(1, I(S')))
 *   - `EASY`  -> graduates to `REVIEW` (scheduledDays = max(2, I(S')))
 * - `REVIEW`:
 *   - `AGAIN` -> `RELEARNING` (lapses += 1, stability reduced to S'_f, scheduledDays = 0, due in 10 minutes)
 *   - `HARD`  -> `REVIEW` (scheduledDays = max(1, I(S'_r(HARD))))
 *   - `GOOD`  -> `REVIEW` (scheduledDays = max(I_hard + 1, I(S'_r(GOOD))))
 *   - `EASY`  -> `REVIEW` (scheduledDays = max(I_good + 1, I(S'_r(EASY))))
 */
export function scheduleNextReview(
  current: CardScheduleState,
  rating: ReviewRating,
  now: Date = new Date(),
  options?: ScheduleOptions
): SchedulingResult {
  if (!isValidReviewRating(rating)) {
    throw new InvalidScheduleInputError(`Invalid review rating: ${String(rating)}`);
  }
  assertValidDate(now, "now");

  if (!current || !isValidCardLearningState(current.state)) {
    throw new InvalidScheduleInputError("Invalid current card learning state.");
  }

  if (current.state === "SUSPENDED") {
    throw new CardSuspendedError();
  }

  const weights = options?.weights ?? FSRS_DEFAULT_WEIGHTS;
  const retention = options?.requestRetention ?? FSRS_DEFAULT_RETENTION;
  const stateBefore = current.state;
  const elapsedDays =
    stateBefore === "NEW" ? 0 : computeElapsedDays(current.lastReviewedAt, now);

  let nextState: CardLearningState;
  let nextStability: number;
  let nextDifficulty: number;
  let retrievability: number;
  let scheduledDays: number;
  const reps = Math.max(0, current.reps) + 1;
  let lapses = Math.max(0, current.lapses);

  if (stateBefore === "NEW" || current.reps <= 0 || current.stability <= 0) {
    retrievability = 1.0;
    nextStability = computeInitialStability(rating, weights);
    nextDifficulty = computeInitialDifficulty(rating, weights);

    if (rating === "AGAIN") {
      nextState = "LEARNING";
      scheduledDays = 0;
    } else if (rating === "HARD") {
      nextState = "LEARNING";
      scheduledDays = 1;
    } else if (rating === "GOOD") {
      nextState = "REVIEW";
      scheduledDays = Math.max(1, computeIntervalDays(nextStability, retention));
    } else {
      // EASY
      nextState = "REVIEW";
      const goodDays = Math.max(1, computeIntervalDays(computeInitialStability("GOOD", weights), retention));
      scheduledDays = Math.max(goodDays + 1, computeIntervalDays(nextStability, retention));
    }
  } else if (stateBefore === "LEARNING" || stateBefore === "RELEARNING") {
    retrievability = computeRetrievability(elapsedDays, current.stability);
    nextDifficulty = computeNextDifficulty(current.difficulty, rating, weights);

    if (rating === "AGAIN") {
      nextState = stateBefore;
      nextStability = computeStabilityAfterLapse(
        nextDifficulty,
        current.stability,
        retrievability,
        weights
      );
      scheduledDays = 0;
    } else if (rating === "HARD") {
      nextState = stateBefore;
      nextStability = computeStabilityAfterRecall(
        nextDifficulty,
        current.stability,
        retrievability,
        "HARD",
        weights
      );
      scheduledDays = 1;
    } else if (rating === "GOOD") {
      nextState = "REVIEW";
      nextStability = computeStabilityAfterRecall(
        nextDifficulty,
        current.stability,
        retrievability,
        "GOOD",
        weights
      );
      scheduledDays = Math.max(1, computeIntervalDays(nextStability, retention));
    } else {
      // EASY
      nextState = "REVIEW";
      nextStability = computeStabilityAfterRecall(
        nextDifficulty,
        current.stability,
        retrievability,
        "EASY",
        weights
      );
      const goodStability = computeStabilityAfterRecall(
        nextDifficulty,
        current.stability,
        retrievability,
        "GOOD",
        weights
      );
      const goodDays = Math.max(1, computeIntervalDays(goodStability, retention));
      scheduledDays = Math.max(goodDays + 1, computeIntervalDays(nextStability, retention));
    }
  } else {
    // stateBefore === "REVIEW"
    retrievability = computeRetrievability(elapsedDays, current.stability);
    nextDifficulty = computeNextDifficulty(current.difficulty, rating, weights);

    if (rating === "AGAIN") {
      nextState = "RELEARNING";
      lapses += 1;
      nextStability = computeStabilityAfterLapse(
        nextDifficulty,
        current.stability,
        retrievability,
        weights
      );
      scheduledDays = 0;
    } else {
      nextState = "REVIEW";
      const sHard = computeStabilityAfterRecall(
        nextDifficulty,
        current.stability,
        retrievability,
        "HARD",
        weights
      );
      const sGood = computeStabilityAfterRecall(
        nextDifficulty,
        current.stability,
        retrievability,
        "GOOD",
        weights
      );
      const sEasy = computeStabilityAfterRecall(
        nextDifficulty,
        current.stability,
        retrievability,
        "EASY",
        weights
      );

      const iHard = Math.max(1, computeIntervalDays(sHard, retention));
      const iGood = Math.max(iHard + 1, computeIntervalDays(sGood, retention));
      const iEasy = Math.max(iGood + 1, computeIntervalDays(sEasy, retention));

      if (rating === "HARD") {
        nextStability = sHard;
        scheduledDays = iHard;
      } else if (rating === "GOOD") {
        nextStability = sGood;
        scheduledDays = iGood;
      } else {
        nextStability = sEasy;
        scheduledDays = iEasy;
      }
    }
  }

  const dueAt =
    scheduledDays === 0
      ? new Date(now.getTime() + FSRS_INTRADAY_LEARNING_MINUTES * 60_000)
      : new Date(now.getTime() + scheduledDays * 86_400_000);

  return {
    rating,
    wasCorrect: ratingToWasCorrect(rating),
    selfRating: ratingToSelfRatingDifficulty(rating),
    stateBefore,
    state: nextState,
    stability: nextStability,
    difficulty: nextDifficulty,
    retrievability,
    elapsedDays,
    scheduledDays,
    reps,
    lapses,
    dueAt,
    reviewedAt: now,
    algorithmVersion: FSRS_ALGORITHM_VERSION,
  };
}

// ============================================================================
// Suspend / Unsuspend Transitions
// ============================================================================

export function suspendCardState(current: CardScheduleState, now: Date = new Date()): CardScheduleState {
  assertValidDate(now, "now");
  return {
    ...current,
    state: "SUSPENDED",
    lastReviewedAt: current.lastReviewedAt ?? now,
    algorithmVersion: FSRS_ALGORITHM_VERSION,
  };
}

export function unsuspendCardState(
  current: CardScheduleState,
  now: Date = new Date(),
  priorNonSuspendedState?: CardLearningState | null
): CardScheduleState {
  assertValidDate(now, "now");
  if (current.state !== "SUSPENDED") {
    return current;
  }
  const restoredState: CardLearningState =
    priorNonSuspendedState &&
    priorNonSuspendedState !== "SUSPENDED" &&
    priorNonSuspendedState !== "NEW"
      ? priorNonSuspendedState
      : current.reps > 0 && current.stability > 0
        ? current.scheduledDays === 0
          ? "LEARNING"
          : "REVIEW"
        : "NEW";

  return {
    ...current,
    state: restoredState,
    dueAt: restoredState === "NEW" ? null : current.dueAt ?? now,
    algorithmVersion: FSRS_ALGORITHM_VERSION,
  };
}

// ============================================================================
// Due-Date Evaluation & Interval Previews
// ============================================================================

/**
 * Determines whether a card is due for review as of `now`.
 * - `SUSPENDED` cards are never due in automatic queues.
 * - `NEW` cards (`dueAt === null`) are not counted as "due reviews" (they are tracked in `newCount`),
 *   though they are eligible to be introduced in a study session.
 * - `LEARNING` / `RELEARNING` / `REVIEW` cards are due when `dueAt <= cutoff`, where `cutoff` is
 *   `endOfUserDay(now, timezone)` by default for day-scheduled reviews (`scheduledDays >= 1`) or
 *   `now` when `includeEndOfDay === false`.
 */
export function isCardDue(
  cardState: Pick<CardScheduleState, "state" | "dueAt" | "scheduledDays">,
  now: Date = new Date(),
  options?: { timezone?: string | null; includeEndOfDay?: boolean }
): boolean {
  assertValidDate(now, "now");
  if (cardState.state === "SUSPENDED" || cardState.state === "NEW") {
    return false;
  }
  if (!cardState.dueAt) {
    return true;
  }
  const dueTime = cardState.dueAt.getTime();
  if (dueTime <= now.getTime()) {
    return true;
  }
  const includeEndOfDay = options?.includeEndOfDay ?? true;
  if (includeEndOfDay && (cardState.scheduledDays ?? 0) >= 1) {
    const dayEnd = endOfUserDay(now, options?.timezone).getTime();
    return dueTime <= dayEnd;
  }
  return false;
}

/**
 * Determines whether a card is strictly overdue from a previous calendar day in the user's timezone.
 */
export function isCardOverdue(
  cardState: Pick<CardScheduleState, "state" | "dueAt">,
  now: Date = new Date(),
  timezone?: string | null
): boolean {
  assertValidDate(now, "now");
  if (cardState.state === "SUSPENDED" || cardState.state === "NEW" || !cardState.dueAt) {
    return false;
  }
  const dayStart = startOfUserDay(now, timezone).getTime();
  return cardState.dueAt.getTime() < dayStart;
}

/**
 * Formats a human-readable interval label for rating buttons (e.g., "<10m", "1d", "6d", "1.5mo", "1.2y").
 */
export function formatIntervalLabel(scheduledDays: number): string {
  if (scheduledDays <= 0) {
    return `<${FSRS_INTRADAY_LEARNING_MINUTES}m`;
  }
  if (scheduledDays < 30) {
    return `${scheduledDays}d`;
  }
  if (scheduledDays < 365) {
    const months = Math.round((scheduledDays / 30) * 10) / 10;
    return `${months}mo`;
  }
  const years = Math.round((scheduledDays / 365) * 10) / 10;
  return `${years}y`;
}

/**
 * Previews the next state, interval, due date, and UI label for all 4 ratings (`AGAIN`, `HARD`, `GOOD`, `EASY`).
 */
export function previewSchedulingOptions(
  current: CardScheduleState,
  now: Date = new Date(),
  options?: ScheduleOptions
): Record<ReviewRating, IntervalPreview> {
  const effectiveCurrent =
    current.state === "SUSPENDED" ? unsuspendCardState(current, now) : current;

  const result = {} as Record<ReviewRating, IntervalPreview>;
  for (const rating of REVIEW_RATINGS) {
    const scheduled = scheduleNextReview(effectiveCurrent, rating, now, options);
    result[rating] = {
      rating,
      state: scheduled.state,
      scheduledDays: scheduled.scheduledDays,
      dueAt: scheduled.dueAt,
      label: formatIntervalLabel(scheduled.scheduledDays),
    };
  }
  return result;
}

// ============================================================================
// Duplicate Submission & Idempotency Guard
// ============================================================================

/**
 * Detects whether an incoming review submission is a duplicate of the most recent persisted review:
 * 1. Explicit match on non-empty `idempotencyKey`.
 * 2. Rapid duplicate submission within `dedupWindowMs` (default 2,000ms) with the identical rating.
 */
export function isDuplicateSubmission(
  latestReview: PersistedReviewRecord | null | undefined,
  incoming: {
    rating: ReviewRating;
    idempotencyKey?: string | null;
    now?: Date;
    dedupWindowMs?: number;
  }
): boolean {
  if (!latestReview) return false;

  if (
    incoming.idempotencyKey &&
    latestReview.idempotencyKey &&
    incoming.idempotencyKey === latestReview.idempotencyKey
  ) {
    return true;
  }

  const now = incoming.now ?? new Date();
  const windowMs = incoming.dedupWindowMs ?? DEFAULT_DUPLICATE_SUBMISSION_WINDOW_MS;
  if (windowMs <= 0) return false;

  const latestReviewedAt =
    latestReview.reviewedAt instanceof Date
      ? latestReview.reviewedAt
      : new Date(latestReview.reviewedAt);

  const elapsedMs = now.getTime() - latestReviewedAt.getTime();
  if (elapsedMs >= 0 && elapsedMs <= windowMs) {
    const latestRating =
      latestReview.rating ?? wasCorrectToDefaultRating(latestReview.wasCorrect);
    if (latestRating === incoming.rating) {
      return true;
    }
  }

  return false;
}
