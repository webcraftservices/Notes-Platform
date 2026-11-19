/**
 * Phase 13 — Pure Study Queue Partitioning & Deck Statistics
 *
 * Client- and server-safe module (no `@/lib/db` import) for serializing
 * FSRS-4.5 card schedules, computing deck due/new/learning/review/suspended
 * counts, and partitioning cards into deterministic study queues.
 */

import {
  REVIEW_RATINGS,
  type CardLearningState,
  type CardScheduleState,
  type PersistedReviewRecord,
  type ReviewRating,
  deriveCardStateFromReview,
  endOfUserDay,
  isCardDue,
  isCardOverdue,
  previewSchedulingOptions,
} from "./fsrs";

export interface SerializedIntervalPreview {
  rating: ReviewRating;
  state: CardLearningState;
  scheduledDays: number;
  dueAt: string;
  label: string;
}

export interface CardScheduleSummary {
  state: CardLearningState;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
  isDue: boolean;
  isOverdue: boolean;
  algorithmVersion: string;
  intervals: Record<ReviewRating, SerializedIntervalPreview>;
}

export interface DeckStudyStats {
  totalCards: number;
  dueCount: number;
  overdueCount: number;
  newCount: number;
  learningCount: number;
  reviewCount: number;
  suspendedCount: number;
  studiedCount: number;
  upcoming7DaysCount: number;
  nextDueAt: string | null;
}

export function serializeCardSchedule(
  state: CardScheduleState,
  now: Date = new Date(),
  timezone?: string | null
): CardScheduleSummary {
  const previews = previewSchedulingOptions(state, now, { timezone });
  const intervals = {} as Record<ReviewRating, SerializedIntervalPreview>;

  for (const r of REVIEW_RATINGS) {
    const p = previews[r];
    intervals[r] = {
      rating: p.rating,
      state: p.state,
      scheduledDays: p.scheduledDays,
      dueAt: p.dueAt.toISOString(),
      label: p.label,
    };
  }

  return {
    state: state.state,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsedDays: state.elapsedDays,
    scheduledDays: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    dueAt: state.dueAt ? state.dueAt.toISOString() : null,
    lastReviewedAt: state.lastReviewedAt ? state.lastReviewedAt.toISOString() : null,
    isDue: isCardDue(state, now, { timezone }),
    isOverdue: isCardOverdue(state, now, timezone),
    algorithmVersion: state.algorithmVersion,
    intervals,
  };
}

export function computeDeckStudyStats(
  cards: ReadonlyArray<{
    id: string;
    review?: PersistedReviewRecord | null;
    schedule?: CardScheduleSummary | null;
  }>,
  now: Date = new Date(),
  timezone?: string | null
): DeckStudyStats {
  let dueCount = 0;
  let overdueCount = 0;
  let newCount = 0;
  let learningCount = 0;
  let reviewCount = 0;
  let suspendedCount = 0;
  let upcoming7DaysCount = 0;
  let earliestDueMs: number | null = null;

  const dayEndMs = endOfUserDay(now, timezone).getTime();
  const sevenDaysEndMs = dayEndMs + 7 * 86_400_000;

  for (const card of cards) {
    const stateObj: CardScheduleState = card.schedule
      ? {
          state: card.schedule.state,
          stability: card.schedule.stability,
          difficulty: card.schedule.difficulty,
          elapsedDays: card.schedule.elapsedDays,
          scheduledDays: card.schedule.scheduledDays,
          reps: card.schedule.reps,
          lapses: card.schedule.lapses,
          dueAt: card.schedule.dueAt ? new Date(card.schedule.dueAt) : null,
          lastReviewedAt: card.schedule.lastReviewedAt
            ? new Date(card.schedule.lastReviewedAt)
            : null,
          algorithmVersion: card.schedule.algorithmVersion,
        }
      : deriveCardStateFromReview(card.review);

    if (stateObj.state === "NEW") {
      newCount += 1;
      continue;
    }

    if (stateObj.state === "SUSPENDED") {
      suspendedCount += 1;
      continue;
    }

    if (stateObj.state === "LEARNING" || stateObj.state === "RELEARNING") {
      learningCount += 1;
    } else if (stateObj.state === "REVIEW") {
      reviewCount += 1;
    }

    const due = isCardDue(stateObj, now, { timezone });
    const overdue = isCardOverdue(stateObj, now, timezone);

    if (due) {
      dueCount += 1;
    }
    if (overdue) {
      overdueCount += 1;
    }

    if (stateObj.dueAt) {
      const dueMs = stateObj.dueAt.getTime();
      if (earliestDueMs === null || dueMs < earliestDueMs) {
        earliestDueMs = dueMs;
      }
      if (!due && dueMs > dayEndMs && dueMs <= sevenDaysEndMs) {
        upcoming7DaysCount += 1;
      }
    }
  }

  return {
    totalCards: cards.length,
    dueCount,
    overdueCount,
    newCount,
    learningCount,
    reviewCount,
    suspendedCount,
    studiedCount: cards.length - newCount,
    upcoming7DaysCount,
    nextDueAt: earliestDueMs !== null ? new Date(earliestDueMs).toISOString() : null,
  };
}

