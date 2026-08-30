import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleGroup,
  requireGroupRole,
  findUserByNormalizedEmail,
  NotAuthorizedError,
} from "@/lib/access";
import { createInvitationSchema } from "@/lib/validation/groups";
import { generateInvitationToken, invitationExpiryDate } from "@/lib/invitation-token";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN, CONFLICT } from "@/lib/api-response";

/**
 * Lists a group's pending invitations. ADMIN/OWNER only (spec §5) — the
 * raw `token` is never included in the response; nothing in the
 * eventual member-management UI needs it (invitees reach
 * `/api/invitations/[token]/accept` via their own notification `link`,
 * not by an admin copying a token out of this list).
 */
export async function GET(_req: Request, { params }: { params: { groupId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const group = await getAccessibleGroup(params.groupId, user.id);
    if (!group) return NOT_FOUND();
    await requireGroupRole(group.id, user.id, "ADMIN");

    const invitations = await db.groupInvitation.findMany({
      where: { groupId: group.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      invitations: invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        invitedBy: inv.invitedBy,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
        status: inv.status,
      })),
    });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

/**
 * Creates an invitation. ADMIN/OWNER only. In-app only — no configured
 * email provider (spec §6), so the only delivery mechanism is the
 * Notification created below when the email matches an existing User.
 *
 * Concurrency note (spec §16, "duplicate invitations"): the
 * duplicate-pending-invitation check below is a `findFirst` inside the
 * same `$transaction` as the `create`, using Postgres's default READ
 * COMMITTED isolation — this narrows the race window (both statements
 * share one connection/transaction) but does not fully eliminate two
 * truly simultaneous requests both passing the check before either
 * commits. A stricter guarantee would need a partial unique index
 * (`UNIQUE (groupId, email) WHERE status = 'PENDING'`), which isn't
 * expressible in `schema.prisma`'s declarative index syntax and would
 * only be enforceable via a hand-written raw-SQL migration living outside
 * the schema's source of truth — the Phase 6.2 doc explicitly says not to
 * over-engineer this, so the (already narrow) transactional check is used
 * instead and this limitation is documented rather than silently
 * papered over. Worst case of losing the race: two GroupInvitation rows
 * for the same group/email, which accept/decline both handle safely
 * (whichever is accepted first wins; the other remains PENDING but is
 * harmless — accepting it would just re-run the "already a member" path).
 */
export async function POST(req: Request, { params }: { params: { groupId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = createInvitationSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const group = await getAccessibleGroup(params.groupId, user.id);
    if (!group) return NOT_FOUND();
    await requireGroupRole(group.id, user.id, "ADMIN");

    const { email, role } = parsed.data;

    const invitedUser = await findUserByNormalizedEmail(email);
    if (invitedUser) {
      const existingMembership = await db.groupMember.findUnique({
        where: { groupId_userId: { groupId: group.id, userId: invitedUser.id } },
      });
      if (existingMembership) {
        return CONFLICT("This person is already a member of the group.");
      }
    }

    const result = await db.$transaction(async (tx) => {
      const existingInvitation = await tx.groupInvitation.findFirst({
        where: { groupId: group.id, email, status: "PENDING", expiresAt: { gt: new Date() } },
      });
      if (existingInvitation) return { conflict: true as const };

      const invitation = await tx.groupInvitation.create({
        data: {
          groupId: group.id,
          email,
          role,
          invitedBy: user.id,
          token: generateInvitationToken(),
          expiresAt: invitationExpiryDate(),
        },
      });

      if (invitedUser) {
        await tx.notification.create({
          data: {
            userId: invitedUser.id,
            type: "GROUP_INVITATION",
            title: `You've been invited to join ${group.name}`,
            body: `${user.name ?? "Someone"} invited you to join "${group.name}" as ${role.toLowerCase()}.`,
            link: `/invitations/${invitation.token}`,
          },
        });
      }

      return { conflict: false as const, invitation };
    });

    if (result.conflict) {
      return CONFLICT("There's already a pending invitation for this email.");
    }

    return NextResponse.json(
      {
        invitation: {
          id: result.invitation.id,
          email: result.invitation.email,
          role: result.invitation.role,
          invitedBy: result.invitation.invitedBy,
          createdAt: result.invitation.createdAt,
          expiresAt: result.invitation.expiresAt,
          status: result.invitation.status,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
