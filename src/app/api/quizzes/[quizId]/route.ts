import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleQuiz, NotAuthorizedError } from "@/lib/access";
import { NOT_FOUND, FORBIDDEN, UNAUTHORIZED } from "@/lib/api-response";
import { toPublicQuiz } from "@/lib/quiz-serialization";

/**
 * Returns a quiz ready to take: same owner-or-scope-membership access as
 * every other shared-content read (`getAccessibleQuiz`, mirroring
 * `getAccessibleFlashcardDeck`). `toPublicQuiz` (lib/quiz-serialization.ts)
 * is the critical part — it strips `correctAnswer`/`explanation`/
 * `sources` from every question before this ever reaches the browser
 * (task §11's CRITICAL SECURITY REQUIREMENT).
 *
 * Never includes `QuizAttempt` rows (task §14/§17 — quiz content is
 * shared, attempts are private per user; this phase's result is returned
 * inline by the submission response, not re-fetched here).
 */
export async function GET(_req: Request, { params }: { params: { quizId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const quiz = await getAccessibleQuiz(params.quizId, user.id);
    if (!quiz) return NOT_FOUND();

    const questions = await db.quizQuestion.findMany({
      where: { quizId: quiz.id },
      orderBy: { order: "asc" },
    });

    return NextResponse.json({ quiz: toPublicQuiz({ ...quiz, questions }) });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
