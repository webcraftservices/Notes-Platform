import { describe, expect, it } from "vitest";
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_DEFAULT_WEIGHTS,
  CardSuspendedError,
  InvalidScheduleInputError,
  createInitialCardState,
  computeInitialStability,
  computeInitialDifficulty,
  computeNextDifficulty,
  computeRetrievability,
  computeStabilityAfterRecall,
  computeStabilityAfterLapse,
  computeIntervalDays,
  scheduleNextReview,
  suspendCardState,
  unsuspendCardState,
  deriveCardStateFromReview,
  isCardDue,
  isCardOverdue,
  previewSchedulingOptions,
  formatIntervalLabel,
  isDuplicateSubmission,
  normalizeTimezone,
  getZonedDateParts,
  startOfUserDay,
  endOfUserDay,
  elapsedCalendarDays,
  isValidReviewRating,
  ratingToNumericGrade,
  ratingToWasCorrect,
  wasCorrectToDefaultRating,
} from "../fsrs";

describe("Phase 13 — FSRS-4.5 Spaced Repetition Scheduling Engine", () => {
  const baseTime = new Date("2026-11-11T10:00:00.000Z");

  // =========================================================================
  // Suite 1: Rating Validation & Conversion
  // =========================================================================
  describe("Suite 1: Rating Validation & Conversion", () => {
    it("1.1 validates only canonical ReviewRating values", () => {
      expect(isValidReviewRating("AGAIN")).toBe(true);
      expect(isValidReviewRating("HARD")).toBe(true);
      expect(isValidReviewRating("GOOD")).toBe(true);
      expect(isValidReviewRating("EASY")).toBe(true);
      expect(isValidReviewRating("good")).toBe(false);
      expect(isValidReviewRating("")).toBe(false);
      expect(isValidReviewRating(null)).toBe(false);
      expect(isValidReviewRating(3)).toBe(false);
    });

    it("1.2 maps ratings to numeric grades 1..4 and boolean correctness", () => {
      expect(ratingToNumericGrade("AGAIN")).toBe(1);
      expect(ratingToNumericGrade("HARD")).toBe(2);
      expect(ratingToNumericGrade("GOOD")).toBe(3);
      expect(ratingToNumericGrade("EASY")).toBe(4);

      expect(ratingToWasCorrect("AGAIN")).toBe(false);
      expect(ratingToWasCorrect("HARD")).toBe(true);
      expect(ratingToWasCorrect("GOOD")).toBe(true);
      expect(ratingToWasCorrect("EASY")).toBe(true);

      expect(wasCorrectToDefaultRating(true)).toBe("GOOD");
      expect(wasCorrectToDefaultRating(false)).toBe("AGAIN");
    });

    it("1.3 throws InvalidScheduleInputError on invalid rating or date inputs", () => {
      const initial = createInitialCardState();
      // @ts-expect-error testing runtime invalid rating
      expect(() => scheduleNextReview(initial, "INVALID", baseTime)).toThrow(
        InvalidScheduleInputError
      );
      expect(() => scheduleNextReview(initial, "GOOD", new Date("invalid"))).toThrow(
        InvalidScheduleInputError
      );
    });
  });

  // =========================================================================
  // Suite 2: FSRS-4.5 Core Mathematical Formulas
  // =========================================================================
  describe("Suite 2: FSRS-4.5 Core Mathematical Formulas", () => {
    it("2.1 computes initial stability S_0(G) from w[0..3]", () => {
      expect(computeInitialStability("AGAIN")).toBe(0.4);
      expect(computeInitialStability("HARD")).toBe(0.6);
      expect(computeInitialStability("GOOD")).toBe(2.4);
      expect(computeInitialStability("EASY")).toBe(5.8);
    });

    it("2.2 computes initial difficulty D_0(G) monotonically decreasing from AGAIN to EASY", () => {
      const dAgain = computeInitialDifficulty("AGAIN");
      const dHard = computeInitialDifficulty("HARD");
      const dGood = computeInitialDifficulty("GOOD");
      const dEasy = computeInitialDifficulty("EASY");

      expect(dAgain).toBeGreaterThan(dHard);
      expect(dHard).toBeGreaterThan(dGood);
      expect(dGood).toBeGreaterThan(dEasy);
      expect(dGood).toBeCloseTo(FSRS_DEFAULT_WEIGHTS[4]!, 4);
    });

    it("2.3 clamps difficulty strictly within [1.0, 10.0] across 50 extreme ratings", () => {
      let dHigh = 5.0;
      let dLow = 5.0;
      for (let i = 0; i < 50; i++) {
        dHigh = computeNextDifficulty(dHigh, "AGAIN");
        dLow = computeNextDifficulty(dLow, "EASY");
      }
      expect(dHigh).toBeLessThanOrEqual(10.0);
      expect(dHigh).toBeGreaterThanOrEqual(1.0);
      expect(dLow).toBeGreaterThanOrEqual(1.0);
      expect(dLow).toBeLessThanOrEqual(10.0);
    });

    it("2.4 computes power forgetting curve retrievability R(t, S) with R(0, S)=1.0 and R(S, S)=0.9", () => {
      expect(computeRetrievability(0, 10)).toBe(1.0);
      expect(computeRetrievability(10, 10)).toBeCloseTo(0.9, 4);
      expect(computeRetrievability(30, 10)).toBeLessThan(0.9);
      expect(computeRetrievability(30, 10)).toBeGreaterThan(0);
    });

    it("2.5 orders post-recall stability strictly: S(HARD) < S(GOOD) < S(EASY)", () => {
      const d = 5.0;
      const s = 5.0;
      const r = 0.9;

      const sHard = computeStabilityAfterRecall(d, s, r, "HARD");
      const sGood = computeStabilityAfterRecall(d, s, r, "GOOD");
      const sEasy = computeStabilityAfterRecall(d, s, r, "EASY");

      expect(sHard).toBeGreaterThan(s);
      expect(sGood).toBeGreaterThan(sHard);
      expect(sEasy).toBeGreaterThan(sGood);
    });

    it("2.6 reduces stability upon lapse (AGAIN) while keeping S'_f >= 0.1", () => {
      const sBefore = 15.0;
      const sAfterLapse = computeStabilityAfterLapse(5.5, sBefore, 0.85);
      expect(sAfterLapse).toBeLessThan(sBefore);
      expect(sAfterLapse).toBeGreaterThanOrEqual(0.1);
    });

    it("2.7 converts stability into integer days for 90% retention", () => {
      expect(computeIntervalDays(2.4)).toBe(2);
      expect(computeIntervalDays(5.8)).toBe(6);
      expect(computeIntervalDays(0.2)).toBe(1);
    });
  });

  // =========================================================================
  // Suite 3: State Machine Transitions (NEW, LEARNING, REVIEW, RELEARNING, SUSPENDED)
  // =========================================================================
  describe("Suite 3: State Machine Transitions", () => {
    it("3.1 transitions NEW -> LEARNING (10m) on AGAIN", () => {
      const initial = createInitialCardState();
      const res = scheduleNextReview(initial, "AGAIN", baseTime);

      expect(res.stateBefore).toBe("NEW");
      expect(res.state).toBe("LEARNING");
      expect(res.wasCorrect).toBe(false);
      expect(res.scheduledDays).toBe(0);
      expect(res.reps).toBe(1);
      expect(res.lapses).toBe(0);
      expect(res.dueAt.getTime() - baseTime.getTime()).toBe(10 * 60 * 1000);
      expect(res.algorithmVersion).toBe(FSRS_ALGORITHM_VERSION);
    });

    it("3.2 transitions NEW -> LEARNING (1d) on HARD", () => {
      const initial = createInitialCardState();
      const res = scheduleNextReview(initial, "HARD", baseTime);

      expect(res.stateBefore).toBe("NEW");
      expect(res.state).toBe("LEARNING");
      expect(res.wasCorrect).toBe(true);
      expect(res.scheduledDays).toBe(1);
      expect(res.dueAt.getTime() - baseTime.getTime()).toBe(86_400_000);
    });

    it("3.3 transitions NEW -> REVIEW (2d) on GOOD and (6d) on EASY", () => {
      const initial = createInitialCardState();
      const goodRes = scheduleNextReview(initial, "GOOD", baseTime);
      const easyRes = scheduleNextReview(initial, "EASY", baseTime);

      expect(goodRes.state).toBe("REVIEW");
      expect(goodRes.scheduledDays).toBe(2);

      expect(easyRes.state).toBe("REVIEW");
      expect(easyRes.scheduledDays).toBe(6);
      expect(easyRes.scheduledDays).toBeGreaterThan(goodRes.scheduledDays);
    });

    it("3.4 graduates LEARNING -> REVIEW on GOOD and stays LEARNING on AGAIN", () => {
      const initial = createInitialCardState();
      const step1 = scheduleNextReview(initial, "AGAIN", baseTime);
      expect(step1.state).toBe("LEARNING");

      const tenMinsLater = new Date(baseTime.getTime() + 10 * 60 * 1000);
      const step2Again = scheduleNextReview(
        { ...step1, lastReviewedAt: step1.reviewedAt },
        "AGAIN",
        tenMinsLater
      );
      expect(step2Again.state).toBe("LEARNING");
      expect(step2Again.scheduledDays).toBe(0);

      const step2Good = scheduleNextReview(
        { ...step1, lastReviewedAt: step1.reviewedAt },
        "GOOD",
        tenMinsLater
      );
      expect(step2Good.state).toBe("REVIEW");
      expect(step2Good.scheduledDays).toBeGreaterThanOrEqual(1);
      expect(step2Good.reps).toBe(2);
    });

    it("3.5 transitions REVIEW -> RELEARNING on AGAIN (incrementing lapses) and recovers to REVIEW on GOOD", () => {
      const initial = createInitialCardState();
      const rev1 = scheduleNextReview(initial, "GOOD", baseTime);
      expect(rev1.state).toBe("REVIEW");
      expect(rev1.lapses).toBe(0);

      const twoDaysLater = new Date(baseTime.getTime() + 2 * 86_400_000);
      const lapse = scheduleNextReview(
        { ...rev1, lastReviewedAt: rev1.reviewedAt },
        "AGAIN",
        twoDaysLater
      );
      expect(lapse.stateBefore).toBe("REVIEW");
      expect(lapse.state).toBe("RELEARNING");
      expect(lapse.lapses).toBe(1);
      expect(lapse.scheduledDays).toBe(0);
      expect(lapse.stability).toBeLessThan(rev1.stability);

      const relearnTime = new Date(twoDaysLater.getTime() + 15 * 60 * 1000);
      const recovered = scheduleNextReview(
        { ...lapse, lastReviewedAt: lapse.reviewedAt },
        "GOOD",
        relearnTime
      );
      expect(recovered.stateBefore).toBe("RELEARNING");
      expect(recovered.state).toBe("REVIEW");
      expect(recovered.lapses).toBe(1);
      expect(recovered.scheduledDays).toBeGreaterThanOrEqual(1);
    });

    it("3.6 enforces monotonic intervals HARD < GOOD < EASY in REVIEW state", () => {
      const initial = createInitialCardState();
      const first = scheduleNextReview(initial, "GOOD", baseTime);
      const stateAtDue: typeof initial = {
        ...first,
        lastReviewedAt: first.reviewedAt,
      };
      const reviewDate = new Date(baseTime.getTime() + 2 * 86_400_000);

      const hard = scheduleNextReview(stateAtDue, "HARD", reviewDate);
      const good = scheduleNextReview(stateAtDue, "GOOD", reviewDate);
      const easy = scheduleNextReview(stateAtDue, "EASY", reviewDate);

      expect(hard.scheduledDays).toBeGreaterThanOrEqual(1);
      expect(good.scheduledDays).toBeGreaterThan(hard.scheduledDays);
      expect(easy.scheduledDays).toBeGreaterThan(good.scheduledDays);
    });

    it("3.7 rejects reviewing a SUSPENDED card until unsuspended, preserving underlying FSRS parameters", () => {
      const initial = createInitialCardState();
      const reviewed = scheduleNextReview(initial, "GOOD", baseTime);
      const suspended = suspendCardState(
        { ...reviewed, lastReviewedAt: reviewed.reviewedAt },
        baseTime
      );

      expect(suspended.state).toBe("SUSPENDED");
      expect(suspended.stability).toBe(reviewed.stability);
      expect(isCardDue(suspended, new Date(baseTime.getTime() + 10 * 86_400_000))).toBe(false);

      expect(() => scheduleNextReview(suspended, "GOOD", baseTime)).toThrow(CardSuspendedError);

      const unsuspended = unsuspendCardState(suspended, baseTime, "REVIEW");
      expect(unsuspended.state).toBe("REVIEW");
      expect(unsuspended.stability).toBe(reviewed.stability);

      const nextReview = scheduleNextReview(unsuspended, "GOOD", new Date(baseTime.getTime() + 2 * 86_400_000));
      expect(nextReview.state).toBe("REVIEW");
      expect(nextReview.reps).toBe(2);
    });

    it("3.8 deriveCardStateFromReview hydrates SUSPENDED cards (both NEW->SUSPENDED and REVIEW->SUSPENDED with dueAt: null) without fabricating a GOOD review", () => {
      const suspendedFromNew = deriveCardStateFromReview({
        wasCorrect: false,
        reviewedAt: baseTime,
        state: "SUSPENDED",
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        dueAt: null,
      });
      expect(suspendedFromNew.state).toBe("SUSPENDED");
      expect(suspendedFromNew.reps).toBe(0);
      expect(suspendedFromNew.stability).toBe(0);
      expect(suspendedFromNew.dueAt).toBeNull();

      const suspendedFromReview = deriveCardStateFromReview({
        wasCorrect: true,
        reviewedAt: baseTime,
        state: "SUSPENDED",
        stability: 5.5,
        difficulty: 4.1,
        elapsedDays: 2,
        scheduledDays: 7,
        reps: 3,
        lapses: 1,
        dueAt: null,
      });
      expect(suspendedFromReview.state).toBe("SUSPENDED");
      expect(suspendedFromReview.stability).toBe(5.5);
      expect(suspendedFromReview.difficulty).toBe(4.1);
      expect(suspendedFromReview.reps).toBe(3);
      expect(suspendedFromReview.dueAt).toBeNull();

      const unsuspendedFromReview = unsuspendCardState(suspendedFromReview, baseTime, "REVIEW");
      expect(unsuspendedFromReview.state).toBe("REVIEW");
      expect(unsuspendedFromReview.stability).toBe(5.5);
      expect(unsuspendedFromReview.reps).toBe(3);
    });
  });

  // =========================================================================
  // Suite 4: Timezone & Calendar Day Boundaries
  // =========================================================================
  describe("Suite 4: Timezone & Calendar Day Boundaries", () => {
    it("4.1 normalizes valid IANA timezones and falls back to UTC on invalid strings", () => {
      expect(normalizeTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
      expect(normalizeTimezone("America/New_York")).toBe("America/New_York");
      expect(normalizeTimezone("Invalid/Timezone_Name")).toBe("UTC");
      expect(normalizeTimezone("")).toBe("UTC");
      expect(normalizeTimezone(null)).toBe("UTC");
    });

    it("4.2 resolves local date parts across timezone midnight boundaries", () => {
      // 2026-11-11T20:30:00Z is already 2026-11-12T02:00:00 in Asia/Kolkata (+05:30)
      const instant = new Date("2026-11-11T20:30:00.000Z");
      const utcParts = getZonedDateParts(instant, "UTC");
      const istParts = getZonedDateParts(instant, "Asia/Kolkata");
      const nyParts = getZonedDateParts(instant, "America/New_York");

      expect(utcParts.dateKey).toBe("2026-11-11");
      expect(istParts.dateKey).toBe("2026-11-12");
      expect(nyParts.dateKey).toBe("2026-11-11");
    });

    it("4.3 computes startOfUserDay and endOfUserDay accurately for non-UTC timezones", () => {
      const instant = new Date("2026-11-11T20:30:00.000Z"); // 2026-11-12 in IST (+05:30)
      const istStart = startOfUserDay(instant, "Asia/Kolkata");
      const istEnd = endOfUserDay(instant, "Asia/Kolkata");

      // 2026-11-12 00:00:00 IST == 2026-11-11 18:30:00 UTC
      expect(istStart.toISOString()).toBe("2026-11-11T18:30:00.000Z");
      // 2026-11-12 23:59:59.999 IST == 2026-11-12 18:29:59.999 UTC
      expect(istEnd.toISOString()).toBe("2026-11-12T18:29:59.999Z");
    });

    it("4.4 evaluates isCardDue and isCardOverdue with timezone awareness", () => {
      const now = new Date("2026-11-11T10:00:00.000Z");
      const dueLaterTodayUtc = new Date("2026-11-11T18:00:00.000Z");
      const dueTomorrowUtc = new Date("2026-11-12T12:00:00.000Z");
      const dueYesterdayUtc = new Date("2026-11-10T12:00:00.000Z");

      // Day-scheduled card due later today is due today (includeEndOfDay = true)
      expect(
        isCardDue({ state: "REVIEW", dueAt: dueLaterTodayUtc, scheduledDays: 2 }, now, {
          timezone: "UTC",
        })
      ).toBe(true);

      // Intra-day learning card (scheduledDays = 0) due in 8 hours is NOT due yet until dueAt <= now
      expect(
        isCardDue({ state: "LEARNING", dueAt: dueLaterTodayUtc, scheduledDays: 0 }, now, {
          timezone: "UTC",
        })
      ).toBe(false);

      // Card due tomorrow is not due today
      expect(
        isCardDue({ state: "REVIEW", dueAt: dueTomorrowUtc, scheduledDays: 2 }, now, {
          timezone: "UTC",
        })
      ).toBe(false);

      // Card due yesterday is both due and overdue
      expect(
        isCardDue({ state: "REVIEW", dueAt: dueYesterdayUtc, scheduledDays: 2 }, now, {
          timezone: "UTC",
        })
      ).toBe(true);
      expect(isCardOverdue({ state: "REVIEW", dueAt: dueYesterdayUtc }, now, "UTC")).toBe(true);
      expect(isCardOverdue({ state: "REVIEW", dueAt: dueLaterTodayUtc }, now, "UTC")).toBe(false);
    });

    it("4.5 computes elapsedCalendarDays across dates", () => {
      const d1 = new Date("2026-11-01T22:00:00.000Z");
      const d2 = new Date("2026-11-05T04:00:00.000Z");
      expect(elapsedCalendarDays(d1, d2, "UTC")).toBe(4);
    });
  });

  // =========================================================================
  // Suite 5: Legacy Hydration, Previews & Duplicate Submission Prevention
  // =========================================================================
  describe("Suite 5: Legacy Hydration, Previews & Duplicate Submission Prevention", () => {
    it("5.1 derives initial state from null and hydrates legacy Phase 8.6 review rows", () => {
      const fromNull = deriveCardStateFromReview(null);
      expect(fromNull.state).toBe("NEW");
      expect(fromNull.dueAt).toBeNull();

      const legacyCorrect = deriveCardStateFromReview({
        wasCorrect: true,
        reviewedAt: "2026-11-01T10:00:00.000Z",
      });
      expect(legacyCorrect.state).toBe("REVIEW");
      expect(legacyCorrect.scheduledDays).toBe(2);
      expect(legacyCorrect.stability).toBe(2.4);
      expect(legacyCorrect.dueAt?.toISOString()).toBe("2026-11-03T10:00:00.000Z");

      const legacyIncorrect = deriveCardStateFromReview({
        wasCorrect: false,
        reviewedAt: "2026-11-01T10:00:00.000Z",
      });
      expect(legacyIncorrect.state).toBe("LEARNING");
      expect(legacyIncorrect.scheduledDays).toBe(0);
    });

    it("5.2 previews all 4 rating options with human-readable labels", () => {
      const previews = previewSchedulingOptions(createInitialCardState(), baseTime);
      expect(previews.AGAIN.label).toBe("<10m");
      expect(previews.HARD.label).toBe("1d");
      expect(previews.GOOD.label).toBe("2d");
      expect(previews.EASY.label).toBe("6d");

      expect(formatIntervalLabel(0)).toBe("<10m");
      expect(formatIntervalLabel(14)).toBe("14d");
      expect(formatIntervalLabel(60)).toBe("2mo");
      expect(formatIntervalLabel(365)).toBe("1y");
    });

    it("5.3 detects duplicate submissions by idempotencyKey or rapid repeat window", () => {
      const priorReview = {
        wasCorrect: true,
        rating: "GOOD" as const,
        idempotencyKey: "req-abc-123",
        reviewedAt: baseTime,
      };

      // Matching idempotencyKey is always a duplicate regardless of timestamp
      expect(
        isDuplicateSubmission(priorReview, {
          rating: "GOOD",
          idempotencyKey: "req-abc-123",
          now: new Date(baseTime.getTime() + 60_000),
        })
      ).toBe(true);

      // Rapid repeat within 500ms with same rating is flagged as duplicate
      expect(
        isDuplicateSubmission(priorReview, {
          rating: "GOOD",
          now: new Date(baseTime.getTime() + 500),
        })
      ).toBe(true);

      // Review 5 seconds later without matching idempotencyKey is allowed
      expect(
        isDuplicateSubmission(priorReview, {
          rating: "GOOD",
          now: new Date(baseTime.getTime() + 5_000),
        })
      ).toBe(false);
    });
  });
});

