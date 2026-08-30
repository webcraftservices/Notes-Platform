import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleGroup, getGroupRole, NotAuthorizedError } from "@/lib/access";
import { canChangeMemberRole, canRemoveMember } from "@/lib/group-role";
import { updateMemberRoleSchema } from "@/lib/validation/groups";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

/**
 * Changes a member's role. Authorization follows the Phase 6.2 matrix via
 * `canChangeMemberRole` (lib/group-role.ts) — OWNER is protected as both
 * the actor-can't-be-below-ADMIN check and the target/newRole OWNER
 * checks, all in that one pure function, so this route doesn't re-derive
 * the rules inline. Wrapped in a transaction even though it's a single
 * write: `requireGroupRole`'s read and this `update` are two separate
 * round-trips, and a concurrent request could change the target's role
 * (e.g. to OWNER via a hypothetical future path, or removing them)
 * between them — the transaction's own read-then-write happens under one
 * connection, and re-checking `targetMembership` inside it closes that
 * window rather than trusting the pre-transaction read.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { groupId: string; userId: string } }
) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateMemberRoleSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const group = await getAccessibleGroup(params.groupId, user.id);
    if (!group) return NOT_FOUND();

    const actorRole = await getGroupRole(group.id, user.id);
    if (!actorRole) return FORBIDDEN();

    const updated = await db.$transaction(async (tx) => {
      const target = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: group.id, userId: params.userId } },
      });
      if (!target) return null;

      if (!canChangeMemberRole(actorRole, target.role, parsed.data.role)) {
        throw new NotAuthorizedError();
      }

      return tx.groupMember.update({
        where: { groupId_userId: { groupId: group.id, userId: params.userId } },
        data: { role: parsed.data.role },
      });
    });

    if (!updated) return NOT_FOUND();

    return NextResponse.json({ member: { userId: updated.userId, role: updated.role } });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

/**
 * Removes a member, or lets a member remove themselves ("leave"), through
 * the same endpoint — the Phase 6.2 doc specifies both flow through
 * DELETE. `isSelf` is derived from comparing the caller to the target
 * path param, then handed to `canRemoveMember` alongside both roles so
 * the OWNER-can-never-be-removed-or-leave rule is enforced by the one
 * shared pure function rather than duplicated per-branch.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { groupId: string; userId: string } }
) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const group = await getAccessibleGroup(params.groupId, user.id);
    if (!group) return NOT_FOUND();

    const actorRole = await getGroupRole(group.id, user.id);
    if (!actorRole) return FORBIDDEN();

    const isSelf = user.id === params.userId;

    const removed = await db.$transaction(async (tx) => {
      const target = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: group.id, userId: params.userId } },
      });
      if (!target) return null;

      if (!canRemoveMember(actorRole, target.role, isSelf)) {
        throw new NotAuthorizedError();
      }

      await tx.groupMember.delete({
        where: { groupId_userId: { groupId: group.id, userId: params.userId } },
      });
      return target;
    });

    if (!removed) return NOT_FOUND();

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
