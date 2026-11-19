import { NextResponse } from "next/server";
import { getSessionUser, NotAuthorizedError } from "@/lib/access";
import { dueFlashcardsQuerySchema } from "@/lib/validation/flashcard-review";
import { getDueFlashcardsForUser } from "@/lib/srs/due-service";
import { UNAUTHORIZED, FORBIDDEN, NOT_FOUND, zodError } from "@/lib/api-response";

/**
 * Phase 13 (Task 13-02) — Daily Review Queue Computation Endpoint (`GET /api/flashcards/due`).
 *
 * Computes the authenticated user's due flashcard review queue and per-deck
 * counts (`dueCount`, `overdueCount`, `newCount`, `learningCount`, `reviewCount`,
 * `suspendedCount`, `upcoming7DaysCount`), respecting personal workspace,
 * study group, and curriculum hierarchy boundaries as well as ancestor
 * soft-delete checks.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { searchParams } = new URL(req.url);
  const parsed = dueFlashcardsQuerySchema.safeParse({
    subjectId: searchParams.get("subjectId") ?? undefined,
    chapterId: searchParams.get("chapterId") ?? undefined,
    topicId: searchParams.get("topicId") ?? undefined,
    groupId: searchParams.get("groupId") ?? undefined,
    deckId: searchParams.get("deckId") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    newLimit: searchParams.get("newLimit") ?? undefined,
    includeNew: searchParams.get("includeNew") ?? undefined,
  });

  if (!parsed.success) {
    return zodError(parsed.error);
  }

  try {
    const result = await getDueFlashcardsForUser({
      userId: user.id,
      scopeInput: {
        subjectId: parsed.data.subjectId,
        chapterId: parsed.data.chapterId,
        topicId: parsed.data.topicId,
        groupId: parsed.data.groupId,
      },
      deckId: parsed.data.deckId,
      limit: parsed.data.limit,
      newLimit: parsed.data.newLimit,
      includeNew: parsed.data.includeNew,
    });

    if (!result) {
      return NOT_FOUND();
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotAuthorizedError) {
      return FORBIDDEN();
    }
    throw err;
  }
}

