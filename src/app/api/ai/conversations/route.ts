import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleAIScope, NotAuthorizedError, type ResolvedAIScope } from "@/lib/access";
import { aiConversationScopeSchema } from "@/lib/validation/ai";
import { assertAiTutorEntitlement, AITutorNotEnabledError } from "@/lib/ai-quota";
import { zodError, jsonError, UNAUTHORIZED, FORBIDDEN } from "@/lib/api-response";

/**
 * Converts a resolved scope into the exact FK values an AIConversation row
 * should have: the narrowest level set, everything above/below it null.
 * Shared by the where-filter (GET) and the create data (GET's fallback
 * create + POST) so the two can never drift out of agreement.
 *
 * workspaceId/groupId are mutually exclusive, mirroring ResolvedAIScope's
 * own discriminated union (Phase 6.1) — at most one of them is ever
 * non-null, and only when nothing narrower is set. `ownerType` is
 * "group" for a bare group scope (Phase 6.5) or a group-owned
 * Subject/Chapter/Topic (Phase 6.4); either way exactly one of
 * workspaceId/groupId ends up set here, never both.
 */
function scopeFkFields(scope: ResolvedAIScope) {
  const narrowed = Boolean(scope.topicId || scope.chapterId || scope.subjectId);
  return {
    topicId: scope.topicId,
    chapterId: scope.topicId ? null : scope.chapterId,
    subjectId: scope.topicId || scope.chapterId ? null : scope.subjectId,
    workspaceId: !narrowed && scope.ownerType === "workspace" ? scope.workspaceId : null,
    groupId: !narrowed && scope.ownerType === "group" ? scope.groupId : null,
  };
}

/**
 * Mirrors GET /api/topics/[topicId]/note's get-or-create shape (spec §21):
 * one active conversation per (user, scope, kind) is enough for the
 * Phase 5 UI (a single chat thread per Topic/Subject/Chapter/workspace),
 * same as Phase 3 settled on one note per topic. `kind` (Phase 8.4) is
 * folded into the lookup key alongside `fk` so a Topic's plain "Ask AI"
 * conversation and its AI Tutor conversation resolve to two distinct
 * rows, never one shared thread — see AIConversation.kind's schema
 * comment. The schema allows many conversations per (scope, kind) — POST
 * below starts a genuinely new one ("New conversation", spec §68) when
 * the user explicitly asks for it.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { searchParams } = new URL(req.url);
  const parsed = aiConversationScopeSchema.safeParse({
    subjectId: searchParams.get("subjectId") ?? undefined,
    chapterId: searchParams.get("chapterId") ?? undefined,
    topicId: searchParams.get("topicId") ?? undefined,
    groupId: searchParams.get("groupId") ?? undefined,
    kind: searchParams.get("kind") ?? undefined,
  });
  if (!parsed.success) return zodError(parsed.error);

  try {
    // Phase 8.4: a TUTOR conversation additionally requires the plan
    // entitlement, checked before any scope resolution or DB read for
    // one — a FREE-plan user can't even discover whether a Tutor
    // conversation already exists for a Topic they can otherwise see.
    if (parsed.data.kind === "TUTOR") await assertAiTutorEntitlement(user.id);

    const scope = await getAccessibleAIScope(parsed.data, user.id);
    const fk = scopeFkFields(scope);
    const kind = parsed.data.kind;

    let conversation = await db.aIConversation.findFirst({
      where: { userId: user.id, deletedAt: null, kind, ...fk },
      orderBy: { updatedAt: "desc" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!conversation) {
      conversation = await db.aIConversation.create({
        data: { userId: user.id, kind, ...fk },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
    }

    return NextResponse.json({ conversation });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    if (err instanceof AITutorNotEnabledError) return jsonError(err.message, 403, { code: "AI_TUTOR_NOT_ENABLED" });
    throw err;
  }
}

/** Starts a brand new, empty conversation for a scope — "New conversation" (spec §68). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => ({}));
  const parsed = aiConversationScopeSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    if (parsed.data.kind === "TUTOR") await assertAiTutorEntitlement(user.id);

    const scope = await getAccessibleAIScope(parsed.data, user.id);

    const conversation = await db.aIConversation.create({
      data: { userId: user.id, kind: parsed.data.kind, ...scopeFkFields(scope) },
      include: { messages: true },
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    if (err instanceof AITutorNotEnabledError) return jsonError(err.message, 403, { code: "AI_TUTOR_NOT_ENABLED" });
    throw err;
  }
}

