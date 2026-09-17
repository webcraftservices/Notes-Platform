import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  flashcard: { findFirst: vi.fn() },
  flashcardReview: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleFlashcardDeck: vi.fn(),
  NotAuthorizedError: class NotAuthorizedError extends Error {},
}));
vi.mock("@/lib/access", () => access);

import { POST } from "@/app/api/flashcards/[deckId]/reviews/route";

function makeRequest(body: unknown): Request {
  return new Request("https://example.test/api/flashcards/deck-1/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/flashcards/[deckId]/reviews", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    access.getAccessibleFlashcardDeck.mockResolvedValue({
      id: "deck-1",
      title: "Flashcards — Zeroth Law",
      ownerId: "user-1",
    });
    db.flashcard.findFirst.mockResolvedValue({ id: "card-1", deckId: "deck-1", front: "Q1", back: "A1" });
    db.flashcardReview.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "review-1",
      reviewedAt: new Date("2026-01-01"),
      ...data,
    }));
  });

  it("rejects with 401 when there is no authenticated user", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await POST(makeRequest({ flashcardId: "card-1", wasCorrect: true }), {
      params: { deckId: "deck-1" },
    });

    expect(res.status).toBe(401);
    expect(access.getAccessibleFlashcardDeck).not.toHaveBeenCalled();
  });

  it("returns 404 when the deck doesn't exist", async () => {
    access.getAccessibleFlashcardDeck.mockResolvedValue(null);

    const res = await POST(makeRequest({ flashcardId: "card-1", wasCorrect: true }), {
      params: { deckId: "deck-1" },
    });

    expect(res.status).toBe(404);
  });

  it("returns 403 when the deck exists but the user isn't authorized for it (owned deck)", async () => {
    access.getAccessibleFlashcardDeck.mockRejectedValue(new access.NotAuthorizedError());

    const res = await POST(makeRequest({ flashcardId: "card-1", wasCorrect: true }), {
      params: { deckId: "deck-1" },
    });

    expect(res.status).toBe(403);
    expect(db.flashcardReview.create).not.toHaveBeenCalled();
  });

  it("allows an authorized group member to review a group-owned deck", async () => {
    access.getAccessibleFlashcardDeck.mockResolvedValue({
      id: "deck-1",
      title: "Group Deck",
      ownerId: "owner-user",
      groupId: "group-1",
    });

    const res = await POST(makeRequest({ flashcardId: "card-1", wasCorrect: true }), {
      params: { deckId: "deck-1" },
    });

    expect(res.status).toBe(200);
    expect(db.flashcardReview.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-1" }) })
    );
  });

  it("rejects a missing flashcardId with 400", async () => {
    const res = await POST(makeRequest({ wasCorrect: true }), { params: { deckId: "deck-1" } });

    expect(res.status).toBe(400);
    expect(db.flashcardReview.create).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean wasCorrect with 400", async () => {
    const res = await POST(makeRequest({ flashcardId: "card-1", wasCorrect: "yes" }), {
      params: { deckId: "deck-1" },
    });

    expect(res.status).toBe(400);
    expect(db.flashcardReview.create).not.toHaveBeenCalled();
  });

  it("rejects a missing wasCorrect with 400", async () => {
    const res = await POST(makeRequest({ flashcardId: "card-1" }), { params: { deckId: "deck-1" } });

    expect(res.status).toBe(400);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await POST(new Request("https://example.test/api/flashcards/deck-1/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }), { params: { deckId: "deck-1" } });

    expect(res.status).toBe(400);
  });

  it("rejects with 400 when flashcardId doesn't exist at all", async () => {
    db.flashcard.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ flashcardId: "nonexistent", wasCorrect: true }), {
      params: { deckId: "deck-1" },
    });

    expect(res.status).toBe(400);
    expect(db.flashcardReview.create).not.toHaveBeenCalled();
  });

  it("rejects with 400 when flashcardId belongs to a different deck (IDOR protection) — the lookup is scoped to this deck's id", async () => {
    // A flashcard that's real, and even one the caller could otherwise
    // reach via a different deck they also have access to, must still
    // fail here because the lookup itself is `{ id, deckId: deck.id }` —
    // simulated by having the scoped findFirst return null.
    db.flashcard.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ flashcardId: "card-from-other-deck", wasCorrect: true }), {
      params: { deckId: "deck-1" },
    });

    expect(res.status).toBe(400);
    expect(db.flashcard.findFirst).toHaveBeenCalledWith({
      where: { id: "card-from-other-deck", deckId: "deck-1" },
    });
    expect(db.flashcardReview.create).not.toHaveBeenCalled();
  });

  it("cannot be attributed to a client-supplied userId — the review is always created for the authenticated session user", async () => {
    const res = await POST(
      // Deliberately probing that an extra `userId` field on the request body has no effect.
      makeRequest({ flashcardId: "card-1", wasCorrect: true, userId: "someone-else" }),
      { params: { deckId: "deck-1" } }
    );

    expect(res.status).toBe(200);
    expect(db.flashcardReview.create).toHaveBeenCalledWith({
      data: { flashcardId: "card-1", userId: "user-1", wasCorrect: true },
    });
  });

  it("persists wasCorrect exactly as submitted (Known → true)", async () => {
    await POST(makeRequest({ flashcardId: "card-1", wasCorrect: true }), { params: { deckId: "deck-1" } });

    expect(db.flashcardReview.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ wasCorrect: true }) })
    );
  });

  it("persists wasCorrect exactly as submitted (Not Known → false)", async () => {
    await POST(makeRequest({ flashcardId: "card-1", wasCorrect: false }), { params: { deckId: "deck-1" } });

    expect(db.flashcardReview.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ wasCorrect: false }) })
    );
  });

  it("allows multiple reviews for the same card — no uniqueness constraint, each call creates a new row", async () => {
    await POST(makeRequest({ flashcardId: "card-1", wasCorrect: false }), { params: { deckId: "deck-1" } });
    await POST(makeRequest({ flashcardId: "card-1", wasCorrect: true }), { params: { deckId: "deck-1" } });

    expect(db.flashcardReview.create).toHaveBeenCalledTimes(2);
  });

  it("returns the sanitized created review in the response", async () => {
    const res = await POST(makeRequest({ flashcardId: "card-1", wasCorrect: true }), {
      params: { deckId: "deck-1" },
    });
    const json = await res.json();

    expect(json.review).toMatchObject({ id: "review-1", flashcardId: "card-1", wasCorrect: true });
  });
});
