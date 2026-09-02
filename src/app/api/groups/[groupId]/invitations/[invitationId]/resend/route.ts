import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleGroup,
  requireGroupRole,
  findUserByNormalizedEmail,
  NotAuthorizedError,
} from "@/lib/access";
import { generateInvitationToken, invitationExpiryDate } from "@/lib/invitation-token";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, CONFLICT } from "@/lib/api-response";
import { ActivityAction, createActivityLog } from "@/lib/activity";
import { createNotification } from "@/lib/notifications";
import { canManageInvitation } from "@/lib/invitation-status";

/**
 * Resends a pending invitation. ADMIN+ only, same authorization shape as
 * cancel (see the sibling [invitationId]/route.ts DELETE handler).
 *
 * Reuses/resets the existing GroupInvitation row in place rather than
 * creating a second one — there is never a duplicate-active-invitation
 * risk here because this is an UPDATE, not an INSERT. The token is
 * rotated (a fresh `generateInvitationToken()`) and `expiresAt` is reset
 * to a full new TTL, so a stale copy of the old link (e.g. sitting in an
 * old, already-read notification) stops working once resent — the same
 * "old copy of a rotated secret should no longer work" property tokens
 * are supposed to have.
 *
 * In-app only, same honest limitation as invitation creation (spec §6,
 * no configured email provider): if the invitee already has an account,
 * a fresh Notification is created (re-surfacing it, unread, at the top
 * of their list); if they don't have an account yet, there is currently
 * no delivery mechanism for either a fresh invite or a resend — this
 * route does not fabricate one, and says so in the response rather than
 * claiming an email was sent.
 */
export async function POST(
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

    const invitedUser = await findUserByNormalizedEmail(invitation.email);

    const updated = await db.$transaction(async (tx) => {
      const refreshed = await tx.groupInvitation.update({
        where: { id: invitation.id },
        data: {
          token: generateInvitationToken(),
          expiresAt: invitationExpiryDate(),
        },
      });

      if (invitedUser) {
        await createNotification(tx, {
          userId: invitedUser.id,
          type: "GROUP_INVITATION",
          title: `You've been invited to join ${group.name}`,
          body: `${user.name ?? "Someone"} invited you to join "${group.name}" as ${refreshed.role.toLowerCase()}.`,
          link: `/invitations/${refreshed.token}`,
        });
      }

      await createActivityLog(tx, {
        groupId: group.id,
        userId: user.id,
        action: ActivityAction.INVITATION_RESENT,
        targetType: "invitation",
        targetId: refreshed.id,
        metadata: { email: refreshed.email },
      });

      return refreshed;
    });

    return NextResponse.json({
      invitation: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        invitedBy: updated.invitedBy,
        createdAt: updated.createdAt,
        expiresAt: updated.expiresAt,
        status: updated.status,
      },
      // Lets the UI show an honest confirmation ("Reminder sent" vs.
      // "Reminder ready — they'll see it once they create an account")
      // instead of a blanket "email sent" claim that isn't true here.
      delivered: Boolean(invitedUser),
    });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
