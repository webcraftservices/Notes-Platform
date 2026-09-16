import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  aIConversation: { findFirst: vi.fn(), create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleAIScope: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));

vi.mock("@/lib/access", () => access);

const quotaModule = vi.hoisted(() => {
  class AITutorNotEnabledError extends Error {
    plan: unknown;
    constructor(plan: unknown) {
      super("AI Tutor isn't available on your current plan.");
      this.plan = plan;
    }
  }
  return { assertAiTutorEntitlement: vi.fn(), AITutorNotEnabledError };
});
vi.mock("@/lib/ai-quota", () => quotaModule);

// lib/validation/ai.ts is NOT mocked — GET/POST use the real
// aiConversationScopeSchema, so "invalid kind is rejected" and "Tutor
// requires a topicId" below prove the actual production validation, not
// an assumed shape (the audit's central complaint about the pre-8.4 tests).
import { GET, POST } from "@/app/api/ai/conversations/route";

function makeGetRequest(query = ""): Request {
  return new Request(`https://example.test/api/ai/conversations${query ? `?${query}` : ""}`);
}

function makePostRequest(body: unknown): Request {
  return new Request("https://example.test/api/ai/conversations", {
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
  topicId: "cktopic0000000000000000000",
};

describe("GET /api/ai/conversations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleAIScope.mockResolvedValue(WORKSPACE_SCOPE);
    quotaModule.assertAiTutorEntitlement.mockResolvedValue(undefined);
    db.aIConversation.findFirst.mockResolvedValue(null);
    db.aIConversation.create.mockResolvedValue({ id: "conv-new", kind: "CHAT", messages: [] });
  });

  it("returns 401 when there is no authenticated user", async () => {
    access.getSessionUser.mockResolvedValue(null);
    const res = await GET(makeGetRequest("topicId=cktopic0000000000000000000"));
    expect(res.status).toBe(401);
  });

  it("defaults to kind: CHAT when no kind query param is given (pre-8.4 behavior unchanged)", async () => {
    await GET(makeGetRequest());

    expect(db.aIConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", kind: "CHAT" }) })
    );
    expect(quotaModule.assertAiTutorEntitlement).not.toHaveBeenCalled();
  });

  it("A. creating (get-or-creating) a normal conversation defaults to CHAT and creates it when none exists yet", async () => {
    await GET(makeGetRequest());
    expect(db.aIConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "CHAT" }) })
    );
  });

  it("looks up (and creates) a TUTOR conversation for a valid Topic separately from CHAT", async () => {
    await GET(makeGetRequest("topicId=cktopic0000000000000000000&kind=TUTOR"));

    expect(quotaModule.assertAiTutorEntitlement).toHaveBeenCalledWith("user-1");
    expect(db.aIConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ kind: "TUTOR" }) })
    );
    expect(db.aIConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-1", kind: "TUTOR" }) })
    );
  });

  it("A. rejects an invalid kind value (real Zod validation)", async () => {
    const res = await GET(makeGetRequest("kind=NOT_A_KIND"));
    expect(res.status).toBe(400);
    expect(access.getAccessibleAIScope).not.toHaveBeenCalled();
  });

  it("A. rejects kind=TUTOR without a topicId — Tutor cannot be created detached from a Topic", async () => {
    const res = await GET(makeGetRequest("kind=TUTOR"));
    expect(res.status).toBe(400);
    expect(quotaModule.assertAiTutorEntitlement).not.toHaveBeenCalled();
    expect(access.getAccessibleAIScope).not.toHaveBeenCalled();
  });

  it("A. TUTOR creation requires valid Topic authorization — an inaccessible Topic is rejected before any conversation is touched", async () => {
    access.getAccessibleAIScope.mockRejectedValue(new access.NotAuthorizedError());

    const res = await GET(makeGetRequest("topicId=cktopic0000000000000000000&kind=TUTOR"));

    expect(res.status).toBe(403);
    expect(db.aIConversation.findFirst).not.toHaveBeenCalled();
    expect(db.aIConversation.create).not.toHaveBeenCalled();
  });

  it("F. blocks TUTOR access with a 403 AI_TUTOR_NOT_ENABLED when the plan entitlement check fails, before any scope/DB work", async () => {
    quotaModule.assertAiTutorEntitlement.mockRejectedValue(
      new quotaModule.AITutorNotEnabledError({ label: "Free" })
    );

    const res = await GET(makeGetRequest("topicId=cktopic0000000000000000000&kind=TUTOR"));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe("AI_TUTOR_NOT_ENABLED");
    expect(access.getAccessibleAIScope).not.toHaveBeenCalled();
    expect(db.aIConversation.findFirst).not.toHaveBeenCalled();
  });

  it("F. never checks the aiTutor entitlement for a plain CHAT request", async () => {
    await GET(makeGetRequest("topicId=cktopic0000000000000000000"));
    expect(quotaModule.assertAiTutorEntitlement).not.toHaveBeenCalled();
  });

  it("never returns another user's conversation — findFirst is always scoped to the authenticated user's own id", async () => {
    await GET(makeGetRequest("topicId=cktopic0000000000000000000&kind=TUTOR"));
    expect(db.aIConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) })
    );
  });

  it("returns an existing conversation instead of creating a new one when one is already found", async () => {
    db.aIConversation.findFirst.mockResolvedValue({ id: "conv-existing", kind: "TUTOR", messages: [] });

    const res = await GET(makeGetRequest("topicId=cktopic0000000000000000000&kind=TUTOR"));
    const json = await res.json();

    expect(json.conversation.id).toBe("conv-existing");
    expect(db.aIConversation.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/conversations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleAIScope.mockResolvedValue(WORKSPACE_SCOPE);
    quotaModule.assertAiTutorEntitlement.mockResolvedValue(undefined);
    db.aIConversation.create.mockResolvedValue({ id: "conv-new", kind: "CHAT", messages: [] });
  });

  it("returns 401 when there is no authenticated user", async () => {
    access.getSessionUser.mockResolvedValue(null);
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(401);
  });

  it("A. creates a conversation with kind: CHAT by default", async () => {
    await POST(makePostRequest({ topicId: "cktopic0000000000000000000" }));

    expect(db.aIConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "CHAT" }) })
    );
  });

  it("A. creates a new TUTOR conversation for a valid Topic, always tied to the requesting user", async () => {
    await POST(makePostRequest({ topicId: "cktopic0000000000000000000", kind: "TUTOR" }));

    expect(quotaModule.assertAiTutorEntitlement).toHaveBeenCalledWith("user-1");
    expect(db.aIConversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-1", kind: "TUTOR" }) })
    );
  });

  it("A. rejects creating a TUTOR conversation without a topicId", async () => {
    const res = await POST(makePostRequest({ kind: "TUTOR" }));
    expect(res.status).toBe(400);
    expect(db.aIConversation.create).not.toHaveBeenCalled();
  });

  it("A. rejects an invalid kind value", async () => {
    const res = await POST(makePostRequest({ kind: "ADMIN" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when the underlying Topic isn't accessible, and never creates a conversation", async () => {
    access.getAccessibleAIScope.mockRejectedValue(new access.NotAuthorizedError());

    const res = await POST(makePostRequest({ topicId: "cktopic0000000000000000000", kind: "TUTOR" }));

    expect(res.status).toBe(403);
    expect(db.aIConversation.create).not.toHaveBeenCalled();
  });

  it("F. blocks TUTOR creation with 403 AI_TUTOR_NOT_ENABLED when the plan doesn't include it", async () => {
    quotaModule.assertAiTutorEntitlement.mockRejectedValue(
      new quotaModule.AITutorNotEnabledError({ label: "Free" })
    );

    const res = await POST(makePostRequest({ topicId: "cktopic0000000000000000000", kind: "TUTOR" }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe("AI_TUTOR_NOT_ENABLED");
    expect(db.aIConversation.create).not.toHaveBeenCalled();
  });
});
