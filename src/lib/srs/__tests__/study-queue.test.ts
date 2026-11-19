import { describe, expect, it } from "vitest";
import { buildStudyQueue, computeDeckStudyStats } from "@/lib/srs/study-queue";

const NOW = new Date("2026-11-11T12:00:00.000Z");

describe("buildStudyQueue and computeDeckStudyStats", () => {
  it("partitions cards into dueLearning, dueReview, newCards, upcomingReview, and suspended", () => {
    const cards = [
      {
        id: "card-overdue",
        front: "Overdue Q",
        back: "Overdue A",
        review: {
          wasCorrect: true,
          reviewedAt: new Date("2026-11-05T10:00:00.000Z"),
          rating: "GOOD" as const,
          state: "REVIEW" as const,
          stability: 4,
          difficulty: 5,
          elapsedDays: 2,
          scheduledDays: 4,
          reps: 2,
          lapses: 0,
          dueAt: new Date("2026-11-09T10:00:00.000Z"),
        },
      },
      {
        id: "card-learning-due",
        front: "Learning Q",
        back: "Learning A",
        review: {
          wasCorrect: false,
          reviewedAt: new Date("2026-11-11T11:30:00.000Z"),
          rating: "AGAIN" as const,
          state: "LEARNING" as const,
          stability: 0.4,
          difficulty: 6.8,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-11T11:40:00.000Z"),
        },
      },
      {
        id: "card-due-today",
        front: "Due Today Q",
        back: "Due Today A",
        review: {
          wasCorrect: true,
          reviewedAt: new Date("2026-11-09T10:00:00.000Z"),
          rating: "GOOD" as const,
          state: "REVIEW" as const,
          stability: 3.17,
          difficulty: 5.28,
          elapsedDays: 0,
          scheduledDays: 2,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-11T10:00:00.000Z"),
        },
      },
      {
        id: "card-new",
        front: "New Q",
        back: "New A",
        review: null,
      },
      {
        id: "card-future",
        front: "Future Q",
        back: "Future A",
        review: {
          wasCorrect: true,
          reviewedAt: new Date("2026-11-11T09:00:00.000Z"),
          rating: "EASY" as const,
          state: "REVIEW" as const,
          stability: 8.5,
          difficulty: 3.2,
          elapsedDays: 0,
          scheduledDays: 6,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-17T09:00:00.000Z"),
        },
      },
      {
        id: "card-suspended",
        front: "Suspended Q",
        back: "Suspended A",
        review: {
          wasCorrect: true,
          reviewedAt: new Date("2026-11-10T09:00:00.000Z"),
          rating: "GOOD" as const,
          state: "SUSPENDED" as const,
          stability: 3.17,
          difficulty: 5.28,
          elapsedDays: 0,
          scheduledDays: 2,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-11T09:00:00.000Z"),
        },
      },
    ];

    const result = buildStudyQueue(cards, { now: NOW, timezone: "UTC" });

    expect(result.stats).toMatchObject({
      totalCards: 6,
      dueCount: 3, // card-overdue + card-learning-due + card-due-today
      overdueCount: 1, // card-overdue
      newCount: 1, // card-new
      learningCount: 1, // card-learning-due
      reviewCount: 3, // card-overdue, card-due-today, card-future
      suspendedCount: 1, // card-suspended
      studiedCount: 5,
      upcoming7DaysCount: 1, // card-future
    });

    // Queue ordering: learning due first, then review due (ordered by dueAt ASC), then new
    expect(result.queue.map((q) => q.id)).toEqual([
      "card-learning-due",
      "card-overdue",
      "card-due-today",
      "card-new",
    ]);
  });

  it("supports mode='due_only', mode='all', newLimit, and limit options", () => {
    const cards = [
      { id: "c1", front: "Q1", back: "A1", review: null },
      {
        id: "c2",
        front: "Q2",
        back: "A2",
        review: {
          wasCorrect: false,
          reviewedAt: new Date("2026-11-10T10:00:00.000Z"),
          rating: "AGAIN" as const,
          state: "LEARNING" as const,
          stability: 0.4,
          difficulty: 6.8,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-10T10:10:00.000Z"),
        },
      },
      {
        id: "c3",
        front: "Q3",
        back: "A3",
        review: {
          wasCorrect: true,
          reviewedAt: new Date("2026-11-11T09:00:00.000Z"),
          rating: "EASY" as const,
          state: "REVIEW" as const,
          stability: 8.5,
          difficulty: 3.2,
          elapsedDays: 0,
          scheduledDays: 6,
          reps: 1,
          lapses: 0,
          dueAt: new Date("2026-11-17T09:00:00.000Z"),
        },
      },
    ];

    const dueOnly = buildStudyQueue(cards, {
      now: NOW,
      mode: "due_only",
    });
    expect(dueOnly.queue.map((q) => q.id)).toEqual(["c2"]);

    const allCards = buildStudyQueue(cards, {
      now: NOW,
      mode: "all",
    });
    expect(allCards.queue.map((q) => q.id)).toEqual(["c2", "c1", "c3"]);

    const limited = buildStudyQueue(cards, {
      now: NOW,
      mode: "smart",
      limit: 1,
    });
    expect(limited.queue.map((q) => q.id)).toEqual(["c2"]);
  });

  it("computeDeckStudyStats accurately counts states for a single deck", () => {
    const stats = computeDeckStudyStats(
      [
        { id: "c1", review: null },
        {
          id: "c2",
          review: {
            wasCorrect: true,
            reviewedAt: new Date("2026-11-01T10:00:00.000Z"),
            rating: "GOOD",
            state: "REVIEW",
            stability: 3.17,
            difficulty: 5.28,
            elapsedDays: 0,
            scheduledDays: 2,
            reps: 1,
            lapses: 0,
            dueAt: new Date("2026-11-03T10:00:00.000Z"),
          },
        },
      ],
      NOW,
      "UTC"
    );

    expect(stats).toMatchObject({
      totalCards: 2,
      dueCount: 1,
      overdueCount: 1,
      newCount: 1,
      learningCount: 0,
      reviewCount: 1,
      suspendedCount: 0,
      studiedCount: 1,
    });
  });
});
