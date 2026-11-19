import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  quizAttempt: { findMany: vi.fn() },
  aIConversation: { findMany: vi.fn() },
  aIMessage: { count: vi.fn(), findFirst: vi.fn() },
  flashcardReview: { findMany: vi.fn() },
  flashcardDeck: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import {
  getQuizProgress,
  getTutorActivity,
  getFlashcardProgress,
  getStudyProgress,
  computeQuizMastery,
} from "@/lib/study-progress";
import type { ResolvedAIScope } from "@/lib/access";

const TOPIC_SCOPE: ResolvedAIScope = {
  ownerType: "workspace",
  workspaceId: "workspace-1",
  groupId: null,
  subjectId: "subject-1",
  chapterId: "chapter-1",
  topicId: "topic-1",
};

const GROUP_SCOPE: ResolvedAIScope = {
  ownerType: "group",
  workspaceId: null,
  groupId: "group-1",
  subjectId: null,
  chapterId: null,
  topicId: null,
};

function attempt(overrides: Partial<{
  id: string;
  quizId: string;
  score: number;
  startedAt: Date;
  completedAt: Date | null;
  quizTitle: string;
}> = {}) {
  return {
    id: overrides.id ?? "attempt-1",
    quizId: overrides.quizId ?? "quiz-1",
    userId: "user-1",
    answers: {},
    score: overrides.score ?? 80,
    weakTopics: [],
    startedAt: overrides.startedAt ?? new Date("2026-09-01T10:00:00Z"),
    completedAt: overrides.completedAt ?? new Date("2026-09-01T10:05:00Z"),
    quiz: { title: overrides.quizTitle ?? "Zeroth Law Quiz" },
  };
}

describe("getQuizProgress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns zeroed progress with no attempts, without throwing", async () => {
    db.quizAttempt.findMany.mockResolvedValue([]);

    const progress = await getQuizProgress("user-1");

    expect(progress).toEqual({
      attempts: 0,
      uniqueQuizzesAttempted: 0,
      latest: null,
      bestScore: null,
      averageScore: null,
      history: [],
    });
  });

  it("always scopes the query to the requesting user", async () => {
    db.quizAttempt.findMany.mockResolvedValue([]);

    await getQuizProgress("user-1");

    expect(db.quizAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) })
    );
  });

  it("reports a single attempt as its own latest/best/average", async () => {
    db.quizAttempt.findMany.mockResolvedValue([attempt({ score: 75 })]);

    const progress = await getQuizProgress("user-1");

    expect(progress.attempts).toBe(1);
    expect(progress.bestScore).toBe(75);
    expect(progress.averageScore).toBe(75);
    expect(progress.latest?.id).toBe("attempt-1");
  });

  it("keeps multiple attempts on the same quiz distinct — never collapses them", async () => {
    db.quizAttempt.findMany.mockResolvedValue([
      attempt({ id: "a3", score: 90, startedAt: new Date("2026-09-03T00:00:00Z") }),
      attempt({ id: "a2", score: 40, startedAt: new Date("2026-09-02T00:00:00Z") }),
      attempt({ id: "a1", score: 70, startedAt: new Date("2026-09-01T00:00:00Z") }),
    ]);

    const progress = await getQuizProgress("user-1");

    expect(progress.attempts).toBe(3);
    expect(progress.history).toHaveLength(3);
    expect(progress.latest?.id).toBe("a3");
    expect(progress.bestScore).toBe(90);
    expect(progress.averageScore).toBe(Math.round((90 + 40 + 70) / 3));
  });

  it("aggregates across multiple quizzes under the same topic rollup", async () => {
    db.quizAttempt.findMany.mockResolvedValue([
      attempt({ id: "a1", quizId: "quiz-1", quizTitle: "Quiz 1", score: 100 }),
      attempt({ id: "a2", quizId: "quiz-2", quizTitle: "Quiz 2", score: 50 }),
    ]);

    const progress = await getQuizProgress("user-1", TOPIC_SCOPE);

    expect(progress.attempts).toBe(2);
    expect(new Set(progress.history.map((h) => h.quizId))).toEqual(new Set(["quiz-1", "quiz-2"]));
    expect(db.quizAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1", quiz: { topicId: "topic-1" } }),
      })
    );
  });

  it("narrows a bare group scope to the group's own quizzes", async () => {
    db.quizAttempt.findMany.mockResolvedValue([]);

    await getQuizProgress("user-1", GROUP_SCOPE);

    expect(db.quizAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ quiz: { groupId: "group-1" } }) })
    );
  });

  it("caps history length without dropping attempts/bestScore/averageScore accuracy", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      attempt({ id: `a${i}`, score: i, startedAt: new Date(2026, 0, i + 1) })
    );
    db.quizAttempt.findMany.mockResolvedValue(many);

    const progress = await getQuizProgress("user-1");

    expect(progress.attempts).toBe(25);
    expect(progress.history.length).toBeLessThanOrEqual(20);
    expect(progress.bestScore).toBe(24);
  });

  it("never lets User B's attempts leak into User A's progress", async () => {
    // The mock only returns what a real `WHERE userId = 'user-a'` query
    // would — this test asserts the call itself is user-scoped, which is
    // the actual privacy boundary (the DB, not this test, filters rows).
    db.quizAttempt.findMany.mockResolvedValue([attempt({ id: "a-owned-by-user-a" })]);

    await getQuizProgress("user-a");

    const callArgs = db.quizAttempt.findMany.mock.calls[0]?.[0] as any;
    expect(callArgs?.where?.userId).toBe("user-a");
    expect(callArgs?.where?.userId).not.toBe("user-b");
  });
});

