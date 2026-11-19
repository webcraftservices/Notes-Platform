import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleFlashcardDeck,
  requireGroupRole,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { createFlashcardSchema } from "@/lib/validation/flashcard-review";
import { deriveCardStateFromReview } from "@/lib/srs/fsrs";
import { serializeCardSchedule } from "@/lib/srs/study-queue";
import { NOT_FOUND, FORBIDDEN, UNAUTHORIZED, zodError } from "@/lib/api-response";

/**
 * Phase 13 — Add a new card to an accessible flashcard deck.
 * Requires deck ownership or group ADMIN+ role when the deck belongs to a group.
 */
export async function POST(req: Request, { params }: { params: { deckId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = createFlashcardSchema.safeParse(body);
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
    const createCardInClient = async (tx: typeof db) => {
      const txAny = tx as unknown as {
        $queryRaw?: unknown;
        groupMember?: {
          findFirst?: (args: unknown) => Promise<{ role: string } | null>;
        };
      };
      const requiredRoles = deck.ownerId === user.id ? undefined : (["OWNER", "ADMIN"] as const);
      if (deck.groupId) {
        if (
          typeof assertActiveGroupMemberForCreation === "function" &&
          typeof txAny.$queryRaw === "function"
        ) {
          await assertActiveGroupMemberForCreation(
            tx as never,
            deck.groupId,
            user.id,
            requiredRoles ? [...requiredRoles] : undefined
          );
        } else if (typeof txAny.groupMember?.findFirst === "function") {
          const member = await txAny.groupMember.findFirst({
            where: { groupId: deck.groupId, userId: user.id, group: { deletedAt: null } },
          });
          if (!member) throw new NotAuthorizedError();
          if (requiredRoles && !requiredRoles.includes(member.role as "OWNER" | "ADMIN")) {
            throw new NotAuthorizedError();
          }
        }
      }
      return tx.flashcard.create({
        data: {
          deckId: deck.id,
          front: parsed.data.front,
          back: parsed.data.back,
        },
      });
    };

    const card =
      typeof dbWithTx.$transaction === "function"
        ? await dbWithTx.$transaction((tx) => createCardInClient((tx ?? db) as typeof db))
        : await createCardInClient(db);

    const now = new Date();
    const schedule = serializeCardSchedule(deriveCardStateFromReview(null), now);

    return NextResponse.json(
      {
        card: {
          ...card,
          review: null,
          schedule,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
