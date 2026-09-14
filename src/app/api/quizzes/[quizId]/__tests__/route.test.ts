import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  quizQuestion: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleQuiz: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

import { GET } from "@/app/api/quizzes/[quizId]/route";

function makeRequest(): Request {
  return new Request("https://example.test/api/quizzes/quiz-1");
}

const QUESTIONS = [
  {
    id: "q2",
    prompt: "Q2?",
    questionType: "MCQ",
    options: [{ id: "a", text: "Option A" }],
    correctAnswer: "a",
    explanation: "Because A.",
    sources: [{ materialId: "m1", label: "Lecture" }],
    order: 1,
  },
  {
    id: "q1",
    prompt: "Q1?",
    questionType: "TRUE_FALSE",
    options: null,
    correctAnswer: true,
    explanation: "Because true.",
    sources: [],
    order: 0,
  },
];

describe("GET /api/quizzes/[quizId]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleQuiz.mockResolvedValue({
      id: "quiz-1",
      title: "Quiz — Zeroth Law",
      quizType: "MIXED",
      createdAt: new Date(),
      ownerId: "user-1",
    });
    db.quizQuestion.findMany.mockResolvedValue(QUESTIONS);
  });

  it("rejects with 401 when there is no authenticated user", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: { quizId: "quiz-1" } });

    expect(res.status).toBe(401);
    expect(access.getAccessibleQuiz).not.toHaveBeenCalled();
  });

  it("returns 404 when the quiz doesn't exist", async () => {
    access.getAccessibleQuiz.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: { quizId: "quiz-1" } });

    expect(res.status).toBe(404);
  });

  it("returns 403 when the quiz exists but the user isn't authorized for it", async () => {
    access.getAccessibleQuiz.mockRejectedValue(new access.NotAuthorizedError());

    const res = await GET(makeRequest(), { params: { quizId: "quiz-1" } });

    expect(res.status).toBe(403);
  });

  it("returns the quiz with questions in stable order for an authorized user", async () => {
    const res = await GET(makeRequest(), { params: { quizId: "quiz-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.quiz.questions.map((q: { id: string }) => q.id)).toEqual(["q1", "q2"]);
    expect(json.quiz.questions[1].options).toEqual([{ id: "a", text: "Option A" }]);
  });

  it("CRITICAL: never exposes correctAnswer, explanation, or sources before an attempt is submitted", async () => {
    const res = await GET(makeRequest(), { params: { quizId: "quiz-1" } });
    const json = await res.json();

    for (const question of json.quiz.questions) {
      expect(question.correctAnswer).toBeUndefined();
      expect(question.explanation).toBeUndefined();
      expect(question.sources).toBeUndefined();
    }
  });

  it("never returns QuizAttempt rows — quiz content is shared, attempts are private", async () => {
    const res = await GET(makeRequest(), { params: { quizId: "quiz-1" } });
    const json = await res.json();

    expect(json.quiz.attempts).toBeUndefined();
  });
});
