import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleGroup,
  getGroupRole,
  requireGroupRole,
  lockGroupForUpdate,
  NotAuthorizedError,
} from "@/lib/access";
import { updateGroupSchema } from "@/lib/validation/groups";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { ActivityAction, createActivityLog } from "@/lib/activity";
import { createNotifications } from "@/lib/notifications";

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
 * Soft-deletes a Group and all group-scoped child resources atomically in a
 * single Prisma interactive transaction (Phase 10C.1D). Requires OWNER.
 *
 * Cascading soft-deletion sequence:
 * 1. Verify group exists and is active (deletedAt === null); 404 otherwise.
 * 2. Verify caller is OWNER; 403 otherwise.
 * 3. Capture current member IDs and group name.
 * 4. Soft-delete Group.
 * 5. Soft-delete active group-owned Subjects.
 * 6. Soft-delete active Chapters under those Subjects.
 * 7. Soft-delete active Topics under those Chapters.
 * 8. Soft-delete active Notes under those Topics.
 * 9. Soft-delete active group-owned Materials.
 * 10. Soft-delete active group-owned AIConversations.
 * 11. Cancel pending GroupInvitations (status: CANCELLED).
 * 12. Cancel queued/running ProcessingJobs for group materials (status: CANCELLED).
 * 13. Record GROUP_DELETED activity event.
 * 14. Dispatch SYSTEM notification to remaining members (excluding deleting owner).
 */
export async function DELETE(_req: Request, { params }: { params: { groupId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const result = await db.$transaction(async (tx) => {
      // 1. Acquire exclusive lock on the Group row to serialize against resource creation
      const locked = await lockGroupForUpdate(tx, params.groupId);
      if (!locked || locked.deletedAt !== null) {
        return { status: "not_found" as const };
      }

      const group = await tx.group.findUnique({
        where: { id: params.groupId },
        include: { members: true },
      });
      if (!group || group.deletedAt !== null) {
        return { status: "not_found" as const };
      }

      const callerMember = group.members.find((m) => m.userId === user.id);
      if (!callerMember || callerMember.role !== "OWNER") {
        return { status: "forbidden" as const };
      }

      const otherMemberIds = group.members
        .filter((m) => m.userId !== user.id)
        .map((m) => m.userId);
      const now = new Date();

      // 4. Soft-delete the Group atomically: requires exactly one row updated with deletedAt: null
      const { count } = await tx.group.updateMany({
        where: { id: group.id, deletedAt: null },
        data: { deletedAt: now },
      });
      if (count === 0) {
        return { status: "not_found" as const };
      }

      await tx.subject.updateMany({
        where: { groupId: group.id, deletedAt: null },
        data: { deletedAt: now },
      });

      await tx.chapter.updateMany({
        where: { subject: { groupId: group.id }, deletedAt: null },
        data: { deletedAt: now },
      });

      await tx.topic.updateMany({
        where: { chapter: { subject: { groupId: group.id } }, deletedAt: null },
        data: { deletedAt: now },
      });

      await tx.note.updateMany({
        where: { topic: { chapter: { subject: { groupId: group.id } } }, deletedAt: null },
        data: { deletedAt: now },
      });

      await tx.material.updateMany({
        where: { groupId: group.id, deletedAt: null },
        data: { deletedAt: now },
      });

      await tx.aIConversation.updateMany({
        where: { groupId: group.id, deletedAt: null },
        data: { deletedAt: now },
      });

      await tx.groupInvitation.updateMany({
        where: { groupId: group.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });

      await tx.processingJob.updateMany({
        where: {
          material: { groupId: group.id },
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: {
          status: "CANCELLED",
          error: "Parent group was deleted.",
          completedAt: now,
        },
      });

      await createActivityLog(tx, {
        groupId: group.id,
        userId: user.id,
        action: ActivityAction.GROUP_DELETED,
        targetType: "group",
        targetId: group.id,
        metadata: { targetName: group.name },
      });

      if (otherMemberIds.length > 0) {
        await createNotifications(tx, otherMemberIds, {
          type: "SYSTEM",
          title: `${user.name ?? "The owner"} deleted the group "${group.name}".`,
        });
      }

      return { status: "success" as const };
    });

    if (result.status === "not_found") return NOT_FOUND();
    if (result.status === "forbidden") return FORBIDDEN();

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
