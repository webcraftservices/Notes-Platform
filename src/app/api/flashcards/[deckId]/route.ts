import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleFlashcardDeck, NotAuthorizedError } from "@/lib/access";
import { NOT_FOUND, FORBIDDEN, UNAUTHORIZED } from "@/lib/api-response";

/**
 * Returns a generated deck and its cards (with provenance) for anyone
 * `getAccessibleFlashcardDeck` says can reach it — the same owner-or-
 * scope-membership check as every other shared-content read in this app
 * (task §11/§7). Cards come back in the same stable `id asc` order
 * flashcard-generation.ts wrote them in (see that file's doc comment on
 * why `id`, not `createdAt`, is the stable sort key here).
 *
 * Deliberately does NOT include `FlashcardReview` rows at all (task §12/
 * §17 — deck content is shared, review activity is private per user; this
 * phase has no reviewing UI yet, so there's nothing legitimate to return
 * even for the requesting user's own reviews). Add a scoped
 * `reviews: { where: { userId: user.id } }` include only when a future
 * phase actually needs the current user's own review state here — never
 * every reviewer's data.
 */
export async function GET(_req: Request, { params }: { params: { deckId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const deck = await getAccessibleFlashcardDeck(params.deckId, user.id);
    if (!deck) return NOT_FOUND();

    const cards = await db.flashcard.findMany({
      where: { deckId: deck.id },
      orderBy: { id: "asc" },
    });

    return NextResponse.json({ deck: { ...deck, cards } });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
