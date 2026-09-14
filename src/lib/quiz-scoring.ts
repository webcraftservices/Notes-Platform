import type { QuizQuestion } from "@prisma/client";

/**
 * Phase 8.3 server-side scoring (task §12/§13). Never trust a
 * client-submitted score or correct/incorrect flag — this is the ONLY
 * place a QuizAttempt's score is computed, always against the persisted
 * `QuizQuestion.correctAnswer`.
 *
 * Deterministic, conservative comparison per `questionType` (task §13
 * explicitly rules out a second AI call for grading):
 * - MCQ: submitted must be the exact option id string.
 * - TRUE_FALSE: submitted must be the exact boolean.
 * - SHORT_ANSWER: normalized exact match — trim + case-insensitive.
 *
 * A type mismatch (e.g. a boolean submitted for an MCQ question) or a
 * missing answer is simply "incorrect", never a thrown error — the
 * client is untrusted input, not a contract violation worth crashing on.
 */
export function isAnswerCorrect(question: Pick<QuizQuestion, "questionType" | "correctAnswer">, submitted: unknown): boolean {
  switch (question.questionType) {
    case "MCQ":
      return typeof submitted === "string" && submitted === question.correctAnswer;
    case "TRUE_FALSE":
      return typeof submitted === "boolean" && submitted === question.correctAnswer;
    case "SHORT_ANSWER":
      return (
        typeof submitted === "string" &&
        typeof question.correctAnswer === "string" &&
        submitted.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase()
      );
    default:
      // MIXED is a quiz-level composition value, never one question's own
      // type (see quizQuestionGenerationItemSchema's doc comment) — this
      // branch should be unreachable for a real persisted question, but
      // fails closed (incorrect) rather than throwing if it ever isn't.
      return false;
  }
}

export interface QuizQuestionResult {
  questionId: string;
  submittedAnswer: unknown;
  correct: boolean;
  correctAnswer: unknown;
  explanation: string | null;
  sources: unknown;
}

export interface QuizScoreResult {
  results: QuizQuestionResult[];
  totalQuestions: number;
  correctCount: number;
  /** Percentage 0-100, matching `QuizAttempt.score`'s existing column semantics. */
  score: number;
}

/**
 * Scores a full attempt against the quiz's real questions. `answers`
 * should already be filtered to only this quiz's own question ids by the
 * caller (task §12 step 4 — "ignore questions that do not belong to the
 * Quiz") before being passed in here; this function doesn't re-check
 * that, since it only ever iterates `questions`, never `answers`' own
 * keys, so an extra/unknown key in `answers` is naturally never scored.
 */
export function scoreQuizAttempt(
  questions: QuizQuestion[],
  answers: Record<string, unknown>
): QuizScoreResult {
  const results: QuizQuestionResult[] = questions.map((question) => {
    const hasAnswer = Object.prototype.hasOwnProperty.call(answers, question.id);
    const submittedAnswer = hasAnswer ? answers[question.id] : null;
    const correct = hasAnswer && isAnswerCorrect(question, submittedAnswer);

    return {
      questionId: question.id,
      submittedAnswer,
      correct,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      sources: question.sources,
    };
  });

  const totalQuestions = questions.length;
  const correctCount = results.filter((r) => r.correct).length;
  const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  return { results, totalQuestions, correctCount, score };
}
