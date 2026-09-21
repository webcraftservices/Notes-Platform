import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleTopic: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const rateLimitModule = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => rateLimitModule);

const quotaModule = vi.hoisted(() => {
  class AIQuotaExceededError extends Error {
    usage: { usedCredits: number; limitCredits: number; plan: { label: string } };
    constructor(usage: { usedCredits: number; limitCredits: number; plan: { label: string } }) {
      super("quota exceeded");
      this.usage = usage;
    }
  }
  return { assertWithinAIQuota: vi.fn(), AIQuotaExceededError };
});
vi.mock("@/lib/ai-quota", () => quotaModule);

const generationModule = vi.hoisted(() => {
  class InsufficientSourceMaterialError extends Error {}
  class QuizGenerationOutputError extends Error {}
  return {
    generateQuizForTopic: vi.fn(),
    InsufficientSourceMaterialError,
    QuizGenerationOutputError,
  };
});
vi.mock("@/lib/services/quiz-generation", () => generationModule);

import { POST } from "@/app/api/topics/[topicId]/quizzes/route";
import { ServiceNotConfiguredError, AIProviderUnavailableError } from "@/lib/services/interfaces";

function makeRequest(): Request {
  return new Request("https://example.test/api/topics/topic-1/quizzes", { method: "POST" });
}

describe("POST /api/topics/[topicId]/quizzes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleTopic.mockResolvedValue({ id: "topic-1", name: "Zeroth Law" });
    rateLimitModule.rateLimit.mockResolvedValue({ success: true, remaining: 4 });
    quotaModule.assertWithinAIQuota.mockResolvedValue({ usedCredits: 0, limitCredits: 200 });
    generationModule.generateQuizForTopic.mockResolvedValue({
      id: "quiz-1",
      title: "Quiz — Zeroth Law",
      quizType: "MIXED",
      createdAt: new Date(),
      questions: [
        { id: "q1", prompt: "Q1?", questionType: "TRUE_FALSE", options: null, correctAnswer: true, order: 0 },
        { id: "q2", prompt: "Q2?", questionType: "TRUE_FALSE", options: null, correctAnswer: false, order: 1 },
      ],
    });
  });

  it("rejects with 401 when there is no authenticated user, before touching any other dependency", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });

    expect(res.status).toBe(401);
    expect(rateLimitModule.rateLimit).not.toHaveBeenCalled();
    expect(generationModule.generateQuizForTopic).not.toHaveBeenCalled();
  });

  it("returns 429 with a stable AI_RATE_LIMITED code when rate limited, and never generates", async () => {
    rateLimitModule.rateLimit.mockResolvedValue({ success: false, remaining: 0 });

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.code).toBe("AI_RATE_LIMITED");
    expect(generationModule.generateQuizForTopic).not.toHaveBeenCalled();
  });

  it("returns 404 when the topic doesn't exist", async () => {
    access.getAccessibleTopic.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });

    expect(res.status).toBe(404);
    expect(quotaModule.assertWithinAIQuota).not.toHaveBeenCalled();
    expect(generationModule.generateQuizForTopic).not.toHaveBeenCalled();
  });

  it("returns 403 when the topic exists but the user isn't authorized for it", async () => {
    access.getAccessibleTopic.mockRejectedValue(new access.NotAuthorizedError());

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });

    expect(res.status).toBe(403);
    expect(generationModule.generateQuizForTopic).not.toHaveBeenCalled();
  });

  it("checks quota only after topic authorization has already succeeded, and before generation", async () => {
    const calls: string[] = [];
    access.getAccessibleTopic.mockImplementation(async () => {
      calls.push("authorize-topic");
      return { id: "topic-1", name: "Zeroth Law" };
    });
    quotaModule.assertWithinAIQuota.mockImplementation(async () => {
      calls.push("quota-check");
      return { usedCredits: 0, limitCredits: 200 };
    });
    generationModule.generateQuizForTopic.mockImplementation(async () => {
      calls.push("generate");
      return { id: "quiz-1", title: "x", quizType: "MIXED", createdAt: new Date(), questions: [] };
    });

    await POST(makeRequest(), { params: { topicId: "topic-1" } });

    expect(calls).toEqual(["authorize-topic", "quota-check", "generate"]);
  });

  it("returns 429 with a stable AI_QUOTA_EXCEEDED code when quota is exceeded, and never generates", async () => {
    quotaModule.assertWithinAIQuota.mockRejectedValue(
      new quotaModule.AIQuotaExceededError({ usedCredits: 200, limitCredits: 200, plan: { label: "Free" } })
    );

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.code).toBe("AI_QUOTA_EXCEEDED");
    expect(generationModule.generateQuizForTopic).not.toHaveBeenCalled();
  });

  it("returns 409 with a stable code when the topic has insufficient indexed material", async () => {
    generationModule.generateQuizForTopic.mockRejectedValue(
      new generationModule.InsufficientSourceMaterialError("not enough material")
    );

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe("QUIZ_INSUFFICIENT_MATERIAL");
  });

  it("returns 502 with a stable code when the AI output couldn't be turned into a quiz", async () => {
    generationModule.generateQuizForTopic.mockRejectedValue(
      new generationModule.QuizGenerationOutputError("malformed output")
    );

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.code).toBe("QUIZ_GENERATION_FAILED");
  });

  it("returns 503 (not a fake success) when the AI provider isn't configured", async () => {
    generationModule.generateQuizForTopic.mockRejectedValue(
      new ServiceNotConfiguredError("AIService", ["GOOGLE_AI_API_KEY"])
    );

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });

    expect(res.status).toBe(503);
  });

  it("returns 201 with the generated quiz, and never leaks correctAnswer for any question", async () => {
    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.quiz).toMatchObject({ id: "quiz-1", title: "Quiz — Zeroth Law" });
    expect(json.quiz.questions).toHaveLength(2);
    for (const question of json.quiz.questions) {
      expect(question.correctAnswer).toBeUndefined();
      expect(question.explanation).toBeUndefined();
      expect(question.sources).toBeUndefined();
    }
    expect(generationModule.generateQuizForTopic).toHaveBeenCalledWith({ userId: "user-1", topicId: "topic-1" });
  });

  it("returns 503 with a stable AI_PROVIDER_UNAVAILABLE code (not a bare 500) when the AI provider is down", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    generationModule.generateQuizForTopic.mockRejectedValue(new AIProviderUnavailableError("Gemini request failed (503): overloaded"));

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(JSON.stringify(json)).not.toMatch(/overloaded|Gemini/);
    consoleSpy.mockRestore();
  });

  it("returns a safe, logged 500 for an unexpected failure — never leaking the underlying error text", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    generationModule.generateQuizForTopic.mockRejectedValue(new Error("Invalid `prisma.x.create()` invocation: secret detail"));

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(json)).not.toMatch(/prisma|secret detail/);
    expect(json.requestId).toEqual(expect.any(String));
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
