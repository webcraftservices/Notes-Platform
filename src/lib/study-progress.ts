import { db } from "@/lib/db";
import type { ResolvedAIScope } from "@/lib/access";
import { materialWhereForScope } from "@/lib/retrieval-scope";
import {
  deriveCardStateFromReview,
  getZonedDateParts,
  normalizeTimezone,
  startOfUserDay,
  wasCorrectToDefaultRating,
  type PersistedReviewRecord,
  type ReviewRating,
} from "@/lib/srs/fsrs";
import { computeDeckStudyStats } from "@/lib/srs/study-queue";

/**
 * Phase 8.5 & Phase 13 — Study Progress & Learning Analytics.
 *
 * Aggregates persisted per-user learning activity across:
 * 1. `QuizAttempt` (`getQuizProgress` + `computeQuizMastery`)
 * 2. `AIConversation` / `AIMessage` (`kind = TUTOR`, `getTutorActivity`)
 * 3. `FlashcardReview` & accessible `FlashcardDeck` / `Flashcard` (`getFlashcardProgress`)
 *
 * Every function takes `userId` explicitly and scopes activity queries to
 * `WHERE userId = userId`. When `scope` (`ResolvedAIScope`) is provided,
 * queries are further narrowed to that curriculum/group scope.
 */

export interface QuizAttemptSummary {
  id: string;
  quizId: string;
  quizTitle: string;
  score: number;
  startedAt: Date;
  completedAt: Date | null;
}

export interface QuizProgress {
  attempts: number;
  uniqueQuizzesAttempted: number;
  latest: QuizAttemptSummary | null;
  bestScore: number | null;
  averageScore: number | null;
  /** Most recent attempts first, capped — see MAX_HISTORY below. */
  history: QuizAttemptSummary[];
}

export type QuizMasteryTier = "NONE" | "DEVELOPING" | "PROFICIENT" | "MASTERED";

export interface QuizMasterySummary {
  masteryTier: QuizMasteryTier;
  uniqueQuizzesAttempted: number;
  recentTrendDelta: number | null;
}

export interface TutorActivity {
  sessions: number;
  messages: number;
  lastActiveAt: Date | null;
}

export interface FlashcardDailyActivityPoint {
  /** YYYY-MM-DD in the user's timezone */
  date: string;
  reviews: number;
  correct: number;
}

export interface FlashcardProgress {
  totalDecks: number;
  totalCards: number;
  cardsStudied: number;
  reviewsCompleted: number;
  reviewsToday: number;
  reviewsLast7Days: number;
  reviewsLast30Days: number;
  dueCount: number;
  overdueCount: number;
  newCount: number;
  learningCount: number;
  reviewCount: number;
  suspendedCount: number;
  upcoming7DaysCount: number;
  correctCount: number;
  accuracyPercent: number | null;
  ratingDistribution: Record<ReviewRating, number>;
  averageStabilityDays: number | null;
  lastReviewedAt: Date | null;
  dailyActivity: FlashcardDailyActivityPoint[];
}

export interface StudyProgress {
  quizzes: QuizProgress;
  tutor: TutorActivity;
  flashcards: FlashcardProgress;
}

const MAX_HISTORY = 20;

export function createEmptyFlashcardProgress(
  now: Date = new Date(),
  timezone = "UTC"
): FlashcardProgress {
  const tz = normalizeTimezone(timezone);
  const dailyActivity: FlashcardDailyActivityPoint[] = [];
  const todayStart = startOfUserDay(now, tz);

  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(todayStart.getTime() - offset * 86_400_000 + 12 * 3_600_000);
    const parts = getZonedDateParts(d, tz);
    const dateKey = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    dailyActivity.push({ date: dateKey, reviews: 0, correct: 0 });
  }

  return {
    totalDecks: 0,
    totalCards: 0,
    cardsStudied: 0,
    reviewsCompleted: 0,
    reviewsToday: 0,
    reviewsLast7Days: 0,
    reviewsLast30Days: 0,
    dueCount: 0,
    overdueCount: 0,
    newCount: 0,
    learningCount: 0,
    reviewCount: 0,
    suspendedCount: 0,
    upcoming7DaysCount: 0,
    correctCount: 0,
    accuracyPercent: null,
    ratingDistribution: {
      AGAIN: 0,
      HARD: 0,
      GOOD: 0,
      EASY: 0,
    },
    averageStabilityDays: null,
    lastReviewedAt: null,
    dailyActivity,
  };
}

