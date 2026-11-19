import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleFlashcardDeck,
  requireGroupRole,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { updateFlashcardDeckSchema } from "@/lib/validation/flashcard-review";
import { deriveCardStateFromReview, type PersistedReviewRecord } from "@/lib/srs/fsrs";
import { computeDeckStudyStats, serializeCardSchedule } from "@/lib/srs/study-queue";
import { NOT_FOUND, FORBIDDEN, UNAUTHORIZED, zodError } from "@/lib/api-response";

async function revalidateGroupDeckMutationInTx(
  tx: typeof db,
  deck: { groupId?: string | null; ownerId?: string | null },
  userId: string
): Promise<void> {
  if (!deck.groupId) return;
  const requiredRoles = deck.ownerId === userId ? undefined : (["OWNER", "ADMIN"] as const);
  const txAny = tx as unknown as {
    $queryRaw?: unknown;
    groupMember?: {
      findFirst?: (args: unknown) => Promise<{ role: string } | null>;
    };
  };
  if (
    typeof assertActiveGroupMemberForCreation === "function" &&
    typeof txAny.$queryRaw === "function"
  ) {
    await assertActiveGroupMemberForCreation(
      tx as never,
      deck.groupId,
      userId,
      requiredRoles ? [...requiredRoles] : undefined
    );
  } else if (typeof txAny.groupMember?.findFirst === "function") {
    const member = await txAny.groupMember.findFirst({
      where: { groupId: deck.groupId, userId, group: { deletedAt: null } },
    });
    if (!member) throw new NotAuthorizedError();
    if (requiredRoles && !requiredRoles.includes(member.role as "OWNER" | "ADMIN")) {
      throw new NotAuthorizedError();
    }
  }
}

/**
 * Returns a generated deck and its cards (with provenance) for anyone
 * `getAccessibleFlashcardDeck` says can reach it — the same owner-or-
 * scope-membership check as every other shared-content read in this app.
 */
export async function GET(_req: Request, { params }: { params: { deckId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const deck = await getAccessibleFlashcardDeck(params.deckId, user.id);
    if (!deck) return NOT_FOUND();

    const cards = await db.flashcard.findMany({
      where: { deckId: deck.id },
      orderBy: { id: "asc" },
      include: {
        reviews: {
          where: { userId: user.id },
          orderBy: { reviewedAt: "desc" },
          take: 1,
        },
      },
    });

    const now = new Date();
    const cardsWithOwnReview = cards.map(({ reviews, ...card }: (typeof cards)[number]) => {
      const latestReview = reviews[0] ?? null;
      const stateObj = deriveCardStateFromReview(
        latestReview as unknown as PersistedReviewRecord | null
      );
      const schedule = serializeCardSchedule(stateObj, now);
      return {
        ...card,
        review: latestReview,
        schedule,
      };
    });

    const stats = computeDeckStudyStats(cardsWithOwnReview, now);

    return NextResponse.json({
      deck: {
        ...deck,
        cards: cardsWithOwnReview,
        stats,
      },
    });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

/**
 * Phase 13 — Rename a flashcard deck (requires deck ownership or group ADMIN+).
 */
export async function PATCH(req: Request, { params }: { params: { deckId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateFlashcardDeckSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const deck = await getAccessibleFlashcardDeck(params.deckId, user.id);
    if (!deck) return NOT_FOUND();

    if (deck.ownerId !== user.id) {
      if (deck.groupId) {
        await requireGroupRole(deck.groupId, user.id, "ADMIN");
      } else {
        return FORBIDDEN();
      }
    }

    const dbWithTx = db as unknown as {
      $transaction?: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>;
    };
    const updateInClient = async (tx: typeof db) => {
      await revalidateGroupDeckMutationInTx(tx, deck, user.id);
      return tx.flashcardDeck.update({
        where: { id: deck.id },
        data: { title: parsed.data.title },
      });
    };

    const updated =
      typeof dbWithTx.$transaction === "function"
        ? await dbWithTx.$transaction((tx) => updateInClient((tx ?? db) as typeof db))
        : await updateInClient(db);

    return NextResponse.json({ deck: updated });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

/**
 * Phase 13 — Delete a flashcard deck and its cards (requires deck ownership or group ADMIN+).
 */
export async function DELETE(_req: Request, { params }: { params: { deckId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const deck = await getAccessibleFlashcardDeck(params.deckId, user.id);
    if (!deck) return NOT_FOUND();

    if (deck.ownerId !== user.id) {
      if (deck.groupId) {
        await requireGroupRole(deck.groupId, user.id, "ADMIN");
      } else {
        return FORBIDDEN();
      }
    }

    const dbWithTx = db as unknown as {
      $transaction?: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>;
    };
    const deleteInClient = async (tx: typeof db) => {
      await revalidateGroupDeckMutationInTx(tx, deck, user.id);
      await tx.flashcardDeck.delete({
        where: { id: deck.id },
      });
    };

    if (typeof dbWithTx.$transaction === "function") {
      await dbWithTx.$transaction((tx) => deleteInClient((tx ?? db) as typeof db));
    } else {
      await deleteInClient(db);
    }

    return NextResponse.json({ deleted: true, id: deck.id });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
