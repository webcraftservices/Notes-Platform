import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/access";
import { updateNotificationSchema } from "@/lib/validation/notifications";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

/**
 * Marks one of the caller's own notifications read/unread. Ownership is
 * checked against the fetched row's `userId`, never assumed from the path
 * — a `notificationId` belonging to another user resolves to FORBIDDEN,
 * not a silent no-op or a leak of whether that id exists at all (mirrors
 * the NOT_FOUND-vs-FORBIDDEN split used throughout this codebase's
 * group/material access checks).
 *
 * Only `readAt` is ever written here — `type`, `title`, `body`, `link`,
 * and `userId` are immutable after creation (spec §9/§7), and the request
 * schema only accepts `{ read: boolean }` so there's nothing else in the
 * body to even attempt writing.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { notificationId: string } },
) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateNotificationSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  const existing = await db.notification.findUnique({ where: { id: params.notificationId } });
  if (!existing) return NOT_FOUND();
  if (existing.userId !== user.id) return FORBIDDEN();

  const notification = await db.notification.update({
    where: { id: params.notificationId },
    data: { readAt: parsed.data.read ? new Date() : null },
  });

  return NextResponse.json({ notification });
}
