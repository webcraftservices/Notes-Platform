import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleGroup, getGroupRole, requireGroupRole, NotAuthorizedError } from "@/lib/access";
import { updateGroupSchema } from "@/lib/validation/groups";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

export async function GET(_req: Request, { params }: { params: { groupId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const group = await getAccessibleGroup(params.groupId, user.id);
    if (!group) return NOT_FOUND();

    const [role, memberCount] = await Promise.all([
      getGroupRole(group.id, user.id),
      db.groupMember.count({ where: { groupId: group.id } }),
    ]);

    return NextResponse.json({ group: { ...group, role, memberCount } });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

/** Rename/edit a Group. Requires ADMIN or OWNER (spec §34) — MEMBER/VIEWER are rejected server-side. */
export async function PATCH(req: Request, { params }: { params: { groupId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const existing = await getAccessibleGroup(params.groupId, user.id);
    if (!existing) return NOT_FOUND();
    await requireGroupRole(params.groupId, user.id, "ADMIN");

    const group = await db.group.update({
      where: { id: params.groupId },
      data: parsed.data,
    });
    return NextResponse.json({ group });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

/**
 * Soft-deletes a Group. Requires OWNER (spec §34) — no ownership-transfer
 * path exists yet, so this is the only way an OWNER can give up a group.
 *
 * Phase 6.1 scope note: this only soft-deletes the Group row itself.
 * Phase 6.1 does not yet let any Subject/Material attach to a Group (that
 * ships in Phase 6.4), so there is nothing to cascade to today — unlike
 * `DELETE /api/subjects/[subjectId]`, which genuinely does cascade to
 * Chapters/Topics that can exist under it right now. Once Phase 6.4 ships
 * group-owned Subjects, this route must be revisited to cascade the same
 * way Subject's delete does (soft-delete member Subjects/Chapters/Topics/
 * Materials), or those rows would be silently orphaned under a deleted
 * Group. Documented here rather than speculatively implemented against a
 * hierarchy that doesn't exist yet.
 */
export async function DELETE(_req: Request, { params }: { params: { groupId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const existing = await getAccessibleGroup(params.groupId, user.id);
    if (!existing) return NOT_FOUND();
    await requireGroupRole(params.groupId, user.id, "OWNER");

    await db.group.update({
      where: { id: params.groupId },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
