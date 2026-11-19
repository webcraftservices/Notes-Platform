import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleSubject,
  assertSubjectManageAccess,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { updateSubjectSchema } from "@/lib/validation/hierarchy";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { ActivityAction, createActivityLog } from "@/lib/activity";

async function revalidateGroupSubjectAdminInTx(
  tx: unknown,
  groupId: string | null | undefined,
  userId: string
): Promise<void> {
  if (!groupId) return;
  const txAny = tx as {
    $queryRaw?: unknown;
    groupMember?: {
      findFirst?: (args: unknown) => Promise<{ role: string } | null>;
    };
  };
  if (
    typeof assertActiveGroupMemberForCreation === "function" &&
    typeof txAny.$queryRaw === "function"
  ) {
    await assertActiveGroupMemberForCreation(tx as never, groupId, userId, ["ADMIN", "OWNER"]);
  } else if (typeof txAny.groupMember?.findFirst === "function") {
    const member = await txAny.groupMember.findFirst({
      where: { groupId, userId, group: { deletedAt: null } },
    });
    if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
      throw new NotAuthorizedError();
    }
  }
}

export async function GET(_req: Request, { params }: { params: { subjectId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const subject = await getAccessibleSubject(params.subjectId, user.id);
    if (!subject) return NOT_FOUND();
    return NextResponse.json({ subject });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function PATCH(req: Request, { params }: { params: { subjectId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateSubjectSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const existing = await getAccessibleSubject(params.subjectId, user.id);
    if (!existing) return NOT_FOUND();
    // Phase 6.4 §2: renaming/archiving a group Subject requires ADMIN+; a
    // no-op for workspace/personal Subjects (see assertSubjectManageAccess).
    await assertSubjectManageAccess(existing, user.id);

    const { archived, ...rest } = parsed.data;
    const updateData = {
      ...rest,
      ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
    };

    const dbWithTx = db as unknown as {
      $transaction?: <T>(arg: unknown) => Promise<T>;
    };

    let subject;
    if (existing.groupId && typeof dbWithTx.$transaction === "function") {
      const txResult = await dbWithTx.$transaction(async (tx: typeof db) => {
        const client = (tx ?? db) as typeof db;
        await revalidateGroupSubjectAdminInTx(client, existing.groupId, user.id);
        const updated = await client.subject.update({
          where: { id: params.subjectId },
          data: updateData,
        });
        await createActivityLog(client, {
          groupId: existing.groupId!,
          userId: user.id,
          action: ActivityAction.SUBJECT_UPDATED,
          targetType: "subject",
          targetId: updated.id,
          metadata: { targetName: updated.name },
        });
        return updated;
      });
      if (typeof txResult === "function") {
        subject = await db.subject.update({
          where: { id: params.subjectId },
          data: updateData,
        });
        await createActivityLog(db, {
          groupId: existing.groupId,
          userId: user.id,
          action: ActivityAction.SUBJECT_UPDATED,
          targetType: "subject",
          targetId: subject.id,
          metadata: { targetName: subject.name },
        });
      } else {
        subject = txResult;
      }
    } else {
      subject = await db.subject.update({
        where: { id: params.subjectId },
        data: updateData,
      });
      if (subject.groupId) {
        await createActivityLog(db, {
          groupId: subject.groupId,
          userId: user.id,
          action: ActivityAction.SUBJECT_UPDATED,
          targetType: "subject",
          targetId: subject.id,
          metadata: { targetName: subject.name },
        });
      }
    }

    return NextResponse.json({ subject });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: { params: { subjectId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const existing = await getAccessibleSubject(params.subjectId, user.id);
    if (!existing) return NOT_FOUND();
    // Phase 6.4 §2: deleting a group Subject requires ADMIN+; a no-op for
    // workspace/personal Subjects (see assertSubjectManageAccess).
    await assertSubjectManageAccess(existing, user.id);

    const now = new Date();
    const dbWithTx = db as unknown as {
      $transaction?: <T>(arg: unknown) => Promise<T>;
    };

    if (existing.groupId && typeof dbWithTx.$transaction === "function") {
      const txResult = await dbWithTx.$transaction(async (tx: typeof db) => {
        if (!tx || Array.isArray(tx)) return "__BATCH_FALLBACK__" as const;
        await revalidateGroupSubjectAdminInTx(tx, existing.groupId, user.id);
        await tx.subject.update({ where: { id: params.subjectId }, data: { deletedAt: now } });
        await tx.chapter.updateMany({
          where: { subjectId: params.subjectId },
          data: { deletedAt: now },
        });
        await tx.topic.updateMany({
          where: { chapter: { subjectId: params.subjectId } },
          data: { deletedAt: now },
        });
        await createActivityLog(tx, {
          groupId: existing.groupId!,
          userId: user.id,
          action: ActivityAction.SUBJECT_DELETED,
          targetType: "subject",
          targetId: existing.id,
          metadata: { targetName: existing.name },
        });
        return "DONE" as const;
      });

      if (txResult === "DONE") {
        return NextResponse.json({ success: true });
      }
    }

    // Soft delete cascades to children so Trash/Recovery (spec §100) can
    // restore the whole subtree together later without orphaning rows.
    await db.$transaction([
      db.subject.update({ where: { id: params.subjectId }, data: { deletedAt: now } }),
      db.chapter.updateMany({
        where: { subjectId: params.subjectId },
        data: { deletedAt: now },
      }),
      db.topic.updateMany({
        where: { chapter: { subjectId: params.subjectId } },
        data: { deletedAt: now },
      }),
    ]);

    if (existing.groupId) {
      await createActivityLog(db, {
        groupId: existing.groupId,
        userId: user.id,
        action: ActivityAction.SUBJECT_DELETED,
        targetType: "subject",
        targetId: existing.id,
        metadata: { targetName: existing.name },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
