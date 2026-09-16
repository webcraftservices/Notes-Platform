import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  aIMessage: { findMany: vi.fn(), create: vi.fn() },
  aIConversation: { update: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleAIConversation: vi.fn(),
  getAccessibleAIScope: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));

vi.mock("@/lib/access", () => access);

const retrieval = vi.hoisted(() => ({ retrieveRelevantChunks: vi.fn() }));
vi.mock("@/lib/retrieval", () => retrieval);

const aiServiceRegistry = vi.hoisted(() => ({ getAIService: vi.fn() }));
vi.mock("@/lib/services/ai", () => aiServiceRegistry);

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
  class AITutorNotEnabledError extends Error {
    plan: unknown;
    constructor(plan: unknown) {
      super("AI Tutor isn't available on your current plan.");
      this.plan = plan;
    }
  }
  return {
    assertWithinAIQuota: vi.fn(),
    AIQuotaExceededError,
    assertAiTutorEntitlement: vi.fn(),
    AITutorNotEnabledError,
  };
});
vi.mock("@/lib/ai-quota", () => quotaModule);

const usageModule = vi.hoisted(() => ({ recordAIUsage: vi.fn() }));
vi.mock("@/lib/ai-usage", () => usageModule);

import { POST } from "@/app/api/ai/conversations/[conversationId]/messages/route";
import { ServiceNotConfiguredError } from "@/lib/services/interfaces";

