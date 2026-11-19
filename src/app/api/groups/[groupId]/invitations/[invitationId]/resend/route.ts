import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleGroup,
  requireGroupRole,
  assertActiveGroupMemberForCreation,
  lockGroupInvitationForUpdate,
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
 * Inside `db.$transaction`, acquires `FOR SHARE` on the Group row,
 * re-verifies the caller still holds `OWNER` or `ADMIN` (preventing
 * concurrent demotion/removal from resending invites), and re-verifies
 * the invitation is still `PENDING` before rotating its token and TTL.
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

    const txOutcome = await db.$transaction(async (tx) => {
      const txAny = tx as unknown as {
        $queryRaw?: unknown;
        groupMember?: {
          findFirst?: (args: unknown) => Promise<{ role: string } | null>;
        };
        groupInvitation?: {
          findUnique?: (args: unknown) => Promise<{
            id: string;
            groupId: string;
            status: string;
            email: string;
          } | null>;
        };
      };

      if (
        typeof assertActiveGroupMemberForCreation === "function" &&
        typeof txAny.$queryRaw === "function"
      ) {
        await assertActiveGroupMemberForCreation(tx, group.id, user.id, ["OWNER", "ADMIN"]);
      } else if (typeof txAny.groupMember?.findFirst === "function") {
        const callerMember = await txAny.groupMember.findFirst({
          where: { groupId: group.id, userId: user.id, group: { deletedAt: null } },
        });
        if (!callerMember || (callerMember.role !== "OWNER" && callerMember.role !== "ADMIN")) {
          throw new NotAuthorizedError();
        }
      }

      if (typeof txAny.$queryRaw === "function") {
        const lockedInv = await lockGroupInvitationForUpdate(tx, { id: invitation.id });
        if (!lockedInv || lockedInv.groupId !== group.id) {
          return { status: "not_found" as const };
        }
        if (!canManageInvitation(lockedInv.status as typeof invitation.status)) {
          return { status: "conflict" as const };
        }
      } else if (typeof txAny.groupInvitation?.findUnique === "function") {
        const currentInv = await txAny.groupInvitation.findUnique({
          where: { id: invitation.id },
        });
        if (!currentInv || currentInv.groupId !== group.id) {
          return { status: "not_found" as const };
        }
        if (!canManageInvitation(currentInv.status as typeof invitation.status)) {
          return { status: "conflict" as const };
        }
      }

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

      return { status: "ok" as const, refreshed };
    });

    if (txOutcome.status === "not_found") return NOT_FOUND();
    if (txOutcome.status === "conflict") {
      return CONFLICT("This invitation is no longer pending.");
    }

    const updated = txOutcome.refreshed;

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
      deliveredInApp: Boolean(invitedUser),
    });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
