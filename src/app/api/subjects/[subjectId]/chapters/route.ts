import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleSubject, NotAuthorizedError } from "@/lib/access";
import { createChapterSchema } from "@/lib/validation/hierarchy";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

export async function GET(_req: Request, { params }: { params: { subjectId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const subject = await getAccessibleSubject(params.subjectId, user.id);
    if (!subject) return NOT_FOUND();

    const chapters = await db.chapter.findMany({
      where: { subjectId: subject.id, deletedAt: null, archivedAt: null },
      orderBy: { order: "asc" },
    });
    return NextResponse.json({ chapters });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function POST(req: Request, { params }: { params: { subjectId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = createChapterSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const subject = await getAccessibleSubject(params.subjectId, user.id);
    if (!subject) return NOT_FOUND();

    const lastChapter = await db.chapter.findFirst({
      where: { subjectId: subject.id, deletedAt: null },
      orderBy: { order: "desc" },
    });

    const chapter = await db.chapter.create({
      data: {
        ...parsed.data,
        subjectId: subject.id,
        order: (lastChapter?.order ?? -1) + 1,
      },
    });

    return NextResponse.json({ chapter }, { status: 201 });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