function makeRequest(body: unknown): Request {
  return new Request("https://example.test/api/ai/conversations/conv-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const WORKSPACE_SCOPE = {
  ownerType: "workspace" as const,
  workspaceId: "workspace-1",
  groupId: null,
  subjectId: null,
  chapterId: null,
  topicId: null,
};

describe("POST /api/ai/conversations/[conversationId]/messages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleAIConversation.mockResolvedValue({
      id: "conv-1",
      kind: "CHAT",
      topicId: null,
      chapterId: null,
      subjectId: null,
      groupId: null,
    });
    access.getAccessibleAIScope.mockResolvedValue(WORKSPACE_SCOPE);
    rateLimitModule.rateLimit.mockResolvedValue({ success: true, remaining: 10 });
    quotaModule.assertWithinAIQuota.mockResolvedValue({ usedCredits: 0, limitCredits: 200 });
    quotaModule.assertAiTutorEntitlement.mockResolvedValue(undefined);
    retrieval.retrieveRelevantChunks.mockResolvedValue([]);
    db.aIMessage.findMany.mockResolvedValue([]);
    db.$transaction.mockResolvedValue([{ id: "user-msg" }, { id: "assistant-msg" }]);
    db.aIConversation.update.mockResolvedValue({});
    aiServiceRegistry.getAIService.mockReturnValue({
      providerName: "gemini",
      modelName: "gemini-2.5-flash-lite",
      chat: vi.fn().mockResolvedValue({ content: "hi there", tokensInput: 10, tokensOutput: 5 }),
    });
  });

  it("rejects with 401 when there is no authenticated user, before touching any other dependency", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

    expect(res.status).toBe(401);
    expect(rateLimitModule.rateLimit).not.toHaveBeenCalled();
    expect(aiServiceRegistry.getAIService).not.toHaveBeenCalled();
  });

  it("returns a 429 with a stable AI_RATE_LIMITED code when rate limited, and never calls the AI provider", async () => {
    rateLimitModule.rateLimit.mockResolvedValue({ success: false, remaining: 0 });

    const res = await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.code).toBe("AI_RATE_LIMITED");
    expect(aiServiceRegistry.getAIService).not.toHaveBeenCalled();
    expect(quotaModule.assertWithinAIQuota).not.toHaveBeenCalled();
    expect(usageModule.recordAIUsage).not.toHaveBeenCalled();
  });

  it("checks the rate limit using the authenticated user's own id, not any client-supplied identity", async () => {
    await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

    expect(rateLimitModule.rateLimit).toHaveBeenCalledWith("ai-chat:user-1", expect.any(Object));
    expect(rateLimitModule.rateLimit).toHaveBeenCalledTimes(1);
  });

  it("uses only the Tutor rate-limit bucket for Tutor conversations", async () => {
    access.getAccessibleAIConversation.mockResolvedValue({
      id: "conv-1",
      kind: "TUTOR",
      topicId: null,
      chapterId: null,
      subjectId: null,
      groupId: null,
    });

    await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

    expect(rateLimitModule.rateLimit).toHaveBeenCalledWith("ai-tutor-chat:user-1", expect.any(Object));
    expect(rateLimitModule.rateLimit).not.toHaveBeenCalledWith("ai-chat:user-1", expect.any(Object));
    expect(rateLimitModule.rateLimit).toHaveBeenCalledTimes(1);
  });

  it("uses only the normal AI Chat bucket for CHAT conversations", async () => {
    await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

    expect(rateLimitModule.rateLimit).toHaveBeenCalledWith("ai-chat:user-1", expect.any(Object));
    expect(rateLimitModule.rateLimit).not.toHaveBeenCalledWith("ai-tutor-chat:user-1", expect.any(Object));
    expect(rateLimitModule.rateLimit).toHaveBeenCalledTimes(1);
  });

  it("returns a 429 with a stable AI_QUOTA_EXCEEDED code when the quota is exceeded, and never calls the AI provider", async () => {
    quotaModule.assertWithinAIQuota.mockRejectedValue(
      new quotaModule.AIQuotaExceededError({ usedCredits: 200, limitCredits: 200, plan: { label: "Free" } })
    );

    const res = await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.code).toBe("AI_QUOTA_EXCEEDED");
    expect(json.usage).toMatchObject({ usedCredits: 200, limitCredits: 200 });
    expect(aiServiceRegistry.getAIService).not.toHaveBeenCalled();
    expect(retrieval.retrieveRelevantChunks).not.toHaveBeenCalled();
    expect(usageModule.recordAIUsage).not.toHaveBeenCalled();
  });

  it("checks quota only after conversation/scope authorization has already succeeded", async () => {
    const calls: string[] = [];
    access.getAccessibleAIConversation.mockImplementation(async () => {
      calls.push("authorize-conversation");
      return { id: "conv-1", topicId: null, chapterId: null, subjectId: null, groupId: null };
    });
    access.getAccessibleAIScope.mockImplementation(async () => {
      calls.push("authorize-scope");
      return WORKSPACE_SCOPE;
    });
    quotaModule.assertWithinAIQuota.mockImplementation(async () => {
      calls.push("quota-check");
      return { usedCredits: 0, limitCredits: 200 };
    });

    await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

    expect(calls).toEqual(["authorize-conversation", "authorize-scope", "quota-check"]);
  });

  it("does not call the AI provider or authorize a scope for a conversation the user cannot access", async () => {
    access.getAccessibleAIConversation.mockRejectedValue(new access.NotAuthorizedError());

    const res = await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

    expect(res.status).toBe(403);
    expect(aiServiceRegistry.getAIService).not.toHaveBeenCalled();
    expect(quotaModule.assertWithinAIQuota).not.toHaveBeenCalled();
  });

  it("on success, records AI usage with the authenticated user's id, the resolved scope, and the real provider/model/token counts", async () => {
    const res = await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });
    expect(res.status).toBe(200);

    expect(usageModule.recordAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        workspaceId: "workspace-1",
        category: "chat",
        provider: "gemini",
        model: "gemini-2.5-flash-lite",
        tokensInput: 10,
        tokensOutput: 5,
      })
    );
  });

  it("attributes usage to the requesting user even for a group-scoped conversation, never to the group itself", async () => {
    access.getAccessibleAIScope.mockResolvedValue({
      ownerType: "group",
      workspaceId: null,
      groupId: "group-1",
      subjectId: null,
      chapterId: null,
      topicId: null,
    });

    await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

    expect(usageModule.recordAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", groupId: "group-1", workspaceId: null })
    );
  });

  it("returns a 503 (not a 500, not a fake reply) when the AI provider isn't configured, and records no usage", async () => {
    aiServiceRegistry.getAIService.mockImplementation(() => {
      throw new ServiceNotConfiguredError("AIService", ["GOOGLE_AI_API_KEY"]);
    });

    const res = await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

    expect(res.status).toBe(503);
    expect(usageModule.recordAIUsage).not.toHaveBeenCalled();
  });

  /**
   * Phase 8.4 — real TUTOR behavior. `AIConversation.kind` is now a real
   * schema column (see prisma/schema.prisma / the 20260916090000
   * migration) and `getAccessibleAIConversation` returns it unmodified as
   * part of the full Prisma row (no `select`, so every scalar column
   * comes back) — these tests mock `access.getAccessibleAIConversation`'s
   * *return value* the same way every other test in this file mocks its
   * dependencies, but that return value is no longer describing a shape
   * that can't exist in the real database (the audit's finding about
   * commit 0182b54). The proof that the shape is real lives in
   * lib/__tests__/access-ai-scope.test.ts (exercises the real
   * getAccessibleAIConversation against a mocked `db`) and
   * lib/validation/__tests__/ai.test.ts (exercises the real Zod schema) —
   * this file's job is still only the route's own branching logic, same
   * division of responsibility as every test above this point.
   */
  describe("Tutor conversations (kind: TUTOR)", () => {
    beforeEach(() => {
      access.getAccessibleAIConversation.mockResolvedValue({
        id: "conv-1",
        kind: "TUTOR",
        topicId: "topic-1",
        chapterId: null,
        subjectId: null,
        groupId: null,
      });
      access.getAccessibleAIScope.mockResolvedValue({
        ownerType: "workspace" as const,
        workspaceId: "workspace-1",
        groupId: null,
        subjectId: null,
        chapterId: null,
        topicId: "topic-1",
      });
      retrieval.retrieveRelevantChunks.mockResolvedValue([
        {
          id: "chunk-1",
          materialId: "mat-1",
          materialTitle: "Lecture 1",
          content: "Some course content.",
          pageNumber: 1,
          startSeconds: null,
          endSeconds: null,
          similarity: 0.9,
        },
      ]);
    });

    it("checks the aiTutor plan entitlement before consuming the rate-limit bucket", async () => {
      quotaModule.assertAiTutorEntitlement.mockRejectedValue(
        new quotaModule.AITutorNotEnabledError({ label: "Free" })
      );

      const res = await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.code).toBe("AI_TUTOR_NOT_ENABLED");
      expect(rateLimitModule.rateLimit).not.toHaveBeenCalled();
      expect(aiServiceRegistry.getAIService).not.toHaveBeenCalled();
    });

    it("never checks the aiTutor entitlement for a plain CHAT conversation", async () => {
      access.getAccessibleAIConversation.mockResolvedValue({
        id: "conv-1",
        kind: "CHAT",
        topicId: null,
        chapterId: null,
        subjectId: null,
        groupId: null,
      });

      await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

      expect(quotaModule.assertAiTutorEntitlement).not.toHaveBeenCalled();
    });

    it("passes a system message containing the Tutor instructions to AIService.chat(), and CHAT never receives it", async () => {
      const chatMock = vi.fn().mockResolvedValue({ content: "answer", tokensInput: 1, tokensOutput: 1 });
      aiServiceRegistry.getAIService.mockReturnValue({ providerName: "gemini", modelName: "m", chat: chatMock });

      await POST(makeRequest({ content: "What is the zeroth law?" }), { params: { conversationId: "conv-1" } });

      const tutorCall = chatMock.mock.calls[0]![0];
      expect(tutorCall.messages[0]).toMatchObject({ role: "system" });
      expect(tutorCall.messages[0].content).toMatch(/Tutor/);

      chatMock.mockClear();
      access.getAccessibleAIConversation.mockResolvedValue({
        id: "conv-1",
        kind: "CHAT",
        topicId: null,
        chapterId: null,
        subjectId: null,
        groupId: null,
      });
      await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });
      const chatCall = chatMock.mock.calls[0]![0];
      expect(chatCall.messages.some((m: { role: string }) => m.role === "system")).toBe(false);
    });

    it("still passes the retrieved RAG context to AIService.chat() for a Tutor turn", async () => {
      const chatMock = vi.fn().mockResolvedValue({ content: "answer", tokensInput: 1, tokensOutput: 1 });
      aiServiceRegistry.getAIService.mockReturnValue({ providerName: "gemini", modelName: "m", chat: chatMock });

      await POST(makeRequest({ content: "What is the zeroth law?" }), { params: { conversationId: "conv-1" } });

      expect(chatMock.mock.calls[0]![0].context).toBeDefined();
      expect(retrieval.retrieveRelevantChunks).toHaveBeenCalledWith(
        "What is the zeroth law?",
        expect.objectContaining({ topicId: "topic-1" }),
        "user-1"
      );
    });

    it("when nothing is indexed for the Topic, returns an honest 409 instead of calling the AI provider", async () => {
      retrieval.retrieveRelevantChunks.mockResolvedValue([]);

      const res = await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe("TUTOR_INSUFFICIENT_MATERIAL");
      expect(aiServiceRegistry.getAIService).not.toHaveBeenCalled();
      expect(usageModule.recordAIUsage).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("does not apply the insufficient-material short-circuit to plain CHAT with zero chunks (unchanged pre-8.4 behavior)", async () => {
      access.getAccessibleAIConversation.mockResolvedValue({
        id: "conv-1",
        kind: "CHAT",
        topicId: null,
        chapterId: null,
        subjectId: null,
        groupId: null,
      });
      retrieval.retrieveRelevantChunks.mockResolvedValue([]);
      const chatMock = vi.fn().mockResolvedValue({ content: "general answer", tokensInput: 1, tokensOutput: 1 });
      aiServiceRegistry.getAIService.mockReturnValue({ providerName: "gemini", modelName: "m", chat: chatMock });

      const res = await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

      expect(res.status).toBe(200);
      expect(chatMock).toHaveBeenCalled();
    });

    it("records usage under the tutor_chat category, not chat", async () => {
      await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

      expect(usageModule.recordAIUsage).toHaveBeenCalledWith(expect.objectContaining({ category: "tutor_chat" }));
    });

    it("continues to record plain CHAT usage under the chat category", async () => {
      access.getAccessibleAIConversation.mockResolvedValue({
        id: "conv-1",
        kind: "CHAT",
        topicId: null,
        chapterId: null,
        subjectId: null,
        groupId: null,
      });
      access.getAccessibleAIScope.mockResolvedValue(WORKSPACE_SCOPE);
      retrieval.retrieveRelevantChunks.mockResolvedValue([]);

      await POST(makeRequest({ content: "hello" }), { params: { conversationId: "conv-1" } });

      expect(usageModule.recordAIUsage).toHaveBeenCalledWith(expect.objectContaining({ category: "chat" }));
    });
  });
});
