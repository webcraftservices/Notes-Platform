import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

const dueService = vi.hoisted(() => ({
  getDueFlashcardsForUser: vi.fn(),
}));
vi.mock("@/lib/srs/due-service", () => dueService);

import { GET } from "@/app/api/flashcards/due/route";

function makeRequest(query = ""): Request {
  return new Request(`https://example.test/api/flashcards/due${query}`);
}

describe("GET /api/flashcards/due", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    dueService.getDueFlashcardsForUser.mockResolvedValue({
      stats: {
        totalDecks: 1,
        totalCards: 4,
        dueCount: 2,
        overdueCount: 1,
        newCount: 1,
        learningCount: 0,
        reviewCount: 3,
        suspendedCount: 0,
        upcoming7DaysCount: 1,
      },
      queue: [
        {
          id: "card-1",
          deckId: "deck-1",
          deckTitle: "Thermodynamics",
          topicId: "topic-1",
          groupId: null,
          front: "What is entropy?",
          back: "A measure of disorder",
          sources: null,
          schedule: {
            state: "REVIEW",
            dueAt: "2026-11-10T00:00:00.000Z",
            lastReviewedAt: "2026-11-08T00:00:00.000Z",
            isDue: true,
            isOverdue: true,
            stability: 3.17,
            difficulty: 5.28,
            scheduledDays: 2,
            reps: 1,
            lapses: 0,
            intervals: {},
          },
        },
      ],
      decks: [],
      timezone: "UTC",
    });
  });

  it("rejects unauthenticated requests with 401", async () => {
    access.getSessionUser.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(dueService.getDueFlashcardsForUser).not.toHaveBeenCalled();
  });

  it("returns due queue and stats for authenticated user with default query parameters", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(dueService.getDueFlashcardsForUser).toHaveBeenCalledWith({
      userId: "user-1",
      deckId: undefined,
      scopeInput: {
        subjectId: undefined,
        chapterId: undefined,
        topicId: undefined,
        groupId: undefined,
      },
      includeNew: undefined,
      limit: undefined,
      newLimit: undefined,
    });
    expect(json.stats.dueCount).toBe(2);
    expect(json.queue).toHaveLength(1);
    expect(json.timezone).toBe("UTC");
  });

  it("forwards scope filters, deckId, includeNew=false, and custom limit", async () => {
    const res = await GET(
      makeRequest("?topicId=topic-9&deckId=deck-3&includeNew=false&limit=25&newLimit=10")
    );
    expect(res.status).toBe(200);

    expect(dueService.getDueFlashcardsForUser).toHaveBeenCalledWith({
      userId: "user-1",
      deckId: "deck-3",
      scopeInput: {
        subjectId: undefined,
        chapterId: undefined,
        topicId: "topic-9",
        groupId: undefined,
      },
      includeNew: false,
      limit: 25,
      newLimit: 10,
    });
  });

  it("returns 400 when limit is out of range", async () => {
    const res = await GET(makeRequest("?limit=999"));
    expect(res.status).toBe(400);
    expect(dueService.getDueFlashcardsForUser).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not authorized for the requested scope or deck", async () => {
    dueService.getDueFlashcardsForUser.mockRejectedValue(new access.NotAuthorizedError());
    const res = await GET(makeRequest("?groupId=group-secret"));
    expect(res.status).toBe(403);
  });
});
