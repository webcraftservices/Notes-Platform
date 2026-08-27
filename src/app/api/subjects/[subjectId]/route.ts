import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleSubject, NotAuthorizedError } from "@/lib/access";
import { updateSubjectSchema } from "@/lib/validation/hierarchy";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

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

    const { archived, ...rest } = parsed.data;
    const subject = await db.subject.update({
      where: { id: params.subjectId },
      data: {
        ...rest,
        ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
      },
    });
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

    // Soft delete cascades to children so Trash/Recovery (spec §100) can
    // restore the whole subtree together later without orphaning rows.
    await db.$transaction([
      db.subject.update({ where: { id: params.subjectId }, data: { deletedAt: new Date() } }),
      db.chapter.updateMany({
        where: { subjectId: params.subjectId },
        data: { deletedAt: new Date() },
      }),
      db.topic.updateMany({
        where: { chapter: { subjectId: params.subjectId } },
        data: { deletedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
