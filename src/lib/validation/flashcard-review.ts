import { z } from "zod";
import { REVIEW_RATINGS } from "@/lib/srs/fsrs";

/**
 * Phase 8.6 & Phase 13 — `POST /api/flashcards/[deckId]/reviews` request body.
 *
 * Accepts:
 * - `flashcardId`: required non-empty card ID (verified against `deckId` server-side).
 * - `rating`: optional FSRS-4.5 4-point rating (`AGAIN | HARD | GOOD | EASY`).
 * - `wasCorrect`: optional legacy binary correctness boolean (`true` = Known, `false` = Not Known).
 * - `action`: optional lifecycle action (`REVIEW` default, `SUSPEND`, `UNSUSPEND`).
 * - `idempotencyKey`: optional client-generated token to prevent duplicate review corruption on retries.
 *
 * Deliberately no `userId`, `stability`, `difficulty`, or `dueAt` fields exist here:
 * user identity always comes from `getSessionUser()`, and scheduling parameters are
 * computed exclusively server-side.
 */
export const submitFlashcardReviewSchema = z
  .object({
    flashcardId: z.string().min(1),
    wasCorrect: z.boolean().optional(),
    rating: z.enum(REVIEW_RATINGS).optional(),
    action: z.enum(["REVIEW", "SUSPEND", "UNSUSPEND"]).optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((val, ctx) => {
    const action = val.action ?? "REVIEW";
    if (action === "REVIEW" && val.wasCorrect === undefined && val.rating === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either `rating` (AGAIN, HARD, GOOD, EASY) or `wasCorrect` (boolean) is required.",
        path: ["wasCorrect"],
      });
    }
  });

export type SubmitFlashcardReviewInput = z.infer<typeof submitFlashcardReviewSchema>;

/**
 * Query parameters for `GET /api/flashcards/due` (Phase 13 Task 13-02).
 */
export const dueFlashcardsQuerySchema = z.object({
  subjectId: z.string().trim().min(1).optional(),
  chapterId: z.string().trim().min(1).optional(),
  topicId: z.string().trim().min(1).optional(),
  groupId: z.string().trim().min(1).optional(),
  deckId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  newLimit: z.coerce.number().int().min(0).max(100).optional(),
  includeNew: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export type DueFlashcardsQueryInput = z.infer<typeof dueFlashcardsQuerySchema>;

/**
 * Payloads for creating/updating flashcards and decks (Phase 13 study organization).
 */
export const createFlashcardSchema = z.object({
  front: z.string().trim().min(1).max(2000),
  back: z.string().trim().min(1).max(4000),
});

export const updateFlashcardSchema = z
  .object({
    front: z.string().trim().min(1).max(2000).optional(),
    back: z.string().trim().min(1).max(4000).optional(),
  })
  .refine((data) => data.front !== undefined || data.back !== undefined, {
    message: "At least one of `front` or `back` must be provided.",
  });

export const updateFlashcardDeckSchema = z.object({
  title: z.string().trim().min(1).max(200),
});
