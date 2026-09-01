import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/access";
import { UNAUTHORIZED } from "@/lib/api-response";

const PAGE_SIZE = 20;

/**
 * Lists the authenticated user's own notifications, newest first.
 *
 * The recipient is always derived from the session (`user.id`) — there is
 * no `userId` request param anywhere on this route, so a caller has no way
 * to even attempt reading someone else's notifications (spec §7: "never
 * trust a client-supplied userId").
 *
 * `?unread=true` filters to unread only (readAt IS NULL), used by the
 * notification bell. `?cursor=<notificationId>` supports "load more",
 * same scheme as GET /api/groups/[groupId]/activity.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "true";
  const cursor = searchParams.get("cursor");

  const [notifications, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return NextResponse.json({
    notifications,
    unreadCount,
    nextCursor: notifications.length === PAGE_SIZE ? notifications[notifications.length - 1]!.id : null,
  });
}
