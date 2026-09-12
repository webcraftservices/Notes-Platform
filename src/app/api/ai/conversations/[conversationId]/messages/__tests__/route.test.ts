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
  return { assertWithinAIQuota: vi.fn(), AIQuotaExceededError };
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
      topicId: null,
      chapterId: null,
      subjectId: null,
      groupId: null,
    });
    access.getAccessibleAIScope.mockResolvedValue(WORKSPACE_SCOPE);
    rateLimitModule.rateLimit.mockResolvedValue({ success: true, remaining: 10 });
    quotaModule.assertWithinAIQuota.mockResolvedValue({ usedCredits: 0, limitCredits: 200 });
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

    expect(rateLimitModule.rateLimit).toHaveBeenCalledWith(expect.stringContaining("user-1"), expect.any(Object));
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
});
