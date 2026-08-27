import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleChapter, NotAuthorizedError } from "@/lib/access";
import { updateChapterSchema } from "@/lib/validation/hierarchy";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

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
    const chapter = await db.chapter.update({
      where: { id: params.chapterId },
      data: {
        ...rest,
        ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
      },
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

    await db.$transaction([
      db.chapter.update({ where: { id: params.chapterId }, data: { deletedAt: new Date() } }),
      db.topic.updateMany({
        where: { chapterId: params.chapterId },
        data: { deletedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
