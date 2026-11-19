import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, lockGroupForShare, lockGroupInvitationForUpdate } from "@/lib/access";
import { normalizeEmail } from "@/lib/email";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, CONFLICT } from "@/lib/api-response";
import { ActivityAction, createActivityLog } from "@/lib/activity";
import { createNotifications, getGroupAdminUserIds } from "@/lib/notifications";

/**
 * Accepts a Group invitation.
 *
 * Email-matching (spec §7/decision in Phase 6.2 doc §2): a leaked token
 * must not let an arbitrary account join the group, so possession of the
 * token alone is never sufficient — the authenticated caller's own
 * `User.email` must match `GroupInvitation.email` once both are run
 * through `normalizeEmail`. This is checked inside `db.$transaction`
 * against a fresh `tx.user` read under row locks, not `session.user.email`.
 *
 * Concurrency & Lock Ordering: inside a single `db.$transaction`, the handler
 * acquires `FOR SHARE` on the parent `Group` before `FOR UPDATE` on the
 * `GroupInvitation` row, then validates `status`, `expiresAt` (atomically
 * transitioning expired `PENDING` rows to `EXPIRED`), caller email match, and
 * active group state before creating the `GroupMember` row.
 */
export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return UNAUTHORIZED();

  const invitation = await db.groupInvitation.findUnique({
    where: { token: params.token },
    include: { group: { select: { id: true, deletedAt: true } } },
  });
  if (!invitation || invitation.group.deletedAt !== null) return NOT_FOUND();

  const result = await db.$transaction(async (tx) => {
    // 1. Lock parent group FOR SHARE so concurrent group deletion serializes top-down.
    const lockedGroup = await lockGroupForShare(tx, invitation.groupId);
    if (!lockedGroup || lockedGroup.deletedAt !== null) {
      return { outcome: "group_deleted" as const };
    }

    // 2. Lock the GroupInvitation row FOR UPDATE so cancel/resend/accept/decline
    //    and expiry transitions serialize cleanly without stale READ COMMITTED snapshots.
    const lockedInv = await lockGroupInvitationForUpdate(tx, { token: params.token });
    if (!lockedInv || lockedInv.groupId !== invitation.groupId) {
      return { outcome: "not_found" as const };
    }

    if (lockedInv.status !== "PENDING") {
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
      select: { id: true, email: true, name: true },
    });
    if (!dbUser) {
      return { outcome: "unauthorized" as const };
    }

    if (normalizeEmail(dbUser.email) !== normalizeEmail(lockedInv.email)) {
      return { outcome: "forbidden" as const };
    }

    // Re-verify the parent group exists and has not been soft-deleted concurrently.
    const group = await tx.group.findUnique({
      where: { id: invitation.groupId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!group) {
      return { outcome: "group_deleted" as const };
    }

    const existingMembership = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId: invitation.groupId, userId: dbUser.id } },
    });

    if (existingMembership) {
      // Already a member (e.g. joined another way since this invite was
      // sent). Consume the invitation so it stops appearing as pending,
      // but don't attempt a second GroupMember row.
      await tx.groupInvitation.updateMany({
        where: { token: params.token, status: "PENDING" },
        data: { status: "ACCEPTED" },
      });
      return { outcome: "ok" as const, alreadyMember: true as const, member: existingMembership };
    }

    const consumed = await tx.groupInvitation.updateMany({
      where: { token: params.token, status: "PENDING" },
      data: { status: "ACCEPTED" },
    });
    if (consumed.count === 0) {
      return { outcome: "conflict" as const, message: "This invitation has already been used." };
    }

    // lockedInv.role is guaranteed non-OWNER by createInvitationSchema
    // at creation time — never re-derived or trusted from client input here.
    const member = await tx.groupMember.create({
      data: { groupId: invitation.groupId, userId: dbUser.id, role: lockedInv.role },
    });

    await createActivityLog(tx, {
      groupId: invitation.groupId,
      userId: dbUser.id,
      action: ActivityAction.MEMBER_JOINED,
      targetType: "member",
      targetId: dbUser.id,
    });

    // Admins/owners get a personal notification that someone joined;
    // the joining user isn't notified about their own action (spec §7).
    const adminIds = await getGroupAdminUserIds(tx, invitation.groupId, dbUser.id);
    await createNotifications(tx, adminIds, {
      type: "GROUP_MEMBER_JOINED",
      title: `${dbUser.name ?? dbUser.email} joined ${group.name}`,
      link: `/groups/${invitation.groupId}?tab=members`,
    });

    return { outcome: "ok" as const, alreadyMember: false as const, member };
  });

  if (result.outcome === "group_deleted" || result.outcome === "not_found") {
    return NOT_FOUND();
  }
  if (result.outcome === "unauthorized") {
    return UNAUTHORIZED();
  }
  if (result.outcome === "forbidden") {
    return FORBIDDEN();
  }
  if (result.outcome === "conflict") {
    return CONFLICT(result.message);
  }

  return NextResponse.json({
    groupId: invitation.groupId,
    role: result.member.role,
    alreadyMember: result.alreadyMember,
  });
}
