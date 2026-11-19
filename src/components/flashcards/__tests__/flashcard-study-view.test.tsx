import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FlashcardStudyView,
  formatLearningStateBadge,
  type StudyCard,
} from "@/components/flashcards/flashcard-study-view";
import { FlashcardDeckView } from "@/components/flashcards/flashcard-deck-view";
import { StudyActivityWidget } from "@/components/dashboard/study-activity-widget";
import { createEmptyFlashcardProgress } from "@/lib/study-progress";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Phase 13 Flashcard & Study UI Components", () => {
  it("formatLearningStateBadge maps all 5 CardLearningState values accurately", () => {
    expect(formatLearningStateBadge("NEW")).toEqual({ label: "New", variant: "accent" });
    expect(formatLearningStateBadge("LEARNING")).toEqual({ label: "Learning", variant: "default" });
    expect(formatLearningStateBadge("RELEARNING")).toEqual({ label: "Relearning", variant: "default" });
    expect(formatLearningStateBadge("REVIEW")).toEqual({ label: "Review", variant: "success" });
    expect(formatLearningStateBadge("SUSPENDED")).toEqual({ label: "Suspended", variant: "muted" });
  });

  it("FlashcardStudyView renders empty state when deck has 0 cards", () => {
    const html = renderToStaticMarkup(
      <FlashcardStudyView deckId="deck-1" title="Empty Deck" cards={[]} />
    );
    expect(html).toContain("No cards in this deck yet");
  });

  it("FlashcardStudyView renders deck queue badges, study mode selector, progress bar, question, and Space shortcut hint", () => {
    const cards: StudyCard[] = [
      {
        id: "card-1",
        front: "What is the First Law of Thermodynamics?",
        back: "Conservation of energy (dU = dQ - dW)",
        sources: [{ materialId: "mat-1", label: "Lecture 1 — Slide 4", page: 4 }],
        review: null,
      },
      {
        id: "card-2",
        front: "What is entropy?",
        back: "S = k_B ln(W)",
        sources: null,
        review: {
          id: "rev-1",
          wasCorrect: true,
          rating: "GOOD",
          state: "REVIEW",
          reviewedAt: new Date("2026-11-01T10:00:00.000Z").toISOString(),
        },
      },
    ];

    const html = renderToStaticMarkup(
      <FlashcardStudyView deckId="deck-1" title="Thermodynamics" cards={cards} />
    );

    expect(html).toContain("Thermodynamics");
    expect(html).toContain("Due:");
    expect(html).toContain("New: 1");
    expect(html).toContain("Due &amp; New");
    expect(html).toContain("All Cards");
    expect(html).toContain("Reveal answer");
    expect(html).toContain("Space");
    expect(html).toContain("Suspend");
  });

  it("FlashcardDeckView renders card learning state badges, provenance links, and management controls when canManage=true", () => {
    const cards: StudyCard[] = [
      {
        id: "card-1",
        front: "Question 1",
        back: "Answer 1",
        sources: [{ materialId: "mat-1", label: "Source PDF p.2", page: 2 }],
        review: null,
      },
    ];

    const html = renderToStaticMarkup(
      <FlashcardDeckView
        deckId="deck-1"
        title="Bio Deck"
        cards={cards}
        canManage={true}
      />
    );

    expect(html).toContain("Bio Deck");
    expect(html).toContain("Add card");
    expect(html).toContain("Question 1");
    expect(html).toContain("Answer 1");
    expect(html).toContain("Source PDF p.2");
    expect(html).toContain("New");
  });

  it("StudyActivityWidget renders flashcard review and due counts alongside quiz and tutor stats", () => {
    const fc = createEmptyFlashcardProgress(new Date("2026-11-11T12:00:00.000Z"));
    fc.totalDecks = 2;
    fc.totalCards = 15;
    fc.reviewsCompleted = 24;
    fc.dueCount = 5;
    fc.lastReviewedAt = new Date("2026-11-11T11:30:00.000Z");

    const html = renderToStaticMarkup(
      <StudyActivityWidget
        progress={{
          quizzes: {
            attempts: 3,
            uniqueQuizzesAttempted: 2,
            latest: null,
            bestScore: 90,
            averageScore: 82,
            history: [],
          },
          tutor: {
            sessions: 2,
            messages: 10,
            lastActiveAt: new Date("2026-11-10T10:00:00.000Z"),
          },
          flashcards: fc,
        }}
      />
    );

    expect(html).toContain("Flashcard reviews");
    expect(html).toContain("24");
    expect(html).toContain("Cards due today");
    expect(html).toContain("5");
    expect(html).toContain("Quiz attempts");
    expect(html).toContain("82%");
  });
});
