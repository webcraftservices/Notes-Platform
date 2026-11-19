import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  flashcard: { findFirst: vi.fn() },
  flashcardReview: { create: vi.fn(), findFirst: vi.fn() },
  $transaction: undefined as ReturnType<typeof vi.fn> | undefined,
  $executeRaw: undefined as ReturnType<typeof vi.fn> | undefined,
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
    db.$transaction = undefined;
    db.$executeRaw = undefined;
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

  it("computes and persists FSRS-4.5 state when a 4-point rating (AGAIN/HARD/GOOD/EASY) is submitted", async () => {
    db.flashcardReview.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ flashcardId: "card-1", rating: "GOOD" }), {
      params: { deckId: "deck-1" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(db.flashcardReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          flashcardId: "card-1",
          userId: "user-1",
          wasCorrect: true,
          rating: "GOOD",
          stateBefore: "NEW",
          state: "REVIEW",
          scheduledDays: 2,
          reps: 1,
          lapses: 0,
        }),
      })
    );
    expect(json.schedule).toMatchObject({
      state: "REVIEW",
      scheduledDays: 2,
      reps: 1,
    });
    expect(json.duplicate).toBe(false);
  });

  it("handles SUSPEND and UNSUSPEND actions while preserving stability and difficulty and persisting rating: null", async () => {
    db.flashcardReview.findFirst.mockResolvedValueOnce({
      id: "rev-prev",
      flashcardId: "card-1",
      userId: "user-1",
      wasCorrect: true,
      reviewedAt: new Date("2026-01-05T10:00:00.000Z"),
      rating: "GOOD",
      stateBefore: "NEW",
      state: "REVIEW",
      stability: 3.17,
      difficulty: 5.28,
      elapsedDays: 0,
      scheduledDays: 2,
      reps: 1,
      lapses: 0,
      dueAt: new Date("2026-01-07T10:00:00.000Z"),
    });

    const res = await POST(makeRequest({ flashcardId: "card-1", action: "SUSPEND" }), {
      params: { deckId: "deck-1" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.schedule.state).toBe("SUSPENDED");
    expect(json.schedule.stability).toBeCloseTo(3.17, 2);
    expect(db.flashcardReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rating: null,
          stateBefore: "REVIEW",
          state: "SUSPENDED",
        }),
      })
    );

    // Now UNSUSPEND from SUSPENDED state -> persists rating: null, stateBefore: "SUSPENDED", state: "REVIEW"
    db.flashcardReview.findFirst.mockResolvedValueOnce({
      id: "rev-suspended",
      flashcardId: "card-1",
      userId: "user-1",
      wasCorrect: true,
      reviewedAt: new Date("2026-01-05T10:05:00.000Z"),
      rating: null,
      stateBefore: "REVIEW",
      state: "SUSPENDED",
      stability: 3.17,
      difficulty: 5.28,
      elapsedDays: 0,
      scheduledDays: 2,
      reps: 1,
      lapses: 0,
      dueAt: null,
    });

    const unsuspendRes = await POST(makeRequest({ flashcardId: "card-1", action: "UNSUSPEND" }), {
      params: { deckId: "deck-1" },
    });
    expect(unsuspendRes.status).toBe(200);
    const unsuspendJson = await unsuspendRes.json();
    expect(unsuspendJson.schedule.state).toBe("REVIEW");
    expect(db.flashcardReview.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rating: null,
          stateBefore: "SUSPENDED",
          state: "REVIEW",
        }),
      })
    );
  });

  it("returns 409 CARD_NOT_SUSPENDED when UNSUSPEND is called on a non-suspended card", async () => {
    db.flashcardReview.findFirst.mockResolvedValueOnce({
      id: "rev-active",
      flashcardId: "card-1",
      userId: "user-1",
      wasCorrect: true,
      reviewedAt: new Date("2026-01-05T10:00:00.000Z"),
      rating: "GOOD",
      stateBefore: "NEW",
      state: "REVIEW",
      stability: 2.4,
      difficulty: 4.93,
      elapsedDays: 0,
      scheduledDays: 2,
      reps: 1,
      lapses: 0,
      dueAt: new Date("2026-01-07T10:00:00.000Z"),
    });

    const res = await POST(makeRequest({ flashcardId: "card-1", action: "UNSUSPEND" }), {
      params: { deckId: "deck-1" },
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("CARD_NOT_SUSPENDED");
    expect(db.flashcardReview.create).not.toHaveBeenCalled();
  });

  it("deduplicates submissions matching an existing idempotencyKey without creating a second row", async () => {
    db.flashcardReview.findFirst.mockResolvedValueOnce({
      id: "existing-rev",
      flashcardId: "card-1",
      userId: "user-1",
      wasCorrect: true,
      reviewedAt: new Date("2026-01-05T10:00:00.000Z"),
      rating: "EASY",
      stateBefore: "NEW",
      state: "REVIEW",
      stability: 8.5,
      difficulty: 3.2,
      elapsedDays: 0,
      scheduledDays: 6,
      reps: 1,
      lapses: 0,
      dueAt: new Date("2026-01-11T10:00:00.000Z"),
      idempotencyKey: "idem-key-123",
    });

    const res = await POST(
      makeRequest({ flashcardId: "card-1", rating: "EASY", idempotencyKey: "idem-key-123" }),
      { params: { deckId: "deck-1" } }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicate).toBe(true);
    expect(json.review.id).toBe("existing-rev");
    expect(db.flashcardReview.create).not.toHaveBeenCalled();
  });

  describe("AUD-13-02: Per-card advisory lock serialization, concurrent submissions, and idempotency conflict handling", () => {
    interface InMemoryReviewRow {
      id: string;
      flashcardId: string;
      userId: string;
      wasCorrect: boolean;
      selfRating: string | null;
      rating: string | null;
      stateBefore: string;
      state: string;
      stability: number;
      difficulty: number;
      elapsedDays: number;
      scheduledDays: number;
      reps: number;
      lapses: number;
      dueAt: Date | null;
      algorithmVersion: string;
      idempotencyKey: string | null;
      reviewedAt: Date;
    }

    function createSerializedReviewStore(initialReviews: InMemoryReviewRow[] = []) {
      const persisted: InMemoryReviewRow[] = [...initialReviews];
      const advisoryLocksTaken: string[] = [];
      let lockChain = Promise.resolve();
      let idSeq = persisted.length + 1;

      db.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        let releaseLock!: () => void;
        const prevLock = lockChain;
        lockChain = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });

        await prevLock;

        // Stage writes inside transaction so rollback discards uncommitted changes
        const staged: InMemoryReviewRow[] = persisted.map((r) => ({ ...r }));

        const txClient = {
          $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const rendered = strings.reduce(
              (acc, str, idx) => acc + str + (idx < values.length ? String(values[idx]) : ""),
              ""
            );
            advisoryLocksTaken.push(rendered);
            return 1;
          }),
          flashcardReview: {
            findFirst: vi.fn(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
              const where = args?.where ?? {};
              const matches = staged.filter((row) => {
                if (where.userId !== undefined && row.userId !== where.userId) return false;
                if (where.flashcardId !== undefined && row.flashcardId !== where.flashcardId) return false;
                if (where.idempotencyKey !== undefined && row.idempotencyKey !== where.idempotencyKey) return false;
                return true;
              });
              if (matches.length === 0) return null;
              if (args?.orderBy) {
                matches.sort((a, b) => {
                  const timeDiff = b.reviewedAt.getTime() - a.reviewedAt.getTime();
                  if (timeDiff !== 0) return timeDiff;
                  return b.id.localeCompare(a.id);
                });
              }
              return matches[0];
            }),
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
              if (data.idempotencyKey) {
                const dup = staged.find(
                  (r) => r.userId === data.userId && r.idempotencyKey === data.idempotencyKey
                );
                if (dup) {
                  const err = Object.assign(new Error("Unique constraint failed on the fields: (`userId`,`idempotencyKey`)"), {
                    code: "P2002",
                  });
                  throw err;
                }
              }
              const created: InMemoryReviewRow = {
                id: `rev-${idSeq++}`,
                flashcardId: String(data.flashcardId),
                userId: String(data.userId),
                wasCorrect: Boolean(data.wasCorrect),
                selfRating: (data.selfRating as string | null) ?? null,
                rating: (data.rating as string | null) ?? null,
                stateBefore: String(data.stateBefore ?? "NEW"),
                state: String(data.state ?? "REVIEW"),
                stability: Number(data.stability ?? 0),
                difficulty: Number(data.difficulty ?? 0),
                elapsedDays: Number(data.elapsedDays ?? 0),
                scheduledDays: Number(data.scheduledDays ?? 0),
                reps: Number(data.reps ?? 0),
                lapses: Number(data.lapses ?? 0),
                dueAt: (data.dueAt as Date | null) ?? null,
                algorithmVersion: String(data.algorithmVersion ?? "fsrs-4.5"),
                idempotencyKey: (data.idempotencyKey as string | null) ?? null,
                reviewedAt: (data.reviewedAt as Date) ?? new Date(),
              };
              staged.push(created);
              return created;
            }),
          },
        };

        try {
          const result = await fn(txClient);
          persisted.splice(0, persisted.length, ...staged);
          return result;
        } finally {
          releaseLock();
        }
      });

      return { persisted, advisoryLocksTaken };
    }

    it("1. handles two simultaneous requests with the same idempotencyKey without duplicate insert or 500 error", async () => {
      const { persisted, advisoryLocksTaken } = createSerializedReviewStore();

      const [res1, res2] = await Promise.all([
        POST(makeRequest({ flashcardId: "card-1", rating: "GOOD", idempotencyKey: "concurrent-same-key" }), {
          params: { deckId: "deck-1" },
        }),
        POST(makeRequest({ flashcardId: "card-1", rating: "GOOD", idempotencyKey: "concurrent-same-key" }), {
          params: { deckId: "deck-1" },
        }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const [json1, json2] = await Promise.all([res1.json(), res2.json()]);

      // Exactly 1 review row persisted; one response is original (duplicate: false), the second is duplicate: true
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.reps).toBe(1);
      expect(persisted[0]!.state).toBe("REVIEW");
      expect([json1.duplicate, json2.duplicate].sort()).toEqual([false, true]);
      expect(json1.review.id).toBe(json2.review.id);
      expect(advisoryLocksTaken[0]).toContain("pg_advisory_xact_lock");
      expect(advisoryLocksTaken[0]).toContain("flashcard_review:user-1:card-1");
    });

    it("1b. recovers cleanly via fresh query outside aborted transaction when P2002 is raised on concurrent idempotencyKey collision", async () => {
      const winningRow = {
        id: "rev-winner",
        flashcardId: "card-1",
        userId: "user-1",
        wasCorrect: true,
        reviewedAt: new Date("2026-01-05T10:00:00.000Z"),
        rating: "GOOD",
        stateBefore: "NEW",
        state: "REVIEW",
        stability: 3.17,
        difficulty: 5.28,
        elapsedDays: 0,
        scheduledDays: 2,
        reps: 1,
        lapses: 0,
        dueAt: new Date("2026-01-07T10:00:00.000Z"),
        idempotencyKey: "race-p2002-key",
      };

      // Simulate transaction throwing Prisma P2002 after another transaction committed the key
      db.$transaction = vi.fn().mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed on the fields: (`userId`,`idempotencyKey`)"), {
          code: "P2002",
        })
      );
      // Outside the aborted transaction, db.flashcardReview.findFirst fetches the committed winning row
      db.flashcardReview.findFirst.mockResolvedValueOnce(winningRow);

      const res = await POST(
        makeRequest({ flashcardId: "card-1", rating: "GOOD", idempotencyKey: "race-p2002-key" }),
        { params: { deckId: "deck-1" } }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.duplicate).toBe(true);
      expect(json.review.id).toBe("rev-winner");
      expect(json.schedule.reps).toBe(1);
    });

    it("2. serializes two simultaneous requests with different idempotencyKeys for the same card so reps and FSRS state advance sequentially", async () => {
      const { persisted } = createSerializedReviewStore();

      const [res1, res2] = await Promise.all([
        POST(makeRequest({ flashcardId: "card-1", rating: "GOOD", idempotencyKey: "key-step-1" }), {
          params: { deckId: "deck-1" },
        }),
        POST(makeRequest({ flashcardId: "card-1", rating: "GOOD", idempotencyKey: "key-step-2" }), {
          params: { deckId: "deck-1" },
        }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      expect(persisted).toHaveLength(2);
      expect(persisted[0]!.stateBefore).toBe("NEW");
      expect(persisted[0]!.state).toBe("REVIEW");
      expect(persisted[0]!.reps).toBe(1);
      expect(persisted[0]!.lapses).toBe(0);

      // Second review must build upon the first review's committed state (stateBefore = REVIEW, reps = 2)
      expect(persisted[1]!.stateBefore).toBe("REVIEW");
      expect(persisted[1]!.state).toBe("REVIEW");
      expect(persisted[1]!.reps).toBe(2);
      expect(persisted[1]!.lapses).toBe(0);
      expect(persisted[1]!.dueAt).toBeInstanceOf(Date);
      expect(persisted[1]!.reviewedAt.getTime()).toBeGreaterThan(persisted[0]!.reviewedAt.getTime());
    });

    it("3. serializes two simultaneous requests without an idempotencyKey for the same card (GOOD followed by AGAIN -> reps=2, lapses=1, RELEARNING)", async () => {
      const { persisted } = createSerializedReviewStore();

      const [res1, res2] = await Promise.all([
        POST(makeRequest({ flashcardId: "card-1", rating: "GOOD" }), {
          params: { deckId: "deck-1" },
        }),
        POST(makeRequest({ flashcardId: "card-1", rating: "AGAIN" }), {
          params: { deckId: "deck-1" },
        }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      expect(persisted).toHaveLength(2);
      expect(persisted[0]!.reps).toBe(1);
      expect(persisted[0]!.lapses).toBe(0);
      expect(persisted[0]!.state).toBe("REVIEW");

      // Second review sees the committed REVIEW state from first review, so AGAIN increments lapses to 1 and enters RELEARNING
      expect(persisted[1]!.stateBefore).toBe("REVIEW");
      expect(persisted[1]!.state).toBe("RELEARNING");
      expect(persisted[1]!.reps).toBe(2);
      expect(persisted[1]!.lapses).toBe(1);
      expect(persisted[1]!.dueAt).toBeInstanceOf(Date);
    });

    it("4. returns HTTP 409 IDEMPOTENCY_KEY_CONFLICT when the same idempotencyKey is reused with a different flashcardId", async () => {
      db.flashcard.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        deckId: "deck-1",
        front: "Q",
        back: "A",
      }));

      const { persisted } = createSerializedReviewStore();

      const firstRes = await POST(
        makeRequest({ flashcardId: "card-1", rating: "GOOD", idempotencyKey: "shared-idem-key" }),
        { params: { deckId: "deck-1" } }
      );
      expect(firstRes.status).toBe(200);

      const conflictRes = await POST(
        makeRequest({ flashcardId: "card-2", rating: "GOOD", idempotencyKey: "shared-idem-key" }),
        { params: { deckId: "deck-1" } }
      );
      expect(conflictRes.status).toBe(409);
      const conflictJson = await conflictRes.json();
      expect(conflictJson.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
      expect(persisted).toHaveLength(1);
    });

    it("5. returns HTTP 409 IDEMPOTENCY_KEY_CONFLICT when the same idempotencyKey is reused with a different rating or action", async () => {
      const { persisted } = createSerializedReviewStore();

      const firstRes = await POST(
        makeRequest({ flashcardId: "card-1", rating: "GOOD", idempotencyKey: "rating-conflict-key" }),
        { params: { deckId: "deck-1" } }
      );
      expect(firstRes.status).toBe(200);

      // Reusing same key with rating: "AGAIN"
      const diffRatingRes = await POST(
        makeRequest({ flashcardId: "card-1", rating: "AGAIN", idempotencyKey: "rating-conflict-key" }),
        { params: { deckId: "deck-1" } }
      );
      expect(diffRatingRes.status).toBe(409);
      const diffRatingJson = await diffRatingRes.json();
      expect(diffRatingJson.code).toBe("IDEMPOTENCY_KEY_CONFLICT");

      // Reusing same key with action: "SUSPEND"
      const diffActionRes = await POST(
        makeRequest({ flashcardId: "card-1", action: "SUSPEND", idempotencyKey: "rating-conflict-key" }),
        { params: { deckId: "deck-1" } }
      );
      expect(diffActionRes.status).toBe(409);
      const diffActionJson = await diffActionRes.json();
      expect(diffActionJson.code).toBe("IDEMPOTENCY_KEY_CONFLICT");

      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.rating).toBe("GOOD");
    });

    it("6. rolls back uncommitted review state on transaction failure so prior card state remains intact", async () => {
      const { persisted } = createSerializedReviewStore();

      // First review succeeds
      const okRes = await POST(makeRequest({ flashcardId: "card-1", rating: "GOOD" }), {
        params: { deckId: "deck-1" },
      });
      expect(okRes.status).toBe(200);
      expect(persisted).toHaveLength(1);

      // Simulate unexpected database failure inside the second transaction
      db.$transaction!.mockRejectedValueOnce(new Error("Simulated database serialization failure"));

      await expect(
        POST(makeRequest({ flashcardId: "card-1", rating: "AGAIN" }), {
          params: { deckId: "deck-1" },
        })
      ).rejects.toThrow("Simulated database serialization failure");

      // Persisted state remains at the first committed review
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.reps).toBe(1);
      expect(persisted[0]!.lapses).toBe(0);
      expect(persisted[0]!.state).toBe("REVIEW");
    });
  });
});
