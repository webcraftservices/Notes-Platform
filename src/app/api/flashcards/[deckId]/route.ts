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
 * Phase 8.6: each card also carries the *authenticated user's own*
 * latest `review` (or `null` if they've never reviewed it) — deck
 * content stays shared, but review activity stays private per user
 * (task's Group Privacy section). The Prisma `include` is scoped with
 * `where: { userId: user.id }`, so this can never fetch — let alone
 * leak — another reviewer's rows; `take: 1` + `orderBy: reviewedAt desc`
 * gives just the latest event, never the full history, since only
 * current card state is needed here. `reviews` (the raw scoped array)
 * is stripped from the response in favor of a single `review` field so
 * nothing about the plural-array shape leaks into the API contract.
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
      include: {
        reviews: {
          where: { userId: user.id },
          orderBy: { reviewedAt: "desc" },
          take: 1,
        },
      },
    });

    const cardsWithOwnReview = cards.map(({ reviews, ...card }: (typeof cards)[number]) => ({
      ...card,
      review: reviews[0] ?? null,
    }));

    return NextResponse.json({ deck: { ...deck, cards: cardsWithOwnReview } });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
