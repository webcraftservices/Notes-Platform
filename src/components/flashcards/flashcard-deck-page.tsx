"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FlashcardStudyView, type StudyCard } from "@/components/flashcards/flashcard-study-view";
import { FlashcardDeckView } from "@/components/flashcards/flashcard-deck-view";
import { computeDeckStudyStats, type DeckStudyStats } from "@/lib/srs/study-queue";

/**
 * Phase 8.6 & Phase 13 — Flashcard Deck Page container with shared card state
 * between the interactive FSRS-4.5 "Study" session tab and the "Overview & Manage"
 * tab so rating, suspending, adding, editing, or deleting a card immediately
 * reflects across both views.
 */
export function FlashcardDeckPage({
  deckId,
  title: initialTitle,
  cards: initialCards,
  stats: initialStats,
  canManage = false,
}: {
  deckId: string;
  title: string;
  cards: StudyCard[];
  stats?: DeckStudyStats;
  canManage?: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [cards, setCards] = useState<StudyCard[]>(initialCards);

  const computedStats = statsFromCards(cards, initialStats);

  return (
    <Tabs defaultValue="study">
      <TabsList>
        <TabsTrigger value="study">
          Study {computedStats.dueCount + computedStats.newCount > 0 ? `(${computedStats.dueCount + computedStats.newCount})` : ""}
        </TabsTrigger>
        <TabsTrigger value="overview">Overview ({cards.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="study">
        <FlashcardStudyView
          deckId={deckId}
          title={title}
          cards={cards}
          onCardsChange={setCards}
        />
      </TabsContent>
      <TabsContent value="overview">
        <FlashcardDeckView
          deckId={deckId}
          title={title}
          cards={cards}
          canManage={canManage}
          onTitleChange={setTitle}
          onCardsChange={setCards}
        />
      </TabsContent>
    </Tabs>
  );
}

function statsFromCards(cards: StudyCard[], fallback?: DeckStudyStats): DeckStudyStats {
  try {
    return computeDeckStudyStats(cards);
  } catch {
    return (
      fallback ?? {
        totalCards: cards.length,
        dueCount: 0,
        overdueCount: 0,
        newCount: cards.length,
        learningCount: 0,
        reviewCount: 0,
        suspendedCount: 0,
        studiedCount: 0,
        upcoming7DaysCount: 0,
        nextDueAt: null,
      }
    );
  }
}
