import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/access";
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
 * through `normalizeEmail`. This is checked against a fresh `db.user`
 * read, not `session.user.email`, so it reflects the actual current
 * database value.
 *
 * Concurrency (spec §7's "handle concurrent acceptance safely"): the
 * transition out of PENDING uses a conditional `updateMany({ where: {
 * token, status: "PENDING" } })` rather than an unconditional update.
 * Postgres re-evaluates that WHERE clause against the committed row once
 * any lock is released, so if two requests race, only the first can ever
 * match `status: "PENDING"` — the second's `count` comes back `0` and is
 * treated as "already consumed," never as a second membership. This is
 * the same "conditional update, check the affected count" idiom as
 * optimistic locking, without needing a separate version column.
 */
export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return UNAUTHORIZED();

  const invitation = await db.groupInvitation.findUnique({ where: { token: params.token } });
  if (!invitation) return NOT_FOUND();

  if (invitation.status !== "PENDING") {
    return CONFLICT("This invitation is no longer available.");
  }

  if (invitation.expiresAt < new Date()) {
    // Lazily flip PENDING -> EXPIRED on first encounter past expiry, so it
    // stops showing up as "pending" in the group's invitation list. Guarded
    // the same conditional way as the accept path below, though a race here
    // is harmless either way (both outcomes are "not accepted").
    await db.groupInvitation.updateMany({
      where: { token: params.token, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    return CONFLICT("This invitation has expired.");
  }

  const dbUser = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, email: true, name: true },
  });
  if (!dbUser) return UNAUTHORIZED();

  if (normalizeEmail(dbUser.email) !== normalizeEmail(invitation.email)) {
    return FORBIDDEN();
  }

  const result = await db.$transaction(async (tx) => {
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
      return { alreadyMember: true as const, member: existingMembership };
    }

    const consumed = await tx.groupInvitation.updateMany({
      where: { token: params.token, status: "PENDING" },
      data: { status: "ACCEPTED" },
    });
    if (consumed.count === 0) {
      // Someone else accepted/declined this invitation in the moment
      // between our checks above and this transaction.
      return { raced: true as const };
    }

    // invitation.role is guaranteed non-OWNER by createInvitationSchema
    // at creation time — never re-derived or trusted from client input here.
    const member = await tx.groupMember.create({
      data: { groupId: invitation.groupId, userId: dbUser.id, role: invitation.role },
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
    const group = await tx.group.findUnique({
      where: { id: invitation.groupId },
      select: { name: true },
    });
    const adminIds = await getGroupAdminUserIds(tx, invitation.groupId, dbUser.id);
    await createNotifications(tx, adminIds, {
      type: "GROUP_MEMBER_JOINED",
      title: `${dbUser.name ?? dbUser.email} joined ${group?.name ?? "your group"}`,
      link: `/groups/${invitation.groupId}?tab=members`,
    });

    return { alreadyMember: false as const, member };
  });

  if ("raced" in result) {
    return CONFLICT("This invitation has already been used.");
  }

  return NextResponse.json({
    groupId: invitation.groupId,
    role: result.member.role,
    alreadyMember: result.alreadyMember,
  });
}
