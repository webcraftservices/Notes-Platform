import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleAIScope, NotAuthorizedError, type ResolvedAIScope } from "@/lib/access";
import { aiScopeQuerySchema } from "@/lib/validation/ai";
import { zodError, UNAUTHORIZED, FORBIDDEN } from "@/lib/api-response";

/**
 * Converts a resolved scope into the exact FK values an AIConversation row
 * should have: the narrowest level set, everything above/below it null.
 * Shared by the where-filter (GET) and the create data (GET's fallback
 * create + POST) so the two can never drift out of agreement.
 */
function scopeFkFields(scope: ResolvedAIScope) {
  return {
    topicId: scope.topicId,
    chapterId: scope.topicId ? null : scope.chapterId,
    subjectId: scope.topicId || scope.chapterId ? null : scope.subjectId,
    workspaceId: scope.topicId || scope.chapterId || scope.subjectId ? null : scope.workspaceId,
  };
}

/**
 * Mirrors GET /api/topics/[topicId]/note's get-or-create shape (spec §21):
 * one active conversation per (user, scope) is enough for the Phase 5 UI
 * (a single chat thread per Topic/Subject/Chapter/workspace), same as
 * Phase 3 settled on one note per topic. The schema allows many
 * conversations per scope — POST below starts a genuinely new one
 * ("New conversation", spec §68) when the user explicitly asks for it.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { searchParams } = new URL(req.url);
  const parsed = aiScopeQuerySchema.safeParse({
    subjectId: searchParams.get("subjectId") ?? undefined,
    chapterId: searchParams.get("chapterId") ?? undefined,
    topicId: searchParams.get("topicId") ?? undefined,
  });
  if (!parsed.success) return zodError(parsed.error);

  try {
    const scope = await getAccessibleAIScope(parsed.data, user.id);
    const fk = scopeFkFields(scope);

    let conversation = await db.aIConversation.findFirst({
      where: { userId: user.id, deletedAt: null, ...fk },
      orderBy: { updatedAt: "desc" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!conversation) {
      conversation = await db.aIConversation.create({
        data: { userId: user.id, ...fk },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
    }

    return NextResponse.json({ conversation });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

/** Starts a brand new, empty conversation for a scope — "New conversation" (spec §68). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => ({}));
  const parsed = aiScopeQuerySchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const scope = await getAccessibleAIScope(parsed.data, user.id);

    const conversation = await db.aIConversation.create({
      data: { userId: user.id, ...scopeFkFields(scope) },
      include: { messages: true },
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

