import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleFlashcardDeck, NotAuthorizedError } from "@/lib/access";
import { submitFlashcardReviewSchema } from "@/lib/validation/flashcard-review";
import { jsonError, zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

/**
 * Phase 8.6 — records one FlashcardReview event for the study loop's
 * "Known" / "Not Known" action (task's Flashcard Review Semantics
 * section: Known → wasCorrect true, Not Known → wasCorrect false).
 *
 * Mirrors `POST /api/quizzes/[quizId]/attempts`'s authorization shape
 * exactly: `getAccessibleFlashcardDeck` is the same owner-or-scope-
 * membership check the GET route already uses, so deck content access
 * (shared) is enforced identically here. `userId` is never read from the
 * request body — the schema doesn't even accept one — it always comes
 * from the authenticated session (task's Review Ownership / IDOR
 * Protection sections), so there is no way for a client to attribute a
 * review to anyone but themselves.
 *
 * `flashcardId` is additionally checked against `deck.id` before any
 * write happens (`findFirst({ where: { id, deckId } })`) — a flashcard id
 * that's real but belongs to a *different* deck the caller can also
 * access does not pass, closing the flashcardId-IDOR path the task calls
 * out explicitly. Multiple reviews for the same card are intentionally
 * allowed (append-only history) — no uniqueness constraint, no upsert, no
 * spaced-repetition scheduling of any kind.
 */
export async function POST(req: Request, { params }: { params: { deckId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = submitFlashcardReviewSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const deck = await getAccessibleFlashcardDeck(params.deckId, user.id);
    if (!deck) return NOT_FOUND();

    const flashcard = await db.flashcard.findFirst({
      where: { id: parsed.data.flashcardId, deckId: deck.id },
    });
    if (!flashcard) return jsonError("This flashcard doesn't belong to this deck.", 400);

    const review = await db.flashcardReview.create({
      data: {
        flashcardId: flashcard.id,
        userId: user.id,
        wasCorrect: parsed.data.wasCorrect,
      },
    });

    return NextResponse.json({
      review: { id: review.id, flashcardId: review.flashcardId, wasCorrect: review.wasCorrect, reviewedAt: review.reviewedAt },
    });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
