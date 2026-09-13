import { describe, expect, it } from "vitest";
import {
  flashcardGenerationItemSchema,
  learningSourceRefSchema,
  quizQuestionGenerationItemSchema,
} from "@/lib/validation/learning";

describe("learningSourceRefSchema", () => {
  it("accepts a minimal valid source ref", () => {
    const result = learningSourceRefSchema.safeParse({ materialId: "clabcdefghijklmnopqrstuv", label: "Lecture 12" });
    expect(result.success).toBe(true);
  });

  it("accepts optional timestamp and page", () => {
    const result = learningSourceRefSchema.safeParse({
      materialId: "clabcdefghijklmnopqrstuv",
      label: "Thermodynamics.pdf",
      page: 8,
      timestampSeconds: 765,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-cuid materialId", () => {
    const result = learningSourceRefSchema.safeParse({ materialId: "not-a-cuid", label: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty label", () => {
    const result = learningSourceRefSchema.safeParse({ materialId: "clabcdefghijklmnopqrstuv", label: "" });
    expect(result.success).toBe(false);
  });
});

describe("flashcardGenerationItemSchema", () => {
  it("accepts a valid flashcard with sources", () => {
    const result = flashcardGenerationItemSchema.safeParse({
      front: "What is thermal equilibrium?",
      back: "Two systems are in thermal equilibrium when no net heat flows between them.",
      sources: [{ materialId: "clabcdefghijklmnopqrstuv", label: "Lecture 12", timestampSeconds: 120 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a flashcard with no sources", () => {
    const result = flashcardGenerationItemSchema.safeParse({ front: "Q", back: "A" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty front", () => {
    const result = flashcardGenerationItemSchema.safeParse({ front: "", back: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty back", () => {
    const result = flashcardGenerationItemSchema.safeParse({ front: "Q", back: "" });
    expect(result.success).toBe(false);
  });
});

describe("quizQuestionGenerationItemSchema", () => {
  // --- Positive cases ---

  it("accepts a valid MCQ with 2+ unique options and a correctAnswer referencing one", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "What is the Zeroth Law?",
      questionType: "MCQ",
      options: [
        { id: "a", text: "Thermal equilibrium is transitive" },
        { id: "b", text: "Energy is conserved" },
      ],
      correctAnswer: "a",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid TRUE_FALSE question with a boolean correctAnswer and no options", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "Entropy always increases in an isolated system.",
      questionType: "TRUE_FALSE",
      correctAnswer: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid SHORT_ANSWER question with a string correctAnswer and no options", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "State the Zeroth Law of Thermodynamics.",
      questionType: "SHORT_ANSWER",
      correctAnswer: "If A is in equilibrium with B, and B with C, then A is in equilibrium with C.",
    });
    expect(result.success).toBe(true);
  });

  // --- Negative cases ---

  it("rejects an MCQ with fewer than two options", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "What is the Zeroth Law?",
      questionType: "MCQ",
      options: [{ id: "a", text: "Only one option" }],
      correctAnswer: "a",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an MCQ with duplicate option ids", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "What is the Zeroth Law?",
      questionType: "MCQ",
      options: [
        { id: "a", text: "Thermal equilibrium is transitive" },
        { id: "a", text: "A duplicate id" },
      ],
      correctAnswer: "a",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an MCQ whose correctAnswer references a nonexistent option id", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "What is the Zeroth Law?",
      questionType: "MCQ",
      options: [
        { id: "a", text: "Thermal equilibrium is transitive" },
        { id: "b", text: "Energy is conserved" },
      ],
      correctAnswer: "c",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an MCQ with a non-string correctAnswer", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "What is the Zeroth Law?",
      questionType: "MCQ",
      options: [
        { id: "a", text: "Thermal equilibrium is transitive" },
        { id: "b", text: "Energy is conserved" },
      ],
      correctAnswer: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an MCQ missing options entirely", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "What is the Zeroth Law?",
      questionType: "MCQ",
      correctAnswer: "a",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an MCQ with an empty options array", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "What is the Zeroth Law?",
      questionType: "MCQ",
      options: [],
      correctAnswer: "a",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a TRUE_FALSE question with a string correctAnswer", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "Entropy always increases in an isolated system.",
      questionType: "TRUE_FALSE",
      correctAnswer: "true",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a TRUE_FALSE question with a numeric correctAnswer", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "Entropy always increases in an isolated system.",
      questionType: "TRUE_FALSE",
      correctAnswer: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a TRUE_FALSE question with an object correctAnswer", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "Entropy always increases in an isolated system.",
      questionType: "TRUE_FALSE",
      correctAnswer: { value: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a TRUE_FALSE question that includes options", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "Entropy always increases in an isolated system.",
      questionType: "TRUE_FALSE",
      correctAnswer: true,
      options: [
        { id: "a", text: "True" },
        { id: "b", text: "False" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a SHORT_ANSWER question with a boolean correctAnswer", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "State the Zeroth Law of Thermodynamics.",
      questionType: "SHORT_ANSWER",
      correctAnswer: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a SHORT_ANSWER question that includes options", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "State the Zeroth Law of Thermodynamics.",
      questionType: "SHORT_ANSWER",
      correctAnswer: "A statement.",
      options: [{ id: "a", text: "Irrelevant option" }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects questionType: "MIXED" — MIXED is a quiz-level composition value, not an individual question type', () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "What is the Zeroth Law?",
      questionType: "MIXED",
      correctAnswer: "a",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty prompt", () => {
    const result = quizQuestionGenerationItemSchema.safeParse({
      prompt: "",
      questionType: "TRUE_FALSE",
      correctAnswer: true,
    });
    expect(result.success).toBe(false);
  });
});
