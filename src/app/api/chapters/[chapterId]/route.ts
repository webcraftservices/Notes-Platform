import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleChapter,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { updateChapterSchema } from "@/lib/validation/hierarchy";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

async function revalidateGroupChapterAccessInTx(
  tx: unknown,
  groupId: string | null | undefined,
  userId: string
): Promise<void> {
  if (!groupId) return;
  const txAny = tx as {
    $queryRaw?: unknown;
    groupMember?: {
      findFirst?: (args: unknown) => Promise<unknown | null>;
    };
  };
  if (
    typeof assertActiveGroupMemberForCreation === "function" &&
    typeof txAny.$queryRaw === "function"
  ) {
    await assertActiveGroupMemberForCreation(tx as never, groupId, userId);
  } else if (typeof txAny.groupMember?.findFirst === "function") {
    const member = await txAny.groupMember.findFirst({
      where: { groupId, userId, group: { deletedAt: null } },
    });
    if (!member) throw new NotAuthorizedError();
  }
}

export async function GET(_req: Request, { params }: { params: { chapterId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const chapter = await getAccessibleChapter(params.chapterId, user.id);
    if (!chapter) return NOT_FOUND();
    return NextResponse.json({ chapter });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function PATCH(req: Request, { params }: { params: { chapterId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateChapterSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const existing = await getAccessibleChapter(params.chapterId, user.id);
    if (!existing) return NOT_FOUND();

    const { archived, ...rest } = parsed.data;
    const updateData = {
      ...rest,
      ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
    };
    const groupId = existing.subject?.groupId ?? null;
    const dbWithTx = db as unknown as {
      $transaction?: <T>(arg: unknown) => Promise<T>;
    };

    if (groupId && typeof dbWithTx.$transaction === "function") {
      const txResult = await dbWithTx.$transaction(async (tx: typeof db) => {
        if (!tx || Array.isArray(tx)) return "__FALLBACK__" as const;
        await revalidateGroupChapterAccessInTx(tx, groupId, user.id);
        return tx.chapter.update({
          where: { id: params.chapterId },
          data: updateData,
        });
      });
      if (txResult !== "__FALLBACK__" && typeof txResult !== "function") {
        return NextResponse.json({ chapter: txResult });
      }
    }

    const chapter = await db.chapter.update({
      where: { id: params.chapterId },
      data: updateData,
    });
    return NextResponse.json({ chapter });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: { params: { chapterId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const existing = await getAccessibleChapter(params.chapterId, user.id);
    if (!existing) return NOT_FOUND();

    const groupId = existing.subject?.groupId ?? null;
    const now = new Date();
    const dbWithTx = db as unknown as {
      $transaction?: <T>(arg: unknown) => Promise<T>;
    };

    if (groupId && typeof dbWithTx.$transaction === "function") {
      const txResult = await dbWithTx.$transaction(async (tx: typeof db) => {
        if (!tx || Array.isArray(tx)) return "__FALLBACK__" as const;
        await revalidateGroupChapterAccessInTx(tx, groupId, user.id);
        await tx.chapter.update({ where: { id: params.chapterId }, data: { deletedAt: now } });
        await tx.topic.updateMany({
          where: { chapterId: params.chapterId },
          data: { deletedAt: now },
        });
        return "DONE" as const;
      });
      if (txResult === "DONE") {
        return NextResponse.json({ success: true });
      }
    }

    await db.$transaction([
      db.chapter.update({ where: { id: params.chapterId }, data: { deletedAt: now } }),
      db.topic.updateMany({
        where: { chapterId: params.chapterId },
        data: { deletedAt: now },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
