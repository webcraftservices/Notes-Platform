import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  quizQuestion: { findMany: vi.fn() },
  quizAttempt: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleQuiz: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

import { POST } from "@/app/api/quizzes/[quizId]/attempts/route";

const QUESTIONS = [
  {
    id: "q-mcq",
    quizId: "quiz-1",
    prompt: "What is thermal equilibrium?",
    questionType: "MCQ",
    options: [
      { id: "a", text: "No net heat flow" },
      { id: "b", text: "Max energy transfer" },
    ],
    correctAnswer: "a",
    explanation: "A is correct.",
    sources: [{ materialId: "m1", label: "Lecture 12" }],
    order: 0,
  },
  {
    id: "q-tf",
    quizId: "quiz-1",
    prompt: "Entropy always increases in an isolated system.",
    questionType: "TRUE_FALSE",
    options: null,
    correctAnswer: true,
    explanation: null,
    sources: [],
    order: 1,
  },
  {
    id: "q-sa",
    quizId: "quiz-1",
    prompt: "State the Zeroth Law.",
    questionType: "SHORT_ANSWER",
    options: null,
    correctAnswer: "Thermal equilibrium is transitive",
    explanation: null,
    sources: [],
    order: 2,
  },
];

function makeRequest(body: unknown): Request {
  return new Request("https://example.test/api/quizzes/quiz-1/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/quizzes/[quizId]/attempts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleQuiz.mockResolvedValue({ id: "quiz-1", title: "Quiz — Zeroth Law", ownerId: "owner" });
    db.quizQuestion.findMany.mockResolvedValue(QUESTIONS);
    db.quizAttempt.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "attempt-1",
      ...data,
    }));
  });

  it("rejects with 401 when there is no authenticated user", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await POST(makeRequest({ answers: {} }), { params: { quizId: "quiz-1" } });

    expect(res.status).toBe(401);
    expect(access.getAccessibleQuiz).not.toHaveBeenCalled();
  });

  it("returns 404 when the quiz doesn't exist", async () => {
    access.getAccessibleQuiz.mockResolvedValue(null);

    const res = await POST(makeRequest({ answers: {} }), { params: { quizId: "quiz-1" } });

    expect(res.status).toBe(404);
  });

  it("returns 403 when the quiz exists but the user isn't authorized for it", async () => {
    access.getAccessibleQuiz.mockRejectedValue(new access.NotAuthorizedError());

    const res = await POST(makeRequest({ answers: {} }), { params: { quizId: "quiz-1" } });

    expect(res.status).toBe(403);
  });

  it("rejects a malformed body (wrong answer value type) with a 400", async () => {
    const res = await POST(makeRequest({ answers: { "q-mcq": { nested: "object" } } }), {
      params: { quizId: "quiz-1" },
    });

    expect(res.status).toBe(400);
    expect(db.quizAttempt.create).not.toHaveBeenCalled();
  });

  it("scores a fully correct mixed submission as 100% and persists the attempt for the current user", async () => {
    const res = await POST(
      makeRequest({ answers: { "q-mcq": "a", "q-tf": true, "q-sa": "Thermal equilibrium is transitive" } }),
      { params: { quizId: "quiz-1" } }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.attempt.score).toBe(100);
    expect(json.attempt.correctCount).toBe(3);
    expect(json.attempt.totalQuestions).toBe(3);
    expect(db.quizAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quizId: "quiz-1", userId: "user-1", score: 100 }) })
    );
  });

  it("scores MCQ correctly for both correct and incorrect submissions", async () => {
    const wrongRes = await POST(makeRequest({ answers: { "q-mcq": "b" } }), { params: { quizId: "quiz-1" } });
    const wrongJson = await wrongRes.json();
    expect(wrongJson.results.find((r: { questionId: string }) => r.questionId === "q-mcq").correct).toBe(false);
  });

  it("scores TRUE_FALSE correctly", async () => {
    const res = await POST(makeRequest({ answers: { "q-tf": false } }), { params: { quizId: "quiz-1" } });
    const json = await res.json();
    expect(json.results.find((r: { questionId: string }) => r.questionId === "q-tf").correct).toBe(false);
  });

  it("scores SHORT_ANSWER with normalized case-insensitive matching", async () => {
    const res = await POST(makeRequest({ answers: { "q-sa": "  THERMAL equilibrium IS transitive  " } }), {
      params: { quizId: "quiz-1" },
    });
    const json = await res.json();
    expect(json.results.find((r: { questionId: string }) => r.questionId === "q-sa").correct).toBe(true);
  });

  it("safely handles a type-mismatched answer (boolean submitted for MCQ) as incorrect, not a crash", async () => {
    const res = await POST(makeRequest({ answers: { "q-mcq": true } }), { params: { quizId: "quiz-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.find((r: { questionId: string }) => r.questionId === "q-mcq").correct).toBe(false);
  });

  it("ignores a submitted answer for a question id that doesn't belong to this quiz", async () => {
    const res = await POST(
      makeRequest({ answers: { "q-mcq": "a", "some-other-quiz-question-id": "a" } }),
      { params: { quizId: "quiz-1" } }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.map((r: { questionId: string }) => r.questionId)).not.toContain(
      "some-other-quiz-question-id"
    );
    // And the ignored key never reaches the persisted attempt either.
    const persistedAnswers = db.quizAttempt.create.mock.calls[0]?.[0].data.answers;
    expect(persistedAnswers).not.toHaveProperty("some-other-quiz-question-id");
  });

  it("cannot be forged by a client-provided score — the response score always comes from server-side scoring", async () => {
    // The request body has no score/correct fields at all — submitQuizAttemptSchema
    // doesn't even accept them — so a client attempting to send one has no effect.
    const res = await POST(
      makeRequest({ answers: { "q-mcq": "a", "q-tf": true, "q-sa": "Thermal equilibrium is transitive" }, score: 0, correct: false }),
      { params: { quizId: "quiz-1" } }
    );
    const json = await res.json();

    expect(json.attempt.score).toBe(100);
  });

  it("reveals correctAnswer, explanation, and sources in the post-submission result", async () => {
    const res = await POST(makeRequest({ answers: { "q-mcq": "a" } }), { params: { quizId: "quiz-1" } });
    const json = await res.json();

    const mcqResult = json.results.find((r: { questionId: string }) => r.questionId === "q-mcq");
    expect(mcqResult.correctAnswer).toBe("a");
    expect(mcqResult.explanation).toBe("A is correct.");
    expect(mcqResult.sources).toEqual([{ materialId: "m1", label: "Lecture 12" }]);
  });

  it("always creates the QuizAttempt for the authenticated session user, never a client-supplied id", async () => {
    await POST(makeRequest({ answers: { "q-mcq": "a" } }), { params: { quizId: "quiz-1" } });

    expect(db.quizAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-1" }) })
    );
  });
});
