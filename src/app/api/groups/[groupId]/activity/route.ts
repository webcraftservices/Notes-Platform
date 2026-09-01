import { NextResponse } from "next/server";
import type { ActivityLog, User } from "@prisma/client";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleGroup, NotAuthorizedError } from "@/lib/access";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

const PAGE_SIZE = 30;

/**
 * Lists a group's activity log, newest first.
 *
 * Access mirrors the Subjects/Materials group-list routes:
 * `getAccessibleGroup` returns null for a group that doesn't exist and
 * throws `NotAuthorizedError` for one that exists but the caller isn't a
 * member of, so a non-member (or a member who has since left/been
 * removed) can't distinguish "no such group" from "not yours to see" —
 * and, per spec §7, can't read the log at all either way.
 *
 * `?cursor=<activityLogId>` supports "load more": pass the `id` of the
 * last item already shown and the next page starts after it. No other
 * route in this codebase paginates yet (materials/notes list routes just
 * cap with a flat `take`), so this introduces the smallest workable
 * cursor scheme rather than a new pagination convention.
 */
export async function GET(req: Request, { params }: { params: { groupId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");

  try {
    const group = await getAccessibleGroup(params.groupId, user.id);
    if (!group) return NOT_FOUND();

    const logs = await db.activityLog.findMany({
      where: { groupId: group.id },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });

    return NextResponse.json({
      activity: logs.map((log: ActivityLog & { user: Pick<User, "id" | "name" | "email" | "image"> }) => ({
        id: log.id,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: log.metadata,
        createdAt: log.createdAt,
        actor: {
          id: log.user.id,
          name: log.user.name,
          email: log.user.email,
          image: log.user.image,
        },
      })),
      nextCursor: logs.length === PAGE_SIZE ? logs[logs.length - 1]!.id : null,
    });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
