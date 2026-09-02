import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleGroup, requireGroupRole, NotAuthorizedError } from "@/lib/access";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, CONFLICT } from "@/lib/api-response";
import { ActivityAction, createActivityLog } from "@/lib/activity";
import { canManageInvitation } from "@/lib/invitation-status";

/**
 * Cancels a pending invitation. ADMIN+ only, mirroring the exact
 * authorization the sibling POST /invitations route already uses for
 * *creating* an invite — cancelling one is the same privilege level.
 *
 * Authorization is derived entirely from the session + database, never
 * the request: `groupId` comes from the URL but is re-verified against
 * `getAccessibleGroup` (membership) and `requireGroupRole` (ADMIN+)
 * before anything is read; the invitation is then loaded by its own id
 * and cross-checked against `groupId` so an admin of Group A can't cancel
 * an invitation belonging to Group B just by guessing an id — same
 * belongs-to-this-group check every other nested group resource route
 * uses.
 *
 * Sets status to CANCELLED rather than deleting the row (matches the
 * existing DECLINED pattern — see prisma/schema.prisma) so the
 * invitation's activity history stays intact and a second admin can't
 * silently create a same-token invite by id reuse.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { groupId: string; invitationId: string } },
) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const group = await getAccessibleGroup(params.groupId, user.id);
    if (!group) return NOT_FOUND();
    await requireGroupRole(group.id, user.id, "ADMIN");

    const invitation = await db.groupInvitation.findUnique({
      where: { id: params.invitationId },
    });
    if (!invitation || invitation.groupId !== group.id) return NOT_FOUND();
    if (!canManageInvitation(invitation.status)) {
      return CONFLICT("This invitation is no longer pending.");
    }

    await db.$transaction(async (tx) => {
      await tx.groupInvitation.update({
        where: { id: invitation.id },
        data: { status: "CANCELLED" },
      });
      await createActivityLog(tx, {
        groupId: group.id,
        userId: user.id,
        action: ActivityAction.INVITATION_CANCELLED,
        targetType: "invitation",
        targetId: invitation.id,
        metadata: { email: invitation.email },
      });
    });

    // No notification to the invitee: telling someone their invitation
    // was revoked has no clear upside and reads as an awkward, slightly
    // hostile notification (spec §8's "avoid confusing... spam if the
    // product semantics don't require it" applies here too, not just to
    // resend). The cancellation is still fully visible to the group's
    // admins/owners via the Activity log above.
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
