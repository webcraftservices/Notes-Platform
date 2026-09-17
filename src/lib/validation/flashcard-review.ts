import { z } from "zod";

/**
 * Phase 8.6 — `POST /api/flashcards/[deckId]/reviews` request body. Only
 * `flashcardId` and `wasCorrect` are accepted; deliberately no `userId`
 * field exists here at all, so there is nothing for a client to submit
 * that could ever attribute a review to anyone but the authenticated
 * session user (the route derives `userId` itself — see that file). This
 * schema only checks shape, not whether `flashcardId` actually belongs to
 * the deck in the URL — the route is responsible for that membership
 * check since it needs database access to perform it.
 */
export const submitFlashcardReviewSchema = z.object({
  flashcardId: z.string().min(1),
  wasCorrect: z.boolean(),
});

export type SubmitFlashcardReviewInput = z.infer<typeof submitFlashcardReviewSchema>;