describe("getTutorActivity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns zeroed activity with no Tutor conversations", async () => {
    db.aIConversation.findMany.mockResolvedValue([]);

    const activity = await getTutorActivity("user-1");

    expect(activity).toEqual({ sessions: 0, messages: 0, lastActiveAt: null });
    expect(db.aIMessage.count).not.toHaveBeenCalled();
  });

  it("only ever queries kind = TUTOR — never CHAT", async () => {
    db.aIConversation.findMany.mockResolvedValue([]);

    await getTutorActivity("user-1");

    expect(db.aIConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", kind: "TUTOR" }) })
    );
  });

  it("counts sessions and messages, and reports the last active timestamp", async () => {
    db.aIConversation.findMany.mockResolvedValue([{ id: "conv-1" }, { id: "conv-2" }]);
    db.aIMessage.count.mockResolvedValue(14);
    db.aIMessage.findFirst.mockResolvedValue({ createdAt: new Date("2026-09-10T12:00:00Z") });

    const activity = await getTutorActivity("user-1");

    expect(activity.sessions).toBe(2);
    expect(activity.messages).toBe(14);
    expect(activity.lastActiveAt).toEqual(new Date("2026-09-10T12:00:00Z"));
    expect(db.aIMessage.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: { in: ["conv-1", "conv-2"] } } })
    );
  });

  it("narrows to a topic scope when one is provided", async () => {
    db.aIConversation.findMany.mockResolvedValue([]);

    await getTutorActivity("user-1", TOPIC_SCOPE);

    expect(db.aIConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ topicId: "topic-1" }) })
    );
  });

  it("is unaffected by a mix of TUTOR and CHAT activity — CHAT never contributes", async () => {
    // A real query already filters kind: "TUTOR" server-side; this test
    // pins that the where-clause sent to the DB excludes CHAT rather
    // than filtering client-side after the fact.
    db.aIConversation.findMany.mockResolvedValue([{ id: "tutor-conv" }]);
    db.aIMessage.count.mockResolvedValue(3);
    db.aIMessage.findFirst.mockResolvedValue({ createdAt: new Date("2026-09-05T00:00:00Z") });

    const activity = await getTutorActivity("user-1");

    const callArgs = db.aIConversation.findMany.mock.calls[0]?.[0] as any;
    expect(callArgs?.where?.kind).toBe("TUTOR");
    expect(activity.sessions).toBe(1);
  });
});

