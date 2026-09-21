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
  class FlashcardGenerationOutputError extends Error {}
  return {
    generateFlashcardsForTopic: vi.fn(),
    InsufficientSourceMaterialError,
    FlashcardGenerationOutputError,
  };
});
vi.mock("@/lib/services/flashcard-generation", () => generationModule);

import { POST } from "@/app/api/topics/[topicId]/flashcards/route";
import { ServiceNotConfiguredError, AIProviderUnavailableError } from "@/lib/services/interfaces";

function makeRequest(): Request {
  return new Request("https://example.test/api/topics/topic-1/flashcards", { method: "POST" });
}

describe("POST /api/topics/[topicId]/flashcards", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleTopic.mockResolvedValue({ id: "topic-1", name: "Zeroth Law" });
    rateLimitModule.rateLimit.mockResolvedValue({ success: true, remaining: 4 });
    quotaModule.assertWithinAIQuota.mockResolvedValue({ usedCredits: 0, limitCredits: 200 });
    generationModule.generateFlashcardsForTopic.mockResolvedValue({
      id: "deck-1",
      title: "Flashcards — Zeroth Law",
      cards: [{ id: "card-1" }, { id: "card-2" }],
    });
  });

  it("rejects with 401 when there is no authenticated user, before touching any other dependency", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });

    expect(res.status).toBe(401);
    expect(rateLimitModule.rateLimit).not.toHaveBeenCalled();
    expect(generationModule.generateFlashcardsForTopic).not.toHaveBeenCalled();
  });

  it("returns 429 with a stable AI_RATE_LIMITED code when rate limited, and never generates", async () => {
    rateLimitModule.rateLimit.mockResolvedValue({ success: false, remaining: 0 });

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.code).toBe("AI_RATE_LIMITED");
    expect(generationModule.generateFlashcardsForTopic).not.toHaveBeenCalled();
  });

  it("checks the rate limit using the authenticated user's own id", async () => {
    await POST(makeRequest(), { params: { topicId: "topic-1" } });

    expect(rateLimitModule.rateLimit).toHaveBeenCalledWith(expect.stringContaining("user-1"), expect.any(Object));
  });

  it("returns 404 when the topic doesn't exist", async () => {
    access.getAccessibleTopic.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });

    expect(res.status).toBe(404);
    expect(quotaModule.assertWithinAIQuota).not.toHaveBeenCalled();
    expect(generationModule.generateFlashcardsForTopic).not.toHaveBeenCalled();
  });

  it("returns 403 when the topic exists but the user isn't authorized for it", async () => {
    access.getAccessibleTopic.mockRejectedValue(new access.NotAuthorizedError());

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });

    expect(res.status).toBe(403);
    expect(generationModule.generateFlashcardsForTopic).not.toHaveBeenCalled();
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
    generationModule.generateFlashcardsForTopic.mockImplementation(async () => {
      calls.push("generate");
      return { id: "deck-1", title: "x", cards: [] };
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
    expect(json.usage).toMatchObject({ usedCredits: 200, limitCredits: 200 });
    expect(generationModule.generateFlashcardsForTopic).not.toHaveBeenCalled();
  });

  it("returns 409 with a stable code when the topic has insufficient indexed material", async () => {
    generationModule.generateFlashcardsForTopic.mockRejectedValue(
      new generationModule.InsufficientSourceMaterialError("not enough material")
    );

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe("FLASHCARDS_INSUFFICIENT_MATERIAL");
  });

  it("returns 502 with a stable code when the AI output couldn't be turned into flashcards", async () => {
    generationModule.generateFlashcardsForTopic.mockRejectedValue(
      new generationModule.FlashcardGenerationOutputError("malformed output")
    );

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.code).toBe("FLASHCARDS_GENERATION_FAILED");
  });

  it("returns 503 (not a fake success) when the AI provider isn't configured", async () => {
    generationModule.generateFlashcardsForTopic.mockRejectedValue(
      new ServiceNotConfiguredError("AIService", ["GOOGLE_AI_API_KEY"])
    );

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });

    expect(res.status).toBe(503);
  });

  it("returns 201 with the generated deck on success", async () => {
    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.deck).toMatchObject({ id: "deck-1", title: "Flashcards — Zeroth Law" });
    expect(json.deck.cards).toHaveLength(2);
    expect(generationModule.generateFlashcardsForTopic).toHaveBeenCalledWith({
      userId: "user-1",
      topicId: "topic-1",
    });
  });

  it("returns 503 with a stable AI_PROVIDER_UNAVAILABLE code (not a bare 500) when the AI provider is down", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    generationModule.generateFlashcardsForTopic.mockRejectedValue(new AIProviderUnavailableError("Gemini request failed (503): overloaded"));

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(JSON.stringify(json)).not.toMatch(/overloaded|Gemini/);
    consoleSpy.mockRestore();
  });

  it("returns a safe, logged 500 for an unexpected failure — never leaking the underlying error text", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    generationModule.generateFlashcardsForTopic.mockRejectedValue(new Error("Invalid `prisma.x.create()` invocation: secret detail"));

    const res = await POST(makeRequest(), { params: { topicId: "topic-1" } });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(json)).not.toMatch(/prisma|secret detail/);
    expect(json.requestId).toEqual(expect.any(String));
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
