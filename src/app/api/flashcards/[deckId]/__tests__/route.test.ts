import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  flashcard: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleFlashcardDeck: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

import { GET } from "@/app/api/flashcards/[deckId]/route";

function makeRequest(): Request {
  return new Request("https://example.test/api/flashcards/deck-1");
}

describe("GET /api/flashcards/[deckId]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleFlashcardDeck.mockResolvedValue({
      id: "deck-1",
      title: "Flashcards — Zeroth Law",
      ownerId: "user-1",
    });
    db.flashcard.findMany.mockResolvedValue([
      { id: "card-2", front: "Q2", back: "A2", sources: null, reviews: [] },
      {
        id: "card-1",
        front: "Q1",
        back: "A1",
        sources: null,
        reviews: [{ id: "review-1", flashcardId: "card-1", userId: "user-1", wasCorrect: true, reviewedAt: new Date("2026-01-01") }],
      },
    ]);
  });

  it("rejects with 401 when there is no authenticated user", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: { deckId: "deck-1" } });

    expect(res.status).toBe(401);
    expect(access.getAccessibleFlashcardDeck).not.toHaveBeenCalled();
  });

  it("returns 404 when the deck doesn't exist", async () => {
    access.getAccessibleFlashcardDeck.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: { deckId: "deck-1" } });

    expect(res.status).toBe(404);
  });

  it("returns 403 when the deck exists but the user isn't authorized for it", async () => {
    access.getAccessibleFlashcardDeck.mockRejectedValue(new access.NotAuthorizedError());

    const res = await GET(makeRequest(), { params: { deckId: "deck-1" } });

    expect(res.status).toBe(403);
  });

  it("returns the deck and its cards in stable id order for an authorized user", async () => {
    const res = await GET(makeRequest(), { params: { deckId: "deck-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.deck).toMatchObject({ id: "deck-1", title: "Flashcards — Zeroth Law" });
    expect(json.deck.cards.map((c: { id: string }) => c.id)).toEqual(["card-2", "card-1"]);
  });

  it("scopes the review include to the authenticated user only, taking just the latest review", async () => {
    await GET(makeRequest(), { params: { deckId: "deck-1" } });

    expect(db.flashcard.findMany).toHaveBeenCalledWith({
      where: { deckId: "deck-1" },
      orderBy: { id: "asc" },
      include: {
        reviews: {
          where: { userId: "user-1" },
          orderBy: { reviewedAt: "desc" },
          take: 1,
        },
      },
    });
  });

  it("exposes the current user's own latest review as a singular `review` field, not the raw `reviews` array", async () => {
    const res = await GET(makeRequest(), { params: { deckId: "deck-1" } });
    const json = await res.json();

    const cardWithReview = json.deck.cards.find((c: { id: string }) => c.id === "card-1");
    expect(cardWithReview.review).toMatchObject({ id: "review-1", wasCorrect: true });
    expect(cardWithReview.reviews).toBeUndefined();
  });

  it("returns `review: null` for a card the current user has never reviewed", async () => {
    const res = await GET(makeRequest(), { params: { deckId: "deck-1" } });
    const json = await res.json();

    const cardWithoutReview = json.deck.cards.find((c: { id: string }) => c.id === "card-2");
    expect(cardWithoutReview.review).toBeNull();
  });

  it("never returns another user's review — the Prisma query itself is scoped to the requester, so a review row belonging to a different user cannot appear here", async () => {
    // Simulates what the real database would do for user-2: its own
    // `where: { userId: "user-2" }` scope means user-1's review never
    // even reaches this array — asserting on the query args above is
    // the real security boundary. This test additionally proves the
    // response mapping doesn't defeat that by re-including anything
    // beyond what Prisma returned.
    db.flashcard.findMany.mockResolvedValue([
      { id: "card-1", front: "Q1", back: "A1", sources: null, reviews: [] },
    ]);
    access.getSessionUser.mockResolvedValue({ id: "user-2" });

    const res = await GET(makeRequest(), { params: { deckId: "deck-1" } });
    const json = await res.json();

    expect(json.deck.cards[0].review).toBeNull();
  });
});
