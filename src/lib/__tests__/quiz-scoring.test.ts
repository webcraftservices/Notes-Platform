import { describe, expect, it } from "vitest";
import { isAnswerCorrect, scoreQuizAttempt } from "@/lib/quiz-scoring";

const MCQ_QUESTION = {
  id: "q-mcq",
  questionType: "MCQ" as const,
  correctAnswer: "a",
  explanation: "A is correct.",
  sources: [],
};

const TRUE_FALSE_QUESTION = {
  id: "q-tf",
  questionType: "TRUE_FALSE" as const,
  correctAnswer: true,
  explanation: null,
  sources: [],
};

const SHORT_ANSWER_QUESTION = {
  id: "q-sa",
  questionType: "SHORT_ANSWER" as const,
  correctAnswer: "Thermal equilibrium",
  explanation: null,
  sources: [],
};

describe("isAnswerCorrect", () => {
  it("MCQ: correct when the submitted option id matches exactly", () => {
    expect(isAnswerCorrect(MCQ_QUESTION, "a")).toBe(true);
  });

  it("MCQ: incorrect for a different option id", () => {
    expect(isAnswerCorrect(MCQ_QUESTION, "b")).toBe(false);
  });

  it("MCQ: incorrect (not crashing) for a non-string submission", () => {
    expect(isAnswerCorrect(MCQ_QUESTION, true)).toBe(false);
  });

  it("TRUE_FALSE: correct when the boolean matches exactly", () => {
    expect(isAnswerCorrect(TRUE_FALSE_QUESTION, true)).toBe(true);
    expect(isAnswerCorrect({ ...TRUE_FALSE_QUESTION, correctAnswer: false }, false)).toBe(true);
  });

  it("TRUE_FALSE: incorrect for the opposite boolean", () => {
    expect(isAnswerCorrect(TRUE_FALSE_QUESTION, false)).toBe(false);
  });

  it("TRUE_FALSE: incorrect (not crashing) for a string submission", () => {
    expect(isAnswerCorrect(TRUE_FALSE_QUESTION, "true")).toBe(false);
  });

  it("SHORT_ANSWER: correct for an exact match", () => {
    expect(isAnswerCorrect(SHORT_ANSWER_QUESTION, "Thermal equilibrium")).toBe(true);
  });

  it("SHORT_ANSWER: correct for a case-insensitive, trimmed match", () => {
    expect(isAnswerCorrect(SHORT_ANSWER_QUESTION, "  thermal EQUILIBRIUM  ")).toBe(true);
  });

  it("SHORT_ANSWER: incorrect for a materially different answer", () => {
    expect(isAnswerCorrect(SHORT_ANSWER_QUESTION, "Something else entirely")).toBe(false);
  });

  it("SHORT_ANSWER: incorrect (not crashing) for a non-string submission", () => {
    expect(isAnswerCorrect(SHORT_ANSWER_QUESTION, 42)).toBe(false);
  });
});

describe("scoreQuizAttempt", () => {
  const questions = [MCQ_QUESTION, TRUE_FALSE_QUESTION, SHORT_ANSWER_QUESTION] as never[];

  it("scores a fully correct mixed-type attempt as 100%", () => {
    const result = scoreQuizAttempt(questions, {
      "q-mcq": "a",
      "q-tf": true,
      "q-sa": "Thermal equilibrium",
    });

    expect(result.correctCount).toBe(3);
    expect(result.totalQuestions).toBe(3);
    expect(result.score).toBe(100);
    expect(result.results.every((r) => r.correct)).toBe(true);
  });

  it("scores a partially correct attempt proportionally", () => {
    const result = scoreQuizAttempt(questions, {
      "q-mcq": "a", // correct
      "q-tf": false, // incorrect (correct is true)
      "q-sa": "wrong", // incorrect
    });

    expect(result.correctCount).toBe(1);
    expect(result.score).toBe(33); // round(1/3 * 100)
  });

  it("treats a missing answer as incorrect rather than throwing", () => {
    const result = scoreQuizAttempt(questions, { "q-mcq": "a" });

    expect(result.correctCount).toBe(1);
    expect(result.results.find((r) => r.questionId === "q-tf")?.correct).toBe(false);
    expect(result.results.find((r) => r.questionId === "q-tf")?.submittedAnswer).toBeNull();
  });

  it("never scores an answer keyed to a question id that isn't in the questions list, even if present in the answers map", () => {
    const result = scoreQuizAttempt(questions, {
      "q-mcq": "a",
      "q-tf": true,
      "q-sa": "Thermal equilibrium",
      "not-a-real-question-id": "should be ignored",
    });

    expect(result.results).toHaveLength(3);
    expect(result.results.map((r) => r.questionId)).not.toContain("not-a-real-question-id");
  });

  it("always reveals the real correctAnswer/explanation/sources per question — this is the post-submission reveal, not the pre-submission DTO", () => {
    const result = scoreQuizAttempt(questions, { "q-mcq": "b" });

    const mcqResult = result.results.find((r) => r.questionId === "q-mcq");
    expect(mcqResult?.correctAnswer).toBe("a");
    expect(mcqResult?.explanation).toBe("A is correct.");
  });

  it("returns 0% for a quiz with no questions rather than dividing by zero", () => {
    const result = scoreQuizAttempt([], {});
    expect(result.score).toBe(0);
    expect(result.totalQuestions).toBe(0);
  });
});
