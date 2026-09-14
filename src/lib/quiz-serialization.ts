import type { Quiz, QuizQuestion } from "@prisma/client";

/**
 * Phase 8.3 — CRITICAL security boundary (task §11/§17): a quiz-taking
 * client must never receive `correctAnswer`, `explanation`, or `sources`
 * before submitting an answer — all three would let someone read the
 * answer off the network response instead of actually answering. This
 * applies to EVERY response that could reach the browser before
 * submission, including the quiz-generation route's own response (the
 * user who just generated the quiz is still a quiz-taking client) — not
 * just `GET /api/quizzes/[quizId]`. `getAccessibleQuiz`/`db.quiz` reads
 * are internal, server-side helpers that legitimately return the full
 * row (submission scoring needs `correctAnswer`); this module is the one
 * place that turns that into what's safe to serialize to a browser
 * before an attempt exists.
 */
export interface PublicQuizQuestion {
  id: string;
  prompt: string;
  questionType: QuizQuestion["questionType"];
  options: { id: string; text: string }[] | null;
  order: number;
}

export interface PublicQuiz {
  id: string;
  title: string;
  quizType: Quiz["quizType"];
  createdAt: Date;
  questions: PublicQuizQuestion[];
}

export function toPublicQuizQuestion(question: QuizQuestion): PublicQuizQuestion {
  return {
    id: question.id,
    prompt: question.prompt,
    questionType: question.questionType,
    options: (question.options as PublicQuizQuestion["options"]) ?? null,
    order: question.order,
  };
}

export function toPublicQuiz(quiz: Quiz & { questions: QuizQuestion[] }): PublicQuiz {
  return {
    id: quiz.id,
    title: quiz.title,
    quizType: quiz.quizType,
    createdAt: quiz.createdAt,
    questions: [...quiz.questions].sort((a, b) => a.order - b.order).map(toPublicQuizQuestion),
  };
}
