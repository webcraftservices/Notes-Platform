"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FlashcardStudyView, type StudyCard } from "@/components/flashcards/flashcard-study-view";
import { FlashcardDeckView } from "@/components/flashcards/flashcard-deck-view";

/**
 * Phase 8.6 — the deck page had no tab structure before this phase (the
 * Phase 8.2 page rendered `FlashcardDeckView` directly), so this adds the
 * smallest structure that fits: reuse the existing `Tabs` primitive
 * (already used by `TopicTabs`/`SubjectTabs`/`ChapterTabs`/`GroupTabs`)
 * rather than inventing a new pattern. "Study" is the default/primary
 * tab per the task's core flow; "Overview" keeps the Phase 8.2
 * browse-all-cards view available for anyone who just wants to inspect
 * the generated cards without starting a review session.
 */
export function FlashcardDeckPage({ deckId, title, cards }: { deckId: string; title: string; cards: StudyCard[] }) {
  return (
    <Tabs defaultValue="study">
      <TabsList>
        <TabsTrigger value="study">Study</TabsTrigger>
        <TabsTrigger value="overview">Overview</TabsTrigger>
      </TabsList>
      <TabsContent value="study">
        <FlashcardStudyView deckId={deckId} title={title} cards={cards} />
      </TabsContent>
      <TabsContent value="overview">
        <FlashcardDeckView title={title} cards={cards} />
      </TabsContent>
    </Tabs>
  );
}
