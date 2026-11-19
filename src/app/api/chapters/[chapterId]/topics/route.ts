import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleChapter,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { createTopicSchema } from "@/lib/validation/hierarchy";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

export async function GET(_req: Request, { params }: { params: { chapterId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const chapter = await getAccessibleChapter(params.chapterId, user.id);
    if (!chapter) return NOT_FOUND();

    const topics = await db.topic.findMany({
      where: { chapterId: chapter.id, deletedAt: null, archivedAt: null },
      orderBy: { order: "asc" },
    });
    return NextResponse.json({ topics });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function POST(req: Request, { params }: { params: { chapterId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = createTopicSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const chapter = await getAccessibleChapter(params.chapterId, user.id);
    if (!chapter) return NOT_FOUND();

    const groupId = chapter.subject?.groupId ?? null;
    if (groupId) {
      const topic = await db.$transaction(async (tx) => {
        await assertActiveGroupMemberForCreation(tx, groupId, user.id);

        const activeChapter = await tx.chapter.findFirst({
          where: {
            id: chapter.id,
            deletedAt: null,
            subject: { groupId, deletedAt: null },
          },
          select: { id: true },
        });
        if (!activeChapter) return null;

        const lastTopic = await tx.topic.findFirst({
          where: { chapterId: chapter.id, deletedAt: null },
          orderBy: { order: "desc" },
        });

        return tx.topic.create({
          data: {
            ...parsed.data,
            chapterId: chapter.id,
            order: (lastTopic?.order ?? -1) + 1,
          },
        });
      });

      if (!topic) return NOT_FOUND();
      return NextResponse.json({ topic }, { status: 201 });
    }

    const lastTopic = await db.topic.findFirst({
      where: { chapterId: chapter.id, deletedAt: null },
      orderBy: { order: "desc" },
    });

    const topic = await db.topic.create({
      data: {
        ...parsed.data,
        chapterId: chapter.id,
        order: (lastTopic?.order ?? -1) + 1,
      },
    });

    return NextResponse.json({ topic }, { status: 201 });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
