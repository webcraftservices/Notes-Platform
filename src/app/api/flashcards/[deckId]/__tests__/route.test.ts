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
      { id: "card-2", front: "Q2", back: "A2", sources: null },
      { id: "card-1", front: "Q1", back: "A1", sources: null },
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
    expect(db.flashcard.findMany).toHaveBeenCalledWith({
      where: { deckId: "deck-1" },
      orderBy: { id: "asc" },
    });
  });

  it("never returns FlashcardReview rows — deck content is shared, review activity is private", async () => {
    const res = await GET(makeRequest(), { params: { deckId: "deck-1" } });
    const json = await res.json();

    expect(json.deck.reviews).toBeUndefined();
  });
});
