import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleFlashcardDeck,
  requireGroupRole,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { updateFlashcardSchema } from "@/lib/validation/flashcard-review";
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
 * Phase 13 — Update an individual flashcard's front/back content.
 * Requires deck ownership or group ADMIN+ role, and verifies the card belongs to `deckId`.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { deckId: string; cardId: string } }
) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateFlashcardSchema.safeParse(body);
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
    const updateCardInClient = async (tx: typeof db) => {
      await revalidateGroupDeckMutationInTx(tx, deck, user.id);
      const existing = await tx.flashcard.findFirst({
        where: { id: params.cardId, deckId: deck.id },
        select: { id: true },
      });
      if (!existing) return null;

      return tx.flashcard.update({
        where: { id: existing.id },
        data: {
          ...(parsed.data.front !== undefined ? { front: parsed.data.front } : {}),
          ...(parsed.data.back !== undefined ? { back: parsed.data.back } : {}),
        },
      });
    };

    const card =
      typeof dbWithTx.$transaction === "function"
        ? await dbWithTx.$transaction((tx) => updateCardInClient((tx ?? db) as typeof db))
        : await updateCardInClient(db);
    if (!card) return NOT_FOUND();

    return NextResponse.json({ card });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

/**
 * Phase 13 — Delete an individual flashcard from a deck.
 * Requires deck ownership or group ADMIN+ role, and verifies the card belongs to `deckId`.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { deckId: string; cardId: string } }
) {
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
    const deleteCardInClient = async (tx: typeof db) => {
      await revalidateGroupDeckMutationInTx(tx, deck, user.id);
      const existing = await tx.flashcard.findFirst({
        where: { id: params.cardId, deckId: deck.id },
        select: { id: true },
      });
      if (!existing) return null;

      await tx.flashcard.delete({
        where: { id: existing.id },
      });
      return existing.id;
    };

    const deletedId =
      typeof dbWithTx.$transaction === "function"
        ? await dbWithTx.$transaction((tx) => deleteCardInClient((tx ?? db) as typeof db))
        : await deleteCardInClient(db);
    if (!deletedId) return NOT_FOUND();

    return NextResponse.json({ deleted: true, id: deletedId });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
