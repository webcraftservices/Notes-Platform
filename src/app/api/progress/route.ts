import { NextResponse } from "next/server";
import { getSessionUser, getAccessibleAIScope, NotAuthorizedError } from "@/lib/access";
import { aiScopeQuerySchema } from "@/lib/validation/ai";
import { getStudyProgress } from "@/lib/study-progress";
import { zodError, UNAUTHORIZED, FORBIDDEN } from "@/lib/api-response";

/**
 * Phase 8.5 — one canonical progress endpoint, following the same
 * validate -> authorize-scope -> aggregate shape as `GET /api/ai/
 * conversations`. `userId` always comes from `getSessionUser()`, never
 * from a query param.
 *
 * With no scope query params at all, this returns the user's true global
 * activity (every Quiz attempt and Tutor session they've ever had,
 * anywhere) — `getAccessibleAIScope` is skipped entirely in that case, so
 * an unscoped request never has to resolve/authorize a workspace first.
 * The moment any scope field (topicId/chapterId/subjectId/groupId) is
 * present, it is resolved and authorized through the exact same
 * `getAccessibleAIScope` used by AI chat/conversations — reusing the one
 * scope-authorization path in the app rather than inventing a second one.
 * An inaccessible scope throws `NotAuthorizedError`, mapped to 403 below,
 * never a misleadingly-empty 200.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { searchParams } = new URL(req.url);
  const parsed = aiScopeQuerySchema.safeParse({
    subjectId: searchParams.get("subjectId") ?? undefined,
    chapterId: searchParams.get("chapterId") ?? undefined,
    topicId: searchParams.get("topicId") ?? undefined,
    groupId: searchParams.get("groupId") ?? undefined,
  });
  if (!parsed.success) return zodError(parsed.error);

  const hasScopeInput = Object.values(parsed.data).some((value) => value !== undefined);

  try {
    const scope = hasScopeInput ? await getAccessibleAIScope(parsed.data, user.id) : undefined;

    const progress = await getStudyProgress(user.id, scope);

    return NextResponse.json(progress);
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
