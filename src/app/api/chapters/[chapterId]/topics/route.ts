import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleChapter, NotAuthorizedError } from "@/lib/access";
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
