import { z } from "zod";

/**
 * Phase 8.3 — `POST /api/quizzes/[quizId]/attempts` request body. Keys
 * are question ids exactly as the client received them from `GET
 * /api/quizzes/[quizId]` (lib/quiz-serialization.ts); the route (not this
 * schema) is responsible for ignoring any key that isn't actually one of
 * this quiz's own questions (task §12 step 4) — this schema only checks
 * shape, not membership, since it has no database access.
 */
export const submitQuizAttemptSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.boolean()])),
});

export type SubmitQuizAttemptInput = z.infer<typeof submitQuizAttemptSchema>;
