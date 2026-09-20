import { z } from "zod";
import { rejectPrototypePollution } from "@/lib/validation/safe-json";

/**
 * Phase 8.3 — `POST /api/quizzes/[quizId]/attempts` request body. Keys
 * are question ids exactly as the client received them from `GET
 * /api/quizzes/[quizId]` (lib/quiz-serialization.ts); the route (not this
 * schema) is responsible for ignoring any key that isn't actually one of
 * this quiz's own questions (task §12 step 4) — this schema only checks
 * shape, not membership, since it has no database access.
 */
export const submitQuizAttemptSchema = z.object({
  // Phase 9.3: same __proto__/constructor/prototype guard as note block
  // content (lib/validation/safe-json.ts) — lower severity here since
  // values are constrained to string/boolean, but the same shape of risk
  // at negligible extra cost.
  answers: rejectPrototypePollution(z.record(z.string(), z.union([z.string(), z.boolean()]))),
});

export type SubmitQuizAttemptInput = z.infer<typeof submitQuizAttemptSchema>;