export function isPureLifecycleReviewEvent(rev: {
  state?: string | null;
  stateBefore?: string | null;
}): boolean {
  return rev.state === "SUSPENDED" || rev.stateBefore === "SUSPENDED";
}

/**
 * Computes mastery classification and score trend from a user's `QuizProgress`.
 * Pure and deterministic so both API consumers and UI components can derive mastery.
 */
export function computeQuizMastery(quizProgress: QuizProgress): QuizMasterySummary {
  if (quizProgress.attempts === 0 || quizProgress.bestScore === null) {
    return {
      masteryTier: "NONE",
      uniqueQuizzesAttempted: 0,
      recentTrendDelta: null,
    };
  }

  let uniqueQuizzesAttempted: number;
  if (typeof quizProgress.uniqueQuizzesAttempted === "number") {
    uniqueQuizzesAttempted = quizProgress.uniqueQuizzesAttempted;
  } else if (quizProgress.attempts > quizProgress.history.length) {
    throw new Error(
      "computeQuizMastery requires quizProgress.uniqueQuizzesAttempted when attempts exceed history.length"
    );
  } else {
    uniqueQuizzesAttempted = new Set(quizProgress.history.map((h) => h.quizId)).size;
  }
  const best = quizProgress.bestScore;
  const avg = quizProgress.averageScore ?? best;

  let masteryTier: QuizMasteryTier;
  if (best >= 85 && avg >= 75) {
    masteryTier = "MASTERED";
  } else if (best >= 70) {
    masteryTier = "PROFICIENT";
  } else {
    masteryTier = "DEVELOPING";
  }

  let recentTrendDelta: number | null = null;
  if (quizProgress.history.length >= 2) {
    recentTrendDelta = quizProgress.history[0]!.score - quizProgress.history[1]!.score;
  }

  return {
    masteryTier,
    uniqueQuizzesAttempted,
    recentTrendDelta,
  };
}

/**
 * Real, private, per-user Quiz progress. Multiple attempts on the same
 * Quiz are never collapsed: `attempts` counts every one of them, `latest`
 * is the most recently started, `bestScore`/`averageScore` and
 * `uniqueQuizzesAttempted` are computed across the full authorized attempt
 * set, while `history` is capped at `MAX_HISTORY` (20) for UI payloads.
 */
export async function getQuizProgress(userId: string, scope?: ResolvedAIScope): Promise<QuizProgress> {
  const quizWhere = scope ? materialWhereForScope(scope) : {};
  const attemptWhere = { userId, quiz: quizWhere };

  const canAggregateAtDbLevel =
    typeof (db.quizAttempt as { aggregate?: unknown }).aggregate === "function" &&
    typeof (db.quizAttempt as { groupBy?: unknown }).groupBy === "function";

  if (canAggregateAtDbLevel) {
    const [agg, distinctQuizGroups, recentAttempts] = await Promise.all([
      db.quizAttempt.aggregate({
        where: attemptWhere,
        _count: { _all: true },
        _max: { score: true },
        _avg: { score: true },
      }),
      db.quizAttempt.groupBy({
        by: ["quizId"],
        where: attemptWhere,
      }),
      db.quizAttempt.findMany({
        where: attemptWhere,
        include: { quiz: { select: { title: true } } },
        orderBy: { startedAt: "desc" },
        take: MAX_HISTORY,
      }),
    ]);

    const totalAttempts = agg._count._all;
    if (totalAttempts === 0) {
      return {
        attempts: 0,
        uniqueQuizzesAttempted: 0,
        latest: null,
        bestScore: null,
        averageScore: null,
        history: [],
      };
    }

    const history: QuizAttemptSummary[] = recentAttempts.map((a) => ({
      id: a.id,
      quizId: a.quizId,
      quizTitle: a.quiz.title,
      score: a.score,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
    }));

    const bestScore = agg._max.score ?? null;
    const averageScore = agg._avg.score !== null ? Math.round(agg._avg.score) : null;

    return {
      attempts: totalAttempts,
      uniqueQuizzesAttempted: distinctQuizGroups.length,
      latest: history[0] ?? null,
      bestScore,
      averageScore,
      history,
    };
  }

  const attempts = await db.quizAttempt.findMany({
    where: attemptWhere,
    include: { quiz: { select: { title: true } } },
    orderBy: { startedAt: "desc" },
  });

  if (attempts.length === 0) {
    return {
      attempts: 0,
      uniqueQuizzesAttempted: 0,
      latest: null,
      bestScore: null,
      averageScore: null,
      history: [],
    };
  }

  const uniqueQuizzesAttempted = new Set(attempts.map((a) => a.quizId)).size;

  const history: QuizAttemptSummary[] = attempts.slice(0, MAX_HISTORY).map((a) => ({
    id: a.id,
    quizId: a.quizId,
    quizTitle: a.quiz.title,
    score: a.score,
    startedAt: a.startedAt,
    completedAt: a.completedAt,
  }));

  const bestScore = Math.max(...attempts.map((a) => a.score));
  const averageScore = Math.round(attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length);

  return {
    attempts: attempts.length,
    uniqueQuizzesAttempted,
    latest: history[0] ?? null,
    bestScore,
    averageScore,
    history,
  };
}