describe("getStudyProgress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.flashcardReview.findMany.mockResolvedValue([]);
    db.flashcardDeck.findMany.mockResolvedValue([]);
  });

  it("combines quiz progress, tutor activity, and flashcard progress for a user with no history", async () => {
    db.quizAttempt.findMany.mockResolvedValue([]);
    db.aIConversation.findMany.mockResolvedValue([]);

    const progress = await getStudyProgress("user-1");

    expect(progress.quizzes.attempts).toBe(0);
    expect(progress.tutor.sessions).toBe(0);
    expect(progress.flashcards.reviewsCompleted).toBe(0);
    expect(progress.flashcards.accuracyPercent).toBeNull();
  });

  it("handles a zero-question quiz's attempt (score 0) without dividing by zero", async () => {
    db.quizAttempt.findMany.mockResolvedValue([attempt({ score: 0 })]);
    db.aIConversation.findMany.mockResolvedValue([]);

    const progress = await getStudyProgress("user-1");

    expect(progress.quizzes.averageScore).toBe(0);
    expect(progress.quizzes.bestScore).toBe(0);
    expect(Number.isNaN(progress.quizzes.averageScore)).toBe(false);
  });
});

describe("getFlashcardProgress and computeQuizMastery (Phase 13)", () => {
  const NOW = new Date("2026-11-11T15:00:00.000Z");

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns zeroed flashcard progress and accuracyPercent: null when the user has 0 reviews", async () => {
    db.flashcardReview.findMany.mockResolvedValue([]);
    db.flashcardDeck.findMany.mockResolvedValue([
      { id: "deck-1", cards: [{ id: "card-1" }, { id: "card-2" }] },
    ]);

    const fc = await getFlashcardProgress("user-1", undefined, NOW);

    expect(fc.totalDecks).toBe(1);
    expect(fc.totalCards).toBe(2);
    expect(fc.newCount).toBe(2);
    expect(fc.cardsStudied).toBe(0);
    expect(fc.reviewsCompleted).toBe(0);
    expect(fc.accuracyPercent).toBeNull();
    expect(fc.averageStabilityDays).toBeNull();
    expect(fc.dailyActivity).toHaveLength(7);
  });

  it("aggregates today, 7-day, and 30-day review counts, rating distribution, due counts, and stability", async () => {
    db.flashcardDeck.findMany.mockResolvedValue([
      { id: "deck-1", cards: [{ id: "card-1" }, { id: "card-2" }, { id: "card-3" }] },
    ]);
    db.flashcardReview.findMany.mockResolvedValue([
      {
        id: "r3",
        flashcardId: "card-1",
        userId: "user-1",
        wasCorrect: true,
        rating: "EASY",
        state: "REVIEW",
        stability: 8.5,
        difficulty: 3.2,
        elapsedDays: 2,
        scheduledDays: 6,
        reps: 2,
        lapses: 0,
        dueAt: new Date("2026-11-17T10:00:00.000Z"),
        reviewedAt: new Date("2026-11-11T10:00:00.000Z"), // today
      },
      {
        id: "r2",
        flashcardId: "card-2",
        userId: "user-1",
        wasCorrect: false,
        rating: "AGAIN",
        state: "RELEARNING",
        stability: 1.5,
        difficulty: 7.0,
        elapsedDays: 3,
        scheduledDays: 0,
        reps: 2,
        lapses: 1,
        dueAt: new Date("2026-11-10T10:10:00.000Z"), // overdue
        reviewedAt: new Date("2026-11-10T10:00:00.000Z"), // within 7 days
      },
      {
        id: "r1",
        flashcardId: "card-1",
        userId: "user-1",
        wasCorrect: true,
        rating: "GOOD",
        state: "REVIEW",
        stability: 3.17,
        difficulty: 5.28,
        elapsedDays: 0,
        scheduledDays: 2,
        reps: 1,
        lapses: 0,
        dueAt: new Date("2026-11-01T10:00:00.000Z"),
        reviewedAt: new Date("2026-10-30T10:00:00.000Z"), // within 30 days, outside 7 days
      },
    ]);

    const fc = await getFlashcardProgress("user-1", undefined, NOW);

    expect(fc.totalDecks).toBe(1);
    expect(fc.totalCards).toBe(3);
    expect(fc.cardsStudied).toBe(2); // card-1 and card-2
    expect(fc.newCount).toBe(1); // card-3
    expect(fc.dueCount).toBe(1); // card-2
    expect(fc.overdueCount).toBe(1); // card-2
    expect(fc.reviewsCompleted).toBe(3);
    expect(fc.reviewsToday).toBe(1);
    expect(fc.reviewsLast7Days).toBe(2);
    expect(fc.reviewsLast30Days).toBe(3);
    expect(fc.correctCount).toBe(2);
    expect(fc.accuracyPercent).toBe(67);
    expect(fc.ratingDistribution).toEqual({
      AGAIN: 1,
      HARD: 0,
      GOOD: 1,
      EASY: 1,
    });
    expect(fc.averageStabilityDays).toBe(5); // (8.5 + 1.5) / 2 = 5
  });

  it("computes quiz mastery tiers and score trend accurately", () => {
    expect(
      computeQuizMastery({
        attempts: 0,
        uniqueQuizzesAttempted: 0,
        latest: null,
        bestScore: null,
        averageScore: null,
        history: [],
      })
    ).toEqual({
      masteryTier: "NONE",
      uniqueQuizzesAttempted: 0,
      recentTrendDelta: null,
    });

    expect(
      computeQuizMastery({
        attempts: 2,
        uniqueQuizzesAttempted: 1,
        latest: {
          id: "a2",
          quizId: "q1",
          quizTitle: "Q1",
          score: 90,
          startedAt: NOW,
          completedAt: NOW,
        },
        bestScore: 90,
        averageScore: 80,
        history: [
          { id: "a2", quizId: "q1", quizTitle: "Q1", score: 90, startedAt: NOW, completedAt: NOW },
          { id: "a1", quizId: "q1", quizTitle: "Q1", score: 70, startedAt: NOW, completedAt: NOW },
        ],
      })
    ).toEqual({
      masteryTier: "MASTERED",
      uniqueQuizzesAttempted: 1,
      recentTrendDelta: 20,
    });
  });

  describe("AUD-13-01: SUSPEND / UNSUSPEND lifecycle event exclusion from review analytics", () => {
    it("excludes a SUSPEND lifecycle event after a normal review from review-history aggregates while preserving suspendedCount = 1", async () => {
      db.flashcardDeck.findMany.mockResolvedValue([
        { id: "deck-1", cards: [{ id: "card-1" }, { id: "card-2" }] },
      ]);
      db.flashcardReview.findMany.mockResolvedValue([
        // Latest row: SUSPEND lifecycle event today
        {
          id: "rev-suspend",
          flashcardId: "card-1",
          userId: "user-1",
          wasCorrect: true,
          rating: null,
          stateBefore: "REVIEW",
          state: "SUSPENDED",
          stability: 2.4,
          difficulty: 4.93,
          elapsedDays: 0,
          scheduledDays: 2,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-13T10:00:00.000Z"),
          reviewedAt: new Date("2026-11-11T12:00:00.000Z"),
        },
        // Prior actual review: GOOD today
        {
          id: "rev-1",
          flashcardId: "card-1",
          userId: "user-1",
          wasCorrect: true,
          rating: "GOOD",
          stateBefore: "NEW",
          state: "REVIEW",
          stability: 2.4,
          difficulty: 4.93,
          elapsedDays: 0,
          scheduledDays: 2,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-13T10:00:00.000Z"),
          reviewedAt: new Date("2026-11-11T10:00:00.000Z"),
        },
      ]);

      const fc = await getFlashcardProgress("user-1", undefined, NOW);

      expect(fc.suspendedCount).toBe(1);
      expect(fc.reviewCount).toBe(0);
      expect(fc.newCount).toBe(1); // card-2
      expect(fc.reviewsCompleted).toBe(1);
      expect(fc.reviewsToday).toBe(1);
      expect(fc.reviewsLast7Days).toBe(1);
      expect(fc.reviewsLast30Days).toBe(1);
      expect(fc.correctCount).toBe(1);
      expect(fc.accuracyPercent).toBe(100);
      expect(fc.ratingDistribution).toEqual({
        AGAIN: 0,
        HARD: 0,
        GOOD: 1,
        EASY: 0,
      });
      const todayBucket = fc.dailyActivity.find((d) => d.date === "2026-11-11");
      expect(todayBucket).toEqual({ date: "2026-11-11", reviews: 1, correct: 1 });
    });

    it("excludes both SUSPEND and UNSUSPEND events when a card is suspended and then unsuspended", async () => {
      db.flashcardDeck.findMany.mockResolvedValue([
        { id: "deck-1", cards: [{ id: "card-1" }] },
      ]);
      db.flashcardReview.findMany.mockResolvedValue([
        // Latest row: UNSUSPEND back to REVIEW
        {
          id: "rev-unsuspend",
          flashcardId: "card-1",
          userId: "user-1",
          wasCorrect: false,
          rating: null,
          stateBefore: "SUSPENDED",
          state: "LEARNING",
          stability: 0.4,
          difficulty: 6.81,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-11T10:10:00.000Z"),
          reviewedAt: new Date("2026-11-11T11:00:00.000Z"),
        },
        // Middle row: SUSPEND
        {
          id: "rev-suspend",
          flashcardId: "card-1",
          userId: "user-1",
          wasCorrect: false,
          rating: null,
          stateBefore: "LEARNING",
          state: "SUSPENDED",
          stability: 0.4,
          difficulty: 6.81,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-11T10:10:00.000Z"),
          reviewedAt: new Date("2026-11-11T10:30:00.000Z"),
        },
        // Original review: AGAIN
        {
          id: "rev-again",
          flashcardId: "card-1",
          userId: "user-1",
          wasCorrect: false,
          rating: "AGAIN",
          stateBefore: "NEW",
          state: "LEARNING",
          stability: 0.4,
          difficulty: 6.81,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-11T10:10:00.000Z"),
          reviewedAt: new Date("2026-11-11T10:00:00.000Z"),
        },
      ]);

      const fc = await getFlashcardProgress("user-1", undefined, NOW);

      expect(fc.suspendedCount).toBe(0);
      expect(fc.learningCount).toBe(1);
      expect(fc.dueCount).toBe(1);
      expect(fc.reviewsCompleted).toBe(1);
      expect(fc.reviewsToday).toBe(1);
      expect(fc.correctCount).toBe(0);
      expect(fc.accuracyPercent).toBe(0);
      expect(fc.ratingDistribution).toEqual({
        AGAIN: 1,
        HARD: 0,
        GOOD: 0,
        EASY: 0,
      });
    });

    it("handles multiple suspend/unsuspend cycles across cards without inflating review or accuracy metrics", async () => {
      db.flashcardDeck.findMany.mockResolvedValue([
        { id: "deck-1", cards: [{ id: "card-1" }, { id: "card-2" }] },
      ]);
      db.flashcardReview.findMany.mockResolvedValue([
        // Card 1: cycle 2 suspend (currently suspended)
        {
          id: "c1-sus-2",
          flashcardId: "card-1",
          userId: "user-1",
          wasCorrect: true,
          rating: null,
          stateBefore: "REVIEW",
          state: "SUSPENDED",
          stability: 5.8,
          difficulty: 3.99,
          elapsedDays: 0,
          scheduledDays: 6,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-17T10:00:00.000Z"),
          reviewedAt: new Date("2026-11-11T14:00:00.000Z"),
        },
        // Card 1: cycle 1 unsuspend
        {
          id: "c1-unsus-1",
          flashcardId: "card-1",
          userId: "user-1",
          wasCorrect: true,
          rating: null,
          stateBefore: "SUSPENDED",
          state: "REVIEW",
          stability: 5.8,
          difficulty: 3.99,
          elapsedDays: 0,
          scheduledDays: 6,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-17T10:00:00.000Z"),
          reviewedAt: new Date("2026-11-11T13:00:00.000Z"),
        },
        // Card 1: cycle 1 suspend
        {
          id: "c1-sus-1",
          flashcardId: "card-1",
          userId: "user-1",
          wasCorrect: true,
          rating: null,
          stateBefore: "REVIEW",
          state: "SUSPENDED",
          stability: 5.8,
          difficulty: 3.99,
          elapsedDays: 0,
          scheduledDays: 6,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-17T10:00:00.000Z"),
          reviewedAt: new Date("2026-11-11T12:00:00.000Z"),
        },
        // Card 1: actual review (EASY)
        {
          id: "c1-rev-1",
          flashcardId: "card-1",
          userId: "user-1",
          wasCorrect: true,
          rating: "EASY",
          stateBefore: "NEW",
          state: "REVIEW",
          stability: 5.8,
          difficulty: 3.99,
          elapsedDays: 0,
          scheduledDays: 6,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-17T10:00:00.000Z"),
          reviewedAt: new Date("2026-11-11T10:00:00.000Z"),
        },
        // Card 2: actual review (AGAIN)
        {
          id: "c2-rev-1",
          flashcardId: "card-2",
          userId: "user-1",
          wasCorrect: false,
          rating: "AGAIN",
          stateBefore: "NEW",
          state: "LEARNING",
          stability: 0.4,
          difficulty: 6.81,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-11T09:10:00.000Z"),
          reviewedAt: new Date("2026-11-11T09:00:00.000Z"),
        },
      ]);

      const fc = await getFlashcardProgress("user-1", undefined, NOW);

      expect(fc.suspendedCount).toBe(1); // card-1 is suspended, card-2 is active learning
      expect(fc.learningCount).toBe(1);
      expect(fc.reviewsCompleted).toBe(2); // only c1-rev-1 and c2-rev-1
      expect(fc.reviewsToday).toBe(2);
      expect(fc.reviewsLast7Days).toBe(2);
      expect(fc.reviewsLast30Days).toBe(2);
      expect(fc.correctCount).toBe(1);
      expect(fc.accuracyPercent).toBe(50);
      expect(fc.ratingDistribution).toEqual({
        AGAIN: 1,
        HARD: 0,
        GOOD: 0,
        EASY: 1,
      });
    });

    it("does not count an unreviewed NEW card that was only suspended as cardsStudied or reviewsCompleted, even if a legacy lifecycle row carried a non-null rating", async () => {
      db.flashcardDeck.findMany.mockResolvedValue([
        { id: "deck-1", cards: [{ id: "card-new-suspended" }, { id: "card-untouched" }] },
      ]);
      db.flashcardReview.findMany.mockResolvedValue([
        {
          id: "sus-only",
          flashcardId: "card-new-suspended",
          userId: "user-1",
          wasCorrect: true,
          rating: "GOOD", // Even if an older pre-AUD-13-01 row copied a rating
          stateBefore: "NEW",
          state: "SUSPENDED",
          stability: 0,
          difficulty: 0,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 0,
          lapses: 0,
          dueAt: null,
          reviewedAt: new Date("2026-11-11T10:00:00.000Z"),
        },
      ]);

      const fc = await getFlashcardProgress("user-1", undefined, NOW);

      expect(fc.totalCards).toBe(2);
      expect(fc.suspendedCount).toBe(1);
      expect(fc.newCount).toBe(1);
      expect(fc.cardsStudied).toBe(0);
      expect(fc.reviewsCompleted).toBe(0);
      expect(fc.correctCount).toBe(0);
      expect(fc.accuracyPercent).toBeNull();
      expect(fc.lastReviewedAt).toBeNull();
      expect(fc.ratingDistribution).toEqual({
        AGAIN: 0,
        HARD: 0,
        GOOD: 0,
        EASY: 0,
      });
    });
  });

  describe("AUD-13-05: Full-set uniqueQuizzesAttempted beyond MAX_HISTORY = 20", () => {
    it("counts all 25 distinct quizzes when 28 attempts span 25 quizzes, while preserving history cap of 20", async () => {
      // 28 attempts across 25 distinct quizzes (quiz-1 .. quiz-25)
      const attemptsAcross25Quizzes = Array.from({ length: 28 }, (_, i) => {
        const quizNum = (i % 25) + 1;
        return attempt({
          id: `att-${i + 1}`,
          quizId: `quiz-${quizNum}`,
          quizTitle: `Quiz ${quizNum}`,
          score: 80 + (i % 15),
          startedAt: new Date(Date.UTC(2026, 10, 1, 0, i, 0)),
        });
      }).reverse();

      db.quizAttempt.findMany.mockResolvedValue(attemptsAcross25Quizzes);

      const progress = await getQuizProgress("user-1", TOPIC_SCOPE);
      const mastery = computeQuizMastery(progress);

      expect(progress.attempts).toBe(28);
      expect(progress.history).toHaveLength(20); // UI payload cap preserved
      expect(progress.uniqueQuizzesAttempted).toBe(25);
      expect(mastery.uniqueQuizzesAttempted).toBe(25);
      expect(mastery.masteryTier).toBe("MASTERED");
    });

    it("uses database-level groupBy and aggregate when available, enforcing userId and scope filters", async () => {
      const aggregateMock = vi.fn().mockResolvedValue({
        _count: { _all: 30 },
        _max: { score: 95 },
        _avg: { score: 84.4 },
      });
      const groupByMock = vi.fn().mockResolvedValue(
        Array.from({ length: 24 }, (_, i) => ({ quizId: `quiz-${i + 1}` }))
      );
      (db.quizAttempt as Record<string, unknown>).aggregate = aggregateMock;
      (db.quizAttempt as Record<string, unknown>).groupBy = groupByMock;

      try {
        const recent20 = Array.from({ length: 20 }, (_, i) =>
          attempt({
            id: `recent-${i}`,
            quizId: "quiz-1", // Even if all 20 recent attempts were on quiz-1!
            score: 90,
          })
        );
        db.quizAttempt.findMany.mockResolvedValue(recent20);

        const progress = await getQuizProgress("user-1", GROUP_SCOPE);
        const mastery = computeQuizMastery(progress);

        expect(aggregateMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: "user-1", quiz: { groupId: "group-1" } },
          })
        );
        expect(groupByMock).toHaveBeenCalledWith({
          by: ["quizId"],
          where: { userId: "user-1", quiz: { groupId: "group-1" } },
        });
        expect(db.quizAttempt.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: "user-1", quiz: { groupId: "group-1" } },
            take: 20,
          })
        );

        expect(progress.attempts).toBe(30);
        expect(progress.history).toHaveLength(20);
        expect(progress.uniqueQuizzesAttempted).toBe(24);
        expect(mastery.uniqueQuizzesAttempted).toBe(24);
      } finally {
        delete (db.quizAttempt as Record<string, unknown>).aggregate;
        delete (db.quizAttempt as Record<string, unknown>).groupBy;
      }
    });

    it("applies subjectId scope filters consistently across aggregate, groupBy, and findMany, and refuses to silently undercount if uniqueQuizzesAttempted is omitted on truncated history", async () => {
      const SUBJECT_SCOPE: ResolvedAIScope = {
        ownerType: "workspace",
        workspaceId: "workspace-1",
        groupId: null,
        subjectId: "subject-42",
        chapterId: null,
        topicId: null,
      };

      const aggregateMock = vi.fn().mockResolvedValue({
        _count: { _all: 22 },
        _max: { score: 88 },
        _avg: { score: 80 },
      });
      const groupByMock = vi.fn().mockResolvedValue(
        Array.from({ length: 21 }, (_, i) => ({ quizId: `quiz-sub-${i + 1}` }))
      );
      (db.quizAttempt as Record<string, unknown>).aggregate = aggregateMock;
      (db.quizAttempt as Record<string, unknown>).groupBy = groupByMock;

      try {
        db.quizAttempt.findMany.mockResolvedValue([attempt({ id: "a1", quizId: "quiz-sub-1", score: 88 })]);

        const progress = await getQuizProgress("user-1", SUBJECT_SCOPE);
        expect(progress.uniqueQuizzesAttempted).toBe(21);
        expect(aggregateMock).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: "user-1", quiz: { subjectId: "subject-42" } },
          })
        );
        expect(groupByMock).toHaveBeenCalledWith({
          by: ["quizId"],
          where: { userId: "user-1", quiz: { subjectId: "subject-42" } },
        });
      } finally {
        delete (db.quizAttempt as Record<string, unknown>).aggregate;
        delete (db.quizAttempt as Record<string, unknown>).groupBy;
      }

      // Guard against silent fallback to truncated history if an untyped caller omits uniqueQuizzesAttempted when attempts > history.length
      expect(() =>
        computeQuizMastery({
          attempts: 25,
          uniqueQuizzesAttempted: undefined as unknown as number,
          latest: null,
          bestScore: 90,
          averageScore: 85,
          history: [
            { id: "a1", quizId: "q1", quizTitle: "Q1", score: 90, startedAt: NOW, completedAt: NOW },
          ],
        })
      ).toThrow(/uniqueQuizzesAttempted/);
    });
  });
});
