import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleTopic,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { updateTopicSchema } from "@/lib/validation/hierarchy";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

async function revalidateGroupTopicAccessInTx(
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

export async function GET(_req: Request, { params }: { params: { topicId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const topic = await getAccessibleTopic(params.topicId, user.id);
    if (!topic) return NOT_FOUND();
    return NextResponse.json({ topic });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function PATCH(req: Request, { params }: { params: { topicId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateTopicSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const existing = await getAccessibleTopic(params.topicId, user.id);
    if (!existing) return NOT_FOUND();

    const { archived, ...rest } = parsed.data;
    const updateData = {
      ...rest,
      ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
    };
    const groupId = existing.chapter?.subject?.groupId ?? null;
    const dbWithTx = db as unknown as {
      $transaction?: <T>(arg: unknown) => Promise<T>;
    };

    if (groupId && typeof dbWithTx.$transaction === "function") {
      const txResult = await dbWithTx.$transaction(async (tx: typeof db) => {
        if (!tx || Array.isArray(tx)) return "__FALLBACK__" as const;
        await revalidateGroupTopicAccessInTx(tx, groupId, user.id);
        return tx.topic.update({
          where: { id: params.topicId },
          data: updateData,
        });
      });
      if (txResult !== "__FALLBACK__" && typeof txResult !== "function") {
        return NextResponse.json({ topic: txResult });
      }
    }

    const topic = await db.topic.update({
      where: { id: params.topicId },
      data: updateData,
    });
    return NextResponse.json({ topic });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: { params: { topicId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const existing = await getAccessibleTopic(params.topicId, user.id);
    if (!existing) return NOT_FOUND();

    const groupId = existing.chapter?.subject?.groupId ?? null;
    const now = new Date();
    const dbWithTx = db as unknown as {
      $transaction?: <T>(arg: unknown) => Promise<T>;
    };

    if (groupId && typeof dbWithTx.$transaction === "function") {
      const txResult = await dbWithTx.$transaction(async (tx: typeof db) => {
        if (!tx || Array.isArray(tx)) return "__FALLBACK__" as const;
        await revalidateGroupTopicAccessInTx(tx, groupId, user.id);
        await tx.topic.update({ where: { id: params.topicId }, data: { deletedAt: now } });
        return "DONE" as const;
      });
      if (txResult === "DONE") {
        return NextResponse.json({ success: true });
      }
    }

    await db.topic.update({ where: { id: params.topicId }, data: { deletedAt: now } });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
