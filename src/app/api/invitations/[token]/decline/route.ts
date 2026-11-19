import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, lockGroupForShare, lockGroupInvitationForUpdate } from "@/lib/access";
import { normalizeEmail } from "@/lib/email";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, CONFLICT } from "@/lib/api-response";
import { ActivityAction, createActivityLog } from "@/lib/activity";
import { createNotifications, getGroupAdminUserIds } from "@/lib/notifications";

/**
 * Declines a Group invitation atomically inside `db.$transaction` with
 * top-down `Group FOR SHARE` -> `GroupInvitation FOR UPDATE` row locking,
 * ensuring expiry transitions, email verification, and decline status updates
 * serialize cleanly with concurrent accept/cancel/resend operations.
 */
export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return UNAUTHORIZED();

  const invitation = await db.groupInvitation.findUnique({ where: { token: params.token } });
  if (!invitation) return NOT_FOUND();

  const result = await db.$transaction(async (tx) => {
    const lockedGroup = await lockGroupForShare(tx, invitation.groupId);
    if (!lockedGroup || lockedGroup.deletedAt !== null) {
      return { outcome: "not_found" as const };
    }

    const lockedInv = await lockGroupInvitationForUpdate(tx, { token: params.token });
    if (!lockedInv || lockedInv.groupId !== invitation.groupId) {
      return { outcome: "not_found" as const };
    }

    if (lockedInv.status !== "PENDING") {
      if (lockedInv.status === "DECLINED") {
        return { outcome: "ok" as const };
      }
      return { outcome: "conflict" as const, message: "This invitation is no longer available." };
    }

    if (lockedInv.expiresAt < new Date()) {
      await tx.groupInvitation.updateMany({
        where: { token: params.token, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      return { outcome: "conflict" as const, message: "This invitation has expired." };
    }

    const dbUser = await tx.user.findUnique({
      where: { id: sessionUser.id },
      select: { id: true, email: true },
    });
    if (!dbUser) {
      return { outcome: "unauthorized" as const };
    }

    if (normalizeEmail(dbUser.email) !== normalizeEmail(lockedInv.email)) {
      return { outcome: "forbidden" as const };
    }

    const consumed = await tx.groupInvitation.updateMany({
      where: { token: params.token, status: "PENDING" },
      data: { status: "DECLINED" },
    });

    if (consumed.count > 0) {
      await createActivityLog(tx, {
        groupId: invitation.groupId,
        userId: dbUser.id,
        action: ActivityAction.INVITATION_DECLINED,
        targetType: "invitation",
        targetId: lockedInv.id,
        metadata: { email: lockedInv.email },
      });

      const adminIds = await getGroupAdminUserIds(tx, invitation.groupId);
      await createNotifications(tx, adminIds, {
        type: "GROUP_INVITATION_DECLINED",
        title: `${lockedInv.email} declined your group invitation`,
        link: `/groups/${invitation.groupId}?tab=members`,
      });
    }

    return { outcome: "ok" as const };
  });

  if (result.outcome === "not_found") return NOT_FOUND();
  if (result.outcome === "unauthorized") return UNAUTHORIZED();
  if (result.outcome === "forbidden") return FORBIDDEN();
  if (result.outcome === "conflict") return CONFLICT(result.message);

  return NextResponse.json({ success: true });
}