export interface StudyQueueOptions {
  /**
   * - `"smart"` (default): Due learning/relearning -> Due review -> New cards.
   *   If no cards are due or new (all active cards are scheduled in the future),
   *   returns an empty `dueQueue` while exposing `allActiveQueue` so the learner
   *   can optionally practice ahead.
   * - `"due_only"`: Strictly due learning/relearning + due review cards (excludes new cards).
   * - `"all"`: All non-suspended cards (due learning -> due review -> new -> upcoming review).
   */
  mode?: "smart" | "due_only" | "all";
  newLimit?: number;
  limit?: number;
  now?: Date;
  timezone?: string | null;
}

export interface PartitionedStudyQueue<T> {
  queue: T[];
  dueLearning: T[];
  dueReview: T[];
  newCards: T[];
  upcomingReview: T[];
  suspended: T[];
  stats: DeckStudyStats;
}

/**
 * Deterministically partitions and orders flashcards for a study session:
 * 1. Due `LEARNING` / `RELEARNING` cards ordered by `dueAt ASC, id ASC`.
 * 2. Due `REVIEW` cards ordered by `dueAt ASC, id ASC`.
 * 3. `NEW` cards ordered by `id ASC` (capped at `newLimit` when in `"smart"` mode).
 * 4. Upcoming `REVIEW` / `LEARNING` cards (only included in `queue` when `mode === "all"`), ordered by `dueAt ASC, id ASC`.
 * 5. `SUSPENDED` cards are always excluded from `queue`.
 */
export function buildStudyQueue<
  T extends {
    id: string;
    review?: PersistedReviewRecord | null;
    schedule?: CardScheduleSummary | null;
  },
>(cards: readonly T[], options?: StudyQueueOptions): PartitionedStudyQueue<T> {
  const now = options?.now ?? new Date();
  const timezone = options?.timezone ?? "UTC";
  const mode = options?.mode ?? "smart";
  const newLimit = options?.newLimit ?? 20;
  const limit = options?.limit ?? 200;

  const dueLearning: { item: T; dueMs: number }[] = [];
  const dueReview: { item: T; dueMs: number }[] = [];
  const newCards: T[] = [];
  const upcomingReview: { item: T; dueMs: number }[] = [];
  const suspended: T[] = [];

  for (const card of cards) {
    const stateObj: CardScheduleState = card.schedule
      ? {
          state: card.schedule.state,
          stability: card.schedule.stability,
          difficulty: card.schedule.difficulty,
          elapsedDays: card.schedule.elapsedDays,
          scheduledDays: card.schedule.scheduledDays,
          reps: card.schedule.reps,
          lapses: card.schedule.lapses,
          dueAt: card.schedule.dueAt ? new Date(card.schedule.dueAt) : null,
          lastReviewedAt: card.schedule.lastReviewedAt
            ? new Date(card.schedule.lastReviewedAt)
            : null,
          algorithmVersion: card.schedule.algorithmVersion,
        }
      : deriveCardStateFromReview(card.review);

    if (stateObj.state === "SUSPENDED") {
      suspended.push(card);
      continue;
    }

    if (stateObj.state === "NEW") {
      newCards.push(card);
      continue;
    }

    const due = isCardDue(stateObj, now, { timezone });
    const dueMs = stateObj.dueAt ? stateObj.dueAt.getTime() : 0;

    if (due) {
      if (stateObj.state === "LEARNING" || stateObj.state === "RELEARNING") {
        dueLearning.push({ item: card, dueMs });
      } else {
        dueReview.push({ item: card, dueMs });
      }
    } else {
      upcomingReview.push({ item: card, dueMs });
    }
  }

  const sortByDueThenId = (a: { item: T; dueMs: number }, b: { item: T; dueMs: number }) => {
    if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
    return a.item.id.localeCompare(b.item.id);
  };

  dueLearning.sort(sortByDueThenId);
  dueReview.sort(sortByDueThenId);
  upcomingReview.sort(sortByDueThenId);
  newCards.sort((a, b) => a.id.localeCompare(b.id));

  const sortedDueLearning = dueLearning.map((x) => x.item);
  const sortedDueReview = dueReview.map((x) => x.item);
  const sortedUpcoming = upcomingReview.map((x) => x.item);

  let combined: T[];
  if (mode === "due_only") {
    combined = [...sortedDueLearning, ...sortedDueReview];
  } else if (mode === "all") {
    combined = [...sortedDueLearning, ...sortedDueReview, ...newCards, ...sortedUpcoming];
  } else {
    // "smart"
    combined = [
      ...sortedDueLearning,
      ...sortedDueReview,
      ...newCards.slice(0, Math.max(0, newLimit)),
    ];
  }

  return {
    queue: combined.slice(0, Math.max(1, limit)),
    dueLearning: sortedDueLearning,
    dueReview: sortedDueReview,
    newCards,
    upcomingReview: sortedUpcoming,
    suspended,
    stats: computeDeckStudyStats(cards, now, timezone),
  };
}

