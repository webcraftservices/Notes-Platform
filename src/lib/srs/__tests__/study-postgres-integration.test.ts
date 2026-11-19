import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";
import { POST as submitReviewRoute } from "@/app/api/flashcards/[deckId]/reviews/route";
import { getDueFlashcardsForUser } from "@/lib/srs/due-service";
import {
  deriveCardStateFromReview,
  scheduleNextReview,
  suspendCardState,
  unsuspendCardState,
  type PersistedReviewRecord,
} from "@/lib/srs/fsrs";
import { getStudyProgress, computeQuizMastery } from "@/lib/study-progress";
import {
  assertIsolatedTestDatabaseConfig,
  hasStrictIsolatedTestDb,
  verifyLiveIsolatedDatabaseIdentity,
} from "@/lib/testing/isolated-db-guard";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

const RUN_ID = `p13_audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const hasIsolatedTestDb = hasStrictIsolatedTestDb();

describe.skipIf(!hasIsolatedTestDb)(
  "Phase 13 Live PostgreSQL Integration Suite (FSRS-4.5, Due Queue, Progress & Privacy)",
  () => {
    let userAId = "";
    let userBId = "";
    let wsAId = "";
    let subAId = "";
    let chapAId = "";
    let topAId = "";
    let deckAId = "";
    let card1Id = "";
    let card2Id = "";
    let quizAId = "";

    async function cleanupP13Fixtures() {
      const users = await db.user.findMany({
        where: { email: { startsWith: "p13_audit_", endsWith: "@zenote.test" } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);
      if (userIds.length === 0) return;

      await db.flashcardReview.deleteMany({ where: { userId: { in: userIds } } });
      await db.quizAttempt.deleteMany({ where: { userId: { in: userIds } } });
      await db.quiz.deleteMany({ where: { ownerId: { in: userIds } } });
      await db.flashcardDeck.deleteMany({ where: { ownerId: { in: userIds } } });
      await db.topic.deleteMany({
        where: { chapter: { subject: { workspace: { ownerId: { in: userIds } } } } },
      });
      await db.chapter.deleteMany({
        where: { subject: { workspace: { ownerId: { in: userIds } } } },
      });
      await db.subject.deleteMany({
        where: { workspace: { ownerId: { in: userIds } } },
      });
      await db.workspaceMember.deleteMany({ where: { userId: { in: userIds } } });
      await db.workspace.deleteMany({ where: { ownerId: { in: userIds } } });
      await db.profile.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }

    beforeAll(async () => {
      const verifiedUrl = assertIsolatedTestDatabaseConfig();
      await verifyLiveIsolatedDatabaseIdentity(db, verifiedUrl);

      await cleanupP13Fixtures();

      const userA = await db.user.create({
        data: {
          email: `${RUN_ID}_a@zenote.test`,
          name: "Phase 13 Learner A",
          profile: {
            create: {
              timezone: "America/New_York",
            },
          },
        },
      });
      userAId = userA.id;

      const userB = await db.user.create({
        data: {
          email: `${RUN_ID}_b@zenote.test`,
          name: "Phase 13 Learner B",
        },
      });
      userBId = userB.id;

      const wsA = await db.workspace.create({
        data: {
          name: "P13 Workspace A",
          slug: `${RUN_ID}-ws-a`,
          ownerId: userAId,
          members: { create: { userId: userAId, role: "OWNER" } },
        },
      });
      wsAId = wsA.id;

      await db.workspace.create({
        data: {
          name: "P13 Workspace B",
          slug: `${RUN_ID}-ws-b`,
          ownerId: userBId,
          members: { create: { userId: userBId, role: "OWNER" } },
        },
      });

      const subA = await db.subject.create({
        data: {
          name: "Neurobiology",
          workspaceId: wsAId,
        },
      });
      subAId = subA.id;

      const chapA = await db.chapter.create({
        data: {
          name: "Synaptic Transmission",
          subjectId: subAId,
        },
      });
      chapAId = chapA.id;

      const topA = await db.topic.create({
        data: {
          name: "Action Potentials",
          chapterId: chapAId,
        },
      });
      topAId = topA.id;

      const deckA = await db.flashcardDeck.create({
        data: {
          title: "Action Potential Flashcards",
          ownerId: userAId,
          workspaceId: wsAId,
          subjectId: subAId,
          chapterId: chapAId,
          topicId: topAId,
        },
      });
      deckAId = deckA.id;

      const c1 = await db.flashcard.create({
        data: {
          deckId: deckAId,
          front: "What ion influx depolarizes the axon membrane during the rising phase?",
          back: "Voltage-gated Na+ (sodium) influx.",
        },
      });
      card1Id = c1.id;

      const c2 = await db.flashcard.create({
        data: {
          deckId: deckAId,
          front: "What ion efflux repolarizes the neuron during the falling phase?",
          back: "Voltage-gated K+ (potassium) efflux.",
        },
      });
      card2Id = c2.id;

      const quizA = await db.quiz.create({
        data: {
          title: "Action Potentials Quiz",
          ownerId: userAId,
          workspaceId: wsAId,
          subjectId: subAId,
          chapterId: chapAId,
          topicId: topAId,
          questions: {
            create: [
              {
                prompt: "Does Na+ influx cause depolarization?",
                questionType: "TRUE_FALSE",
                correctAnswer: true,
                order: 0,
              },
            ],
          },
        },
      });
      quizAId = quizA.id;
    }, 30_000);

    afterAll(async () => {
      await cleanupP13Fixtures();
    }, 30_000);

    it("1. computes due queue and new counts in user's configured timezone before any reviews", async () => {
      const now = new Date("2026-11-11T15:00:00.000Z");
      const due = await getDueFlashcardsForUser({
        userId: userAId,
        now,
      });

      expect(due).not.toBeNull();
      expect(due!.timezone).toBe("America/New_York");
      expect(due!.stats).toMatchObject({
        totalCards: 2,
        newCount: 2,
        dueCount: 0,
        reviewCount: 0,
        learningCount: 0,
        suspendedCount: 0,
      });
      expect(due!.queue.map((q) => q.id)).toEqual([card1Id, card2Id]);
    });

    it("2. persists FSRS-4.5 transitions (NEW -> REVIEW -> RELEARNING -> SUSPENDED -> REVIEW) and enforces unique (userId, idempotencyKey) in live PostgreSQL", async () => {
      const t0 = new Date("2026-11-01T14:00:00.000Z");

      // Step 1: Rate card 1 GOOD on Nov 1 -> enters REVIEW with 2d interval (due Nov 3)
      const initial = deriveCardStateFromReview(null);
      const step1 = scheduleNextReview(initial, "GOOD", t0);

      const rev1 = await db.flashcardReview.create({
        data: {
          flashcardId: card1Id,
          userId: userAId,
          wasCorrect: step1.wasCorrect,
          selfRating: step1.selfRating,
          rating: step1.rating,
          stateBefore: step1.stateBefore,
          state: step1.state,
          stability: step1.stability,
          difficulty: step1.difficulty,
          elapsedDays: step1.elapsedDays,
          scheduledDays: step1.scheduledDays,
          reps: step1.reps,
          lapses: step1.lapses,
          dueAt: step1.dueAt,
          algorithmVersion: step1.algorithmVersion,
          idempotencyKey: `${RUN_ID}-idem-1`,
          reviewedAt: t0,
        },
      });

      expect(rev1.state).toBe("REVIEW");
      expect(rev1.scheduledDays).toBe(2);

      // Duplicate (userId, idempotencyKey) must be rejected by PostgreSQL unique index
      await expect(
        db.flashcardReview.create({
          data: {
            flashcardId: card1Id,
            userId: userAId,
            wasCorrect: true,
            idempotencyKey: `${RUN_ID}-idem-1`,
          },
        })
      ).rejects.toThrow();

      // Step 2: On Nov 5 (overdue), rate card 1 AGAIN -> enters RELEARNING with lapses=1
      const t1 = new Date("2026-11-05T14:00:00.000Z");
      const stateAfterStep1 = deriveCardStateFromReview(rev1 as unknown as PersistedReviewRecord);
      const step2 = scheduleNextReview(stateAfterStep1, "AGAIN", t1);

      const rev2 = await db.flashcardReview.create({
        data: {
          flashcardId: card1Id,
          userId: userAId,
          wasCorrect: step2.wasCorrect,
          selfRating: step2.selfRating,
          rating: step2.rating,
          stateBefore: step2.stateBefore,
          state: step2.state,
          stability: step2.stability,
          difficulty: step2.difficulty,
          elapsedDays: step2.elapsedDays,
          scheduledDays: step2.scheduledDays,
          reps: step2.reps,
          lapses: step2.lapses,
          dueAt: step2.dueAt,
          algorithmVersion: step2.algorithmVersion,
          reviewedAt: t1,
        },
      });
      expect(rev2.state).toBe("RELEARNING");
      expect(rev2.lapses).toBe(1);

      // Step 3: Suspend card 2 and verify it is excluded from the due queue
      const suspendedState = suspendCardState(deriveCardStateFromReview(null), t1);
      await db.flashcardReview.create({
        data: {
          flashcardId: card2Id,
          userId: userAId,
          wasCorrect: true,
          stateBefore: "NEW",
          state: "SUSPENDED",
          stability: suspendedState.stability,
          difficulty: suspendedState.difficulty,
          elapsedDays: 0,
          scheduledDays: 0,
          reps: 0,
          lapses: 0,
          dueAt: null,
          reviewedAt: t1,
        },
      });

      const dueAtNov11 = await getDueFlashcardsForUser({
        userId: userAId,
        now: new Date("2026-11-11T15:00:00.000Z"),
      });

      expect(dueAtNov11!.stats).toMatchObject({
        totalCards: 2,
        dueCount: 1, // card1 in RELEARNING is due
        learningCount: 1,
        suspendedCount: 1, // card2 is suspended
        newCount: 0,
      });
      expect(dueAtNov11!.queue.map((q) => q.id)).toEqual([card1Id]);

      // Step 4: Unsuspend card 2 -> returns to NEW
      const unsuspended = unsuspendCardState(suspendedState, new Date("2026-11-11T15:05:00.000Z"), "NEW");
      expect(unsuspended.state).toBe("NEW");
    });

    it("3. aggregates study progress (flashcards, quizzes, mastery) and enforces strict multi-user isolation", async () => {
      await db.quizAttempt.create({
        data: {
          quizId: quizAId,
          userId: userAId,
          answers: { q1: true },
          score: 90,
          startedAt: new Date("2026-11-10T10:00:00.000Z"),
          completedAt: new Date("2026-11-10T10:03:00.000Z"),
        },
      });

      const progressA = await getStudyProgress(userAId);
      expect(progressA.quizzes.attempts).toBe(1);
      expect(progressA.quizzes.bestScore).toBe(90);
      expect(computeQuizMastery(progressA.quizzes).masteryTier).toBe("MASTERED");
      expect(progressA.flashcards.totalDecks).toBe(1);
      expect(progressA.flashcards.totalCards).toBe(2);
      expect(progressA.flashcards.reviewsCompleted).toBeGreaterThanOrEqual(2);

      // User B must see 0 reviews, 0 decks, and 0 quiz attempts
      const progressB = await getStudyProgress(userBId);
      expect(progressB.quizzes.attempts).toBe(0);
      expect(progressB.flashcards.totalDecks).toBe(0);
      expect(progressB.flashcards.reviewsCompleted).toBe(0);
    });

    it("4. AUD-13-02: serializes concurrent flashcard reviews per (userId, flashcardId) via pg_advisory_xact_lock in real PostgreSQL", async () => {
      const c3 = await db.flashcard.create({
        data: {
          deckId: deckAId,
          front: "Concurrent test card",
          back: "Serialized via pg_advisory_xact_lock",
        },
      });

      const runReviewTx = async (rating: "GOOD" | "AGAIN", idempotencyKey?: string) => {
        const lockKey = `flashcard_review:${userAId}:${c3.id}`;
        return db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
          if (idempotencyKey) {
            const existing = await tx.flashcardReview.findFirst({
              where: { userId: userAId, idempotencyKey },
            });
            if (existing) {
              if (existing.flashcardId !== c3.id || existing.rating !== rating) {
                const conflictErr = Object.assign(new Error("Idempotency key conflict"), {
                  code: "IDEMPOTENCY_KEY_CONFLICT",
                  status: 409,
                });
                throw conflictErr;
              }
              return { review: existing, duplicate: true };
            }
          }
          const latest = await tx.flashcardReview.findFirst({
            where: { flashcardId: c3.id, userId: userAId },
            orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
          });
          const rawNow = new Date();
          const latestMs = latest?.reviewedAt ? new Date(latest.reviewedAt).getTime() : 0;
          const now = latestMs >= rawNow.getTime() ? new Date(latestMs + 1) : rawNow;
          const currentState = deriveCardStateFromReview(latest as unknown as PersistedReviewRecord | null);
          const step = scheduleNextReview(currentState, rating, now);
          const created = await tx.flashcardReview.create({
            data: {
              flashcardId: c3.id,
              userId: userAId,
              wasCorrect: step.wasCorrect,
              selfRating: step.selfRating,
              rating: step.rating,
              stateBefore: step.stateBefore,
              state: step.state,
              stability: step.stability,
              difficulty: step.difficulty,
              elapsedDays: step.elapsedDays,
              scheduledDays: step.scheduledDays,
              reps: step.reps,
              lapses: step.lapses,
              dueAt: step.dueAt,
              algorithmVersion: step.algorithmVersion,
              idempotencyKey: idempotencyKey ?? null,
              reviewedAt: now,
            },
          });
          return { review: created, duplicate: false };
        });
      };

      // 1. Concurrent same idempotencyKey
      const sameKey = `${RUN_ID}-concurrent-same`;
      const [sameA, sameB] = await Promise.all([
        runReviewTx("GOOD", sameKey),
        runReviewTx("GOOD", sameKey),
      ]);
      expect([sameA.duplicate, sameB.duplicate].sort()).toEqual([false, true]);

      // 1b. Idempotency conflict: reusing sameKey with incompatible rating ("AGAIN" instead of "GOOD")
      await expect(runReviewTx("AGAIN", sameKey)).rejects.toMatchObject({
        code: "IDEMPOTENCY_KEY_CONFLICT",
        status: 409,
      });

      // 2. Concurrent different idempotencyKeys on the same card
      await Promise.all([
        runReviewTx("GOOD", `${RUN_ID}-concurrent-k1`),
        runReviewTx("AGAIN", `${RUN_ID}-concurrent-k2`),
      ]);

      // 3. Concurrent no-key submissions on the same card
      await Promise.all([
        runReviewTx("GOOD"),
        runReviewTx("GOOD"),
      ]);

      // 4. Transaction rollback behavior: uncommitted write followed by error leaves persisted state intact
      await expect(
        db.$transaction(async (tx) => {
          const lockKey = `flashcard_review:${userAId}:${c3.id}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
          await tx.flashcardReview.create({
            data: {
              flashcardId: c3.id,
              userId: userAId,
              wasCorrect: false,
              rating: "AGAIN",
              stateBefore: "REVIEW",
              state: "RELEARNING",
              stability: 0.4,
              difficulty: 7.0,
              elapsedDays: 0,
              scheduledDays: 0,
              reps: 99,
              lapses: 99,
              dueAt: new Date(),
              algorithmVersion: "fsrs-4.5",
            },
          });
          throw new Error("Simulated mid-transaction failure");
        })
      ).rejects.toThrow("Simulated mid-transaction failure");

      const allC3Reviews = await db.flashcardReview.findMany({
        where: { flashcardId: c3.id, userId: userAId },
        orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
      });
      expect(allC3Reviews).toHaveLength(5);
      expect(allC3Reviews.map((r) => r.reps)).toEqual([1, 2, 3, 4, 5]);
      expect(allC3Reviews[2]!.lapses).toBe(1);
      expect([allC3Reviews[1]!.state, allC3Reviews[2]!.state].sort()).toEqual([
        "RELEARNING",
        "REVIEW",
      ]);
      expect(allC3Reviews[4]!.state).toBe("REVIEW");
      expect(allC3Reviews[4]!.dueAt).toBeInstanceOf(Date);

      // 5. Scenario F: Independent-card concurrency for the same user
      const [c4, c5] = await Promise.all([
        db.flashcard.create({
          data: {
            deckId: deckAId,
            front: "Independent card A",
            back: "Distinct hash lock key A",
          },
        }),
        db.flashcard.create({
          data: {
            deckId: deckAId,
            front: "Independent card B",
            back: "Distinct hash lock key B",
          },
        }),
      ]);

      const runCardReviewTx = async (targetCardId: string, rating: "GOOD" | "EASY", idempotencyKey: string) => {
        const lockKey = `flashcard_review:${userAId}:${targetCardId}`;
        return db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
          const latest = await tx.flashcardReview.findFirst({
            where: { flashcardId: targetCardId, userId: userAId },
            orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
          });
          const now = new Date();
          const currentState = deriveCardStateFromReview(latest as unknown as PersistedReviewRecord | null);
          const step = scheduleNextReview(currentState, rating, now);
          return tx.flashcardReview.create({
            data: {
              flashcardId: targetCardId,
              userId: userAId,
              wasCorrect: step.wasCorrect,
              selfRating: step.selfRating,
              rating: step.rating,
              stateBefore: step.stateBefore,
              state: step.state,
              stability: step.stability,
              difficulty: step.difficulty,
              elapsedDays: step.elapsedDays,
              scheduledDays: step.scheduledDays,
              reps: step.reps,
              lapses: step.lapses,
              dueAt: step.dueAt,
              algorithmVersion: step.algorithmVersion,
              idempotencyKey,
              reviewedAt: now,
            },
          });
        });
      };

      const [revC4, revC5] = await Promise.all([
        runCardReviewTx(c4.id, "GOOD", `${RUN_ID}-indep-c4`),
        runCardReviewTx(c5.id, "EASY", `${RUN_ID}-indep-c5`),
      ]);

      expect(revC4.flashcardId).toBe(c4.id);
      expect(revC4.reps).toBe(1);
      expect(revC4.state).toBe("REVIEW");
      expect(revC5.flashcardId).toBe(c5.id);
      expect(revC5.reps).toBe(1);
      expect(revC5.state).toBe("REVIEW");
    }, 30_000);

    it("5. AUD-13-01, AUD-13-02 & AUD-13-05: verifies the production POST /api/flashcards/[deckId]/reviews route handler and study progress against live PostgreSQL", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: userAId, email: `${RUN_ID}_a@zenote.test`, name: "Phase 13 Learner A" },
        expires: "2099-01-01T00:00:00.000Z",
      });

      const routeCard = await db.flashcard.create({
        data: {
          deckId: deckAId,
          front: "Route handler live Postgres concurrency card",
          back: "End-to-end POST route verification",
        },
      });

      const postReview = async (payload: Record<string, unknown>) => {
        const req = new Request(`http://localhost:3000/api/flashcards/${deckAId}/reviews`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const res = await submitReviewRoute(req, { params: { deckId: deckAId } });
        const json = await res.json();
        return { status: res.status, body: json };
      };

      // Scenario A (Route Handler): Concurrent identical idempotencyKey requests
      const routeSameKey = `${RUN_ID}-route-same-key`;
      const [resA1, resA2] = await Promise.all([
        postReview({
          flashcardId: routeCard.id,
          action: "REVIEW",
          rating: "GOOD",
          idempotencyKey: routeSameKey,
        }),
        postReview({
          flashcardId: routeCard.id,
          action: "REVIEW",
          rating: "GOOD",
          idempotencyKey: routeSameKey,
        }),
      ]);

      expect(resA1.status).toBe(200);
      expect(resA2.status).toBe(200);
      expect([Boolean(resA1.body.duplicate), Boolean(resA2.body.duplicate)].sort()).toEqual([
        false,
        true,
      ]);
      expect(resA1.body.review.id).toBe(resA2.body.review.id);

      // Scenario B (Route Handler): Reusing idempotencyKey with conflicting rating or action -> 409 IDEMPOTENCY_KEY_CONFLICT
      const conflictRatingRes = await postReview({
        flashcardId: routeCard.id,
        action: "REVIEW",
        rating: "AGAIN",
        idempotencyKey: routeSameKey,
      });
      expect(conflictRatingRes.status).toBe(409);
      expect(conflictRatingRes.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");

      const conflictActionRes = await postReview({
        flashcardId: routeCard.id,
        action: "SUSPEND",
        idempotencyKey: routeSameKey,
      });
      expect(conflictActionRes.status).toBe(409);
      expect(conflictActionRes.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");

      // Scenario C (Route Handler): Concurrent distinct idempotencyKeys on the same card
      const [resC1, resC2] = await Promise.all([
        postReview({
          flashcardId: routeCard.id,
          action: "REVIEW",
          rating: "GOOD",
          idempotencyKey: `${RUN_ID}-route-diff-1`,
        }),
        postReview({
          flashcardId: routeCard.id,
          action: "REVIEW",
          rating: "AGAIN",
          idempotencyKey: `${RUN_ID}-route-diff-2`,
        }),
      ]);
      expect(resC1.status).toBe(200);
      expect(resC2.status).toBe(200);

      // Scenario D (Route Handler): Concurrent no-key reviews on the same card (above 1500ms rapid-repeat guard via distinct ratings HARD + EASY)
      const [resD1, resD2] = await Promise.all([
        postReview({
          flashcardId: routeCard.id,
          action: "REVIEW",
          rating: "HARD",
        }),
        postReview({
          flashcardId: routeCard.id,
          action: "REVIEW",
          rating: "EASY",
        }),
      ]);
      expect(resD1.status).toBe(200);
      expect(resD2.status).toBe(200);

      // AUD-13-01 (Route Handler): SUSPEND and UNSUSPEND persist rating=null and do not inflate review analytics
      const progressBeforeLifecycle = await getStudyProgress(userAId);
      const suspendRes = await postReview({
        flashcardId: routeCard.id,
        action: "SUSPEND",
        idempotencyKey: `${RUN_ID}-route-suspend`,
      });
      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body.schedule.state).toBe("SUSPENDED");

      const unsuspendRes = await postReview({
        flashcardId: routeCard.id,
        action: "UNSUSPEND",
        idempotencyKey: `${RUN_ID}-route-unsuspend`,
      });
      expect(unsuspendRes.status).toBe(200);
      expect(unsuspendRes.body.schedule.state).not.toBe("SUSPENDED");

      const progressAfterLifecycle = await getStudyProgress(userAId);
      expect(progressAfterLifecycle.flashcards.reviewsCompleted).toBe(
        progressBeforeLifecycle.flashcards.reviewsCompleted
      );

      const persistedRouteReviews = await db.flashcardReview.findMany({
        where: { flashcardId: routeCard.id, userId: userAId },
        orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          rating: true,
          stateBefore: true,
          state: true,
          reps: true,
          lapses: true,
          scheduledDays: true,
          idempotencyKey: true,
          reviewedAt: true,
        },
      });

      // 5 rated reviews (1 from A, 2 from C, 2 from D) + 2 lifecycle rows (SUSPEND, UNSUSPEND) = 7 rows
      expect(persistedRouteReviews).toHaveLength(7);
      expect(persistedRouteReviews.slice(0, 5).map((r) => r.reps)).toEqual([1, 2, 3, 4, 5]);
      expect(persistedRouteReviews[5]?.rating).toBeNull();
      expect(persistedRouteReviews[5]?.state).toBe("SUSPENDED");
      expect(persistedRouteReviews[6]?.rating).toBeNull();
      expect(persistedRouteReviews[6]?.stateBefore).toBe("SUSPENDED");

      console.log(
        "LIVE_POSTGRES_EVIDENCE_ROWS:",
        JSON.stringify(
          persistedRouteReviews.map((r) => ({
            rating: r.rating,
            stateBefore: r.stateBefore,
            state: r.state,
            reps: r.reps,
            lapses: r.lapses,
            scheduledDays: r.scheduledDays,
            hasIdempotencyKey: Boolean(r.idempotencyKey),
          }))
        )
      );
    }, 45_000);
  });


