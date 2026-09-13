import { requireUser, requireFlashcardDeck } from "@/lib/access";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { FlashcardDeckView } from "@/components/flashcards/flashcard-deck-view";

/**
 * Phase 8.2's minimal deck page (task §10) — proves the generated deck is
 * real and reachable, nothing more. `requireFlashcardDeck` is the same
 * owner-or-scope-membership check `getAccessibleFlashcardDeck` performs
 * for the API route (lib/access.ts), so a deck attached to a Group only
 * renders for someone with access to that Group, exactly like every other
 * shared-content page in this app.
 */
export default async function FlashcardDeckPage({ params }: { params: { deckId: string } }) {
  const user = await requireUser();
  const deck = await requireFlashcardDeck(params.deckId, user.id);

  const cards = await db.flashcard.findMany({
    where: { deckId: deck.id },
    orderBy: { id: "asc" },
  });

  return (
    <>
      <Topbar>
        <Breadcrumbs trail={[{ label: "Home", href: "/home" }, { label: deck.title }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <FlashcardDeckView
            title={deck.title}
            cards={cards.map((card: typeof cards[number]) => ({
              id: card.id,
              front: card.front,
              back: card.back,
              sources: card.sources as DeckCardSources,
            }))}
          />
        </div>
      </main>
    </>
  );
}

type DeckCardSources = { materialId: string; label: string; timestampSeconds?: number; page?: number }[] | null;
