import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleAIScope: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const studyProgress = vi.hoisted(() => ({ getStudyProgress: vi.fn() }));
vi.mock("@/lib/study-progress", () => studyProgress);

// lib/validation/ai.ts is NOT mocked, same convention as the AI
// conversations route tests — this exercises the real
// `aiScopeQuerySchema`, not an assumed shape.
import { GET } from "@/app/api/progress/route";

function makeRequest(query = ""): Request {
  return new Request(`https://example.test/api/progress${query ? `?${query}` : ""}`);
}

const EMPTY_PROGRESS = {
  quizzes: { attempts: 0, latest: null, bestScore: null, averageScore: null, history: [] },
  tutor: { sessions: 0, messages: 0, lastActiveAt: null },
};

const TOPIC_SCOPE = {
  ownerType: "workspace",
  workspaceId: "workspace-1",
  groupId: null,
  subjectId: "subject-1",
  chapterId: "chapter-1",
  topicId: "topic-1",
};

describe("GET /api/progress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    studyProgress.getStudyProgress.mockResolvedValue(EMPTY_PROGRESS);
  });

  it("rejects with 401 when there is no authenticated user", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(studyProgress.getStudyProgress).not.toHaveBeenCalled();
  });

  it("returns global progress with no scope query params, skipping scope resolution entirely", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(EMPTY_PROGRESS);
    expect(access.getAccessibleAIScope).not.toHaveBeenCalled();
    expect(studyProgress.getStudyProgress).toHaveBeenCalledWith("user-1", undefined);
  });

  it("resolves and authorizes a topicId scope before aggregating", async () => {
    access.getAccessibleAIScope.mockResolvedValue(TOPIC_SCOPE);
    const topicId = "cktopic0000000000000000000";

    const res = await GET(makeRequest(`topicId=${topicId}`));

    expect(res.status).toBe(200);
    expect(access.getAccessibleAIScope).toHaveBeenCalledWith({ topicId }, "user-1");
    expect(studyProgress.getStudyProgress).toHaveBeenCalledWith("user-1", TOPIC_SCOPE);
  });

  it("rejects a malformed scope query with 400 and never calls the service", async () => {
    const res = await GET(makeRequest("topicId=not-a-cuid"));

    expect(res.status).toBe(400);
    expect(studyProgress.getStudyProgress).not.toHaveBeenCalled();
  });

  it("returns 403 for an inaccessible scope, never a misleading empty 200", async () => {
    access.getAccessibleAIScope.mockRejectedValue(new access.NotAuthorizedError());

    const res = await GET(makeRequest("topicId=cktopic0000000000000000000"));

    expect(res.status).toBe(403);
    expect(studyProgress.getStudyProgress).not.toHaveBeenCalled();
  });

  it("returns the expected response shape", async () => {
    const populated = {
      quizzes: {
        attempts: 2,
        latest: { id: "a2", quizId: "q1", quizTitle: "Quiz", score: 90, startedAt: new Date(), completedAt: new Date() },
        bestScore: 90,
        averageScore: 75,
        history: [],
      },
      tutor: { sessions: 1, messages: 5, lastActiveAt: new Date().toISOString() },
    };
    studyProgress.getStudyProgress.mockResolvedValue(populated);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body).toHaveProperty("quizzes.attempts", 2);
    expect(body).toHaveProperty("tutor.sessions", 1);
  });

  it("isolates users — a request as a different session user asks for a different userId", async () => {
    access.getSessionUser.mockResolvedValue({ id: "user-2" });

    await GET(makeRequest());

    expect(studyProgress.getStudyProgress).toHaveBeenCalledWith("user-2", undefined);
  });
});
