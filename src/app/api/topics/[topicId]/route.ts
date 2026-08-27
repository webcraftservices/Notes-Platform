import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleTopic, NotAuthorizedError } from "@/lib/access";
import { updateTopicSchema } from "@/lib/validation/hierarchy";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

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
    const topic = await db.topic.update({
      where: { id: params.topicId },
      data: {
        ...rest,
        ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
      },
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

    await db.topic.update({ where: { id: params.topicId }, data: { deletedAt: new Date() } });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
