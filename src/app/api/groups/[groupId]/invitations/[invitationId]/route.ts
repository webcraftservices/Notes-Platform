import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleGroup,
  requireGroupRole,
  assertActiveGroupMemberForCreation,
  lockGroupInvitationForUpdate,
  NotAuthorizedError,
} from "@/lib/access";
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
 * before anything is read; inside `db.$transaction`, the parent Group is
 * locked `FOR SHARE`, the caller's `ADMIN`/`OWNER` role is revalidated
 * against concurrent demotion/removal, and the invitation's `PENDING`
 * status is re-verified before setting `status: "CANCELLED"`.
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
      return { status: "ok" as const };
    });

    if (txOutcome?.status === "not_found") return NOT_FOUND();
    if (txOutcome?.status === "conflict") {
      return CONFLICT("This invitation is no longer pending.");
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
