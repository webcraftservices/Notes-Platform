import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  flashcard: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleFlashcardDeck: vi.fn(),
  requireGroupRole: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

import { POST } from "@/app/api/flashcards/[deckId]/cards/route";
import { PATCH, DELETE } from "@/app/api/flashcards/[deckId]/cards/[cardId]/route";

describe("Flashcard Card CRUD API (/api/flashcards/[deckId]/cards)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleFlashcardDeck.mockResolvedValue({
      id: "deck-1",
      title: "Deck 1",
      ownerId: "user-1",
      groupId: null,
    });
  });

  it("POST creates a new card with initial NEW schedule for the deck owner", async () => {
    db.flashcard.create.mockResolvedValue({
      id: "card-new",
      deckId: "deck-1",
      front: "Front text",
      back: "Back text",
      sources: null,
    });

    const req = new Request("https://example.test/api/flashcards/deck-1/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ front: "Front text", back: "Back text" }),
    });

    const res = await POST(req, { params: { deckId: "deck-1" } });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.card).toMatchObject({
      id: "card-new",
      front: "Front text",
      back: "Back text",
      review: null,
    });
    expect(json.card.schedule.state).toBe("NEW");
  });

  it("PATCH updates front/back when the card belongs to the deck", async () => {
    db.flashcard.findFirst.mockResolvedValue({ id: "card-1" });
    db.flashcard.update.mockResolvedValue({
      id: "card-1",
      deckId: "deck-1",
      front: "Updated Front",
      back: "Updated Back",
    });

    const req = new Request("https://example.test/api/flashcards/deck-1/cards/card-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ front: "Updated Front", back: "Updated Back" }),
    });

    const res = await PATCH(req, { params: { deckId: "deck-1", cardId: "card-1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.card.front).toBe("Updated Front");
  });

  it("PATCH returns 404 when the card does not belong to the specified deck (IDOR guard)", async () => {
    db.flashcard.findFirst.mockResolvedValue(null);

    const req = new Request("https://example.test/api/flashcards/deck-1/cards/other-deck-card", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ front: "Attempt" }),
    });

    const res = await PATCH(req, { params: { deckId: "deck-1", cardId: "other-deck-card" } });
    expect(res.status).toBe(404);
    expect(db.flashcard.update).not.toHaveBeenCalled();
  });

  it("DELETE removes a card belonging to the deck", async () => {
    db.flashcard.findFirst.mockResolvedValue({ id: "card-1" });
    db.flashcard.delete.mockResolvedValue({ id: "card-1" });

    const req = new Request("https://example.test/api/flashcards/deck-1/cards/card-1", {
      method: "DELETE",
    });

    const res = await DELETE(req, { params: { deckId: "deck-1", cardId: "card-1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ deleted: true, id: "card-1" });
  });
});

