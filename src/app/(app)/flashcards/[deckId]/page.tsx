import { requireUser, requireFlashcardDeck } from "@/lib/access";
import { db } from "@/lib/db";
import { deriveCardStateFromReview, type PersistedReviewRecord } from "@/lib/srs/fsrs";
import { computeDeckStudyStats, serializeCardSchedule } from "@/lib/srs/study-queue";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { FlashcardDeckPage as FlashcardDeckPageView } from "@/components/flashcards/flashcard-deck-page";

/**
 * Phase 8.6 & Phase 13: Loads a flashcard deck with the authenticated user's
 * own latest `FlashcardReview` and derived FSRS-4.5 `schedule` per card, plus
 * deck-level study statistics (`dueCount`, `newCount`, `learningCount`,
 * `reviewCount`, `suspendedCount`).
 */
export default async function FlashcardDeckPage({ params }: { params: { deckId: string } }) {
  const user = await requireUser();
  const deck = await requireFlashcardDeck(params.deckId, user.id);

  const cards = await db.flashcard.findMany({
    where: { deckId: deck.id },
    orderBy: { id: "asc" },
    include: {
      reviews: {
        where: { userId: user.id },
        orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
  });

  const now = new Date();
  const mappedCards = cards.map(({ reviews, ...card }: (typeof cards)[number]) => {
    const latestReview = reviews[0] ?? null;
    const stateObj = deriveCardStateFromReview(
      latestReview as unknown as PersistedReviewRecord | null
    );
    const schedule = serializeCardSchedule(stateObj, now);

    return {
      id: card.id,
      front: card.front,
      back: card.back,
      sources: card.sources as DeckCardSources,
      review: latestReview
        ? {
            id: latestReview.id,
            wasCorrect: latestReview.wasCorrect,
            rating: latestReview.rating ?? null,
            state: stateObj.state,
            reviewedAt: latestReview.reviewedAt.toISOString(),
          }
        : null,
      schedule,
    };
  });

  const stats = computeDeckStudyStats(mappedCards, now);
  const canManage = deck.ownerId === user.id;

  return (
    <>
      <Topbar>
        <Breadcrumbs trail={[{ label: "Home", href: "/home" }, { label: deck.title }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <FlashcardDeckPageView
            deckId={deck.id}
            title={deck.title}
            cards={mappedCards}
            stats={stats}
            canManage={canManage}
          />
        </div>
      </main>
    </>
  );
}

type DeckCardSources = { materialId: string; label: string; timestampSeconds?: number; page?: number }[] | null;