/**
 * Real, private, per-user AI Tutor activity. Only `AIConversation` rows
 * with `kind = TUTOR` count as a "session" — a plain "Ask AI" (`kind =
 * CHAT`) conversation never contributes here.
 */
export async function getTutorActivity(userId: string, scope?: ResolvedAIScope): Promise<TutorActivity> {
  const scopeWhere = scope ? materialWhereForScope(scope) : {};

  const conversations = await db.aIConversation.findMany({
    where: { userId, kind: "TUTOR", deletedAt: null, ...scopeWhere },
    select: { id: true },
  });

  if (conversations.length === 0) {
    return { sessions: 0, messages: 0, lastActiveAt: null };
  }

  const conversationIds = conversations.map((c) => c.id);

  const [messages, lastMessage] = await Promise.all([
    db.aIMessage.count({ where: { conversationId: { in: conversationIds } } }),
    db.aIMessage.findFirst({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    sessions: conversations.length,
    messages,
    lastActiveAt: lastMessage?.createdAt ?? null,
  };
}

/**
 * Phase 13 — Real, private, per-user Flashcard & Spaced Repetition progress.
 *
 * Computes:
 * - Historical review totals (`reviewsCompleted`, `reviewsToday`, `reviewsLast7Days`, `reviewsLast30Days`)
 * - Accuracy and rating distribution (`AGAIN`, `HARD`, `GOOD`, `EASY`), avoiding division by zero when `reviewsCompleted === 0`
 * - Current card state breakdown (`dueCount`, `overdueCount`, `newCount`, `learningCount`, `reviewCount`, `suspendedCount`, `upcoming7DaysCount`)
 * - Average memory stability across studied cards and 7-day daily activity buckets in the user's timezone.
 */
export async function getFlashcardProgress(
  userId: string,
  scope?: ResolvedAIScope,
  now: Date = new Date()
): Promise<FlashcardProgress> {
  const hasReviewModel =
    typeof (db as { flashcardReview?: { findMany?: unknown } }).flashcardReview?.findMany ===
    "function";
  if (!hasReviewModel) {
    return createEmptyFlashcardProgress(now, "UTC");
  }

  let timezone = "UTC";
  if (typeof (db as { profile?: { findUnique?: unknown } }).profile?.findUnique === "function") {
    const profile = await db.profile.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    timezone = normalizeTimezone(profile?.timezone);
  }

  const deckScopeWhere = scope ? materialWhereForScope(scope) : { ownerId: userId };

  const [reviews, decks] = await Promise.all([
    db.flashcardReview.findMany({
      where: {
        userId,
        ...(scope ? { flashcard: { deck: deckScopeWhere } } : {}),
      },
      orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
    }),
    typeof (db as { flashcardDeck?: { findMany?: unknown } }).flashcardDeck?.findMany === "function"
      ? db.flashcardDeck.findMany({
          where: deckScopeWhere,
          include: {
            cards: {
              select: { id: true },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const empty = createEmptyFlashcardProgress(now, timezone);

  // Build latest review map per flashcardId
  const latestByCardId = new Map<string, (typeof reviews)[number]>();
  for (const rev of reviews) {
    if (!latestByCardId.has(rev.flashcardId)) {
      latestByCardId.set(rev.flashcardId, rev);
    }
  }

  // Collect all cards from accessible decks + any cards the user has reviewed
  const allCardIds = new Set<string>();
  for (const deck of decks) {
    for (const card of deck.cards ?? []) {
      allCardIds.add(card.id);
    }
  }
  for (const cardId of latestByCardId.keys()) {
    allCardIds.add(cardId);
  }

  const cardsForStats = Array.from(allCardIds).map((id) => ({
    id,
    review: (latestByCardId.get(id) ?? null) as unknown as PersistedReviewRecord | null,
  }));

  const deckStats = computeDeckStudyStats(cardsForStats, now, timezone);

  // Filter out pure lifecycle actions (SUSPEND/UNSUSPEND) that didn't represent an active study turn
  // when computing accuracy, or include all review events that have a rating / wasCorrect
  const todayStartMs = startOfUserDay(now, timezone).getTime();
  const sevenDaysStartMs = todayStartMs - 6 * 86_400_000;
  const thirtyDaysStartMs = todayStartMs - 29 * 86_400_000;

  const dailyBuckets = new Map<string, { date: string; reviews: number; correct: number }>();
  for (const point of empty.dailyActivity) {
    dailyBuckets.set(point.date, { ...point });
  }

  const ratingDistribution: Record<ReviewRating, number> = {
    AGAIN: 0,
    HARD: 0,
    GOOD: 0,
    EASY: 0,
  };

  let reviewsCompleted = 0;
  let reviewsToday = 0;
  let reviewsLast7Days = 0;
  let reviewsLast30Days = 0;
  let correctCount = 0;
  let lastActualReviewedAt: Date | null = null;
  const studiedCardIds = new Set<string>();

  for (const rev of reviews) {
    if (isPureLifecycleReviewEvent(rev)) {
      continue;
    }

    studiedCardIds.add(rev.flashcardId);

    if (!lastActualReviewedAt) {
      lastActualReviewedAt = rev.reviewedAt;
    }

    reviewsCompleted += 1;
    if (rev.wasCorrect) {
      correctCount += 1;
    }

    const effectiveRating: ReviewRating =
      (rev.rating as ReviewRating | null) ?? wasCorrectToDefaultRating(rev.wasCorrect);
    ratingDistribution[effectiveRating] = (ratingDistribution[effectiveRating] ?? 0) + 1;

    const revMs = rev.reviewedAt.getTime();
    if (revMs >= todayStartMs) {
      reviewsToday += 1;
    }
    if (revMs >= sevenDaysStartMs) {
      reviewsLast7Days += 1;
    }
    if (revMs >= thirtyDaysStartMs) {
      reviewsLast30Days += 1;
    }

    const parts = getZonedDateParts(rev.reviewedAt, timezone);
    const dateKey = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    const bucket = dailyBuckets.get(dateKey);
    if (bucket) {
      bucket.reviews += 1;
      if (rev.wasCorrect) {
        bucket.correct += 1;
      }
    }
  }

  let stabilitySum = 0;
  let stabilityCount = 0;
  for (const latest of latestByCardId.values()) {
    const derived = deriveCardStateFromReview(latest as unknown as PersistedReviewRecord);
    if (derived.stability > 0) {
      stabilitySum += derived.stability;
      stabilityCount += 1;
    }
  }

  const accuracyPercent =
    reviewsCompleted > 0 ? Math.round((correctCount / reviewsCompleted) * 100) : null;
  const averageStabilityDays =
    stabilityCount > 0 ? Number((stabilitySum / stabilityCount).toFixed(2)) : null;

  return {
    totalDecks: decks.length,
    totalCards: deckStats.totalCards,
    cardsStudied: studiedCardIds.size,
    reviewsCompleted,
    reviewsToday,
    reviewsLast7Days,
    reviewsLast30Days,
    dueCount: deckStats.dueCount,
    overdueCount: deckStats.overdueCount,
    newCount: deckStats.newCount,
    learningCount: deckStats.learningCount,
    reviewCount: deckStats.reviewCount,
    suspendedCount: deckStats.suspendedCount,
    upcoming7DaysCount: deckStats.upcoming7DaysCount,
    correctCount,
    accuracyPercent,
    ratingDistribution,
    averageStabilityDays,
    lastReviewedAt: lastActualReviewedAt,
    dailyActivity: Array.from(dailyBuckets.values()),
  };
}

/** Convenience wrapper — the shape `GET /api/progress` returns. */
export async function getStudyProgress(userId: string, scope?: ResolvedAIScope): Promise<StudyProgress> {
  const [quizzes, tutor, flashcards] = await Promise.all([
    getQuizProgress(userId, scope),
    getTutorActivity(userId, scope),
    getFlashcardProgress(userId, scope),
  ]);
  return { quizzes, tutor, flashcards };
}
