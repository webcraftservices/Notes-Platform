import { requireUser, requireFlashcardDeck } from "@/lib/access";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { FlashcardDeckPage as FlashcardDeckPageView } from "@/components/flashcards/flashcard-deck-page";

/**
 * Phase 8.6: extends the Phase 8.2 minimal deck page (task §10) with the
 * same current-user-only latest-review scoping the API route's GET now
 * does (see `src/app/api/flashcards/[deckId]/route.ts`'s doc comment) —
 * `reviews: { where: { userId: user.id }, orderBy: { reviewedAt: "desc" },
 * take: 1 }` can never fetch another user's review rows. `requireFlashcardDeck`
 * remains the same owner-or-scope-membership check `getAccessibleFlashcardDeck`
 * performs for the API route, so a deck attached to a Group only renders
 * for someone with access to that Group, exactly like every other
 * shared-content page in this app.
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
        orderBy: { reviewedAt: "desc" },
        take: 1,
      },
    },
  });

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
            cards={cards.map(({ reviews, ...card }: (typeof cards)[number]) => ({
              id: card.id,
              front: card.front,
              back: card.back,
              sources: card.sources as DeckCardSources,
              review: reviews[0]
                ? { id: reviews[0].id, wasCorrect: reviews[0].wasCorrect, reviewedAt: reviews[0].reviewedAt.toISOString() }
                : null,
            }))}
          />
        </div>
      </main>
    </>
  );
}

type DeckCardSources = { materialId: string; label: string; timestampSeconds?: number; page?: number }[] | null;
