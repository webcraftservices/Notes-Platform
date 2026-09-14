import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleQuiz, NotAuthorizedError } from "@/lib/access";
import { submitQuizAttemptSchema } from "@/lib/validation/quiz-attempt";
import { scoreQuizAttempt } from "@/lib/quiz-scoring";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

/**
 * Server-authoritative scoring (task §12/§17's "never trust... client
 * score, client correct/incorrect flags"). The browser sends only raw
 * answers keyed by question id; everything about correctness, the
 * percentage score, and the revealed `correctAnswer`/`explanation`/
 * `sources` comes from this response, computed here against the
 * persisted `QuizQuestion` rows — never from anything the client claims.
 *
 * `QuizAttempt` is always created for `user.id` (task §14) — there is no
 * way for the request body to attribute an attempt to anyone else, and
 * nothing here ever reads another user's `QuizAttempt` rows.
 */
export async function POST(req: Request, { params }: { params: { quizId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = submitQuizAttemptSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const quiz = await getAccessibleQuiz(params.quizId, user.id);
    if (!quiz) return NOT_FOUND();

    const questions = await db.quizQuestion.findMany({ where: { quizId: quiz.id } });

    // Ignore any submitted key that isn't actually one of this quiz's own
    // questions (task §12 step 4) — build the answers map FROM the real
    // question ids, never from the client's own key set.
    const questionIds = new Set(questions.map((q: { id: string }) => q.id));
    const scopedAnswers: Record<string, unknown> = {};
    for (const [questionId, answer] of Object.entries(parsed.data.answers)) {
      if (questionIds.has(questionId)) scopedAnswers[questionId] = answer;
    }

    const { results, totalQuestions, correctCount, score } = scoreQuizAttempt(questions, scopedAnswers);

    const attempt = await db.quizAttempt.create({
      data: {
        quizId: quiz.id,
        userId: user.id,
        answers: JSON.parse(JSON.stringify(scopedAnswers)),
        score,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      attempt: { id: attempt.id, score, correctCount, totalQuestions, completedAt: attempt.completedAt },
      results,
    });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
