import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleNote, NotAuthorizedError } from "@/lib/access";
import { updateNoteSchema } from "@/lib/validation/notes";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

export async function PATCH(req: Request, { params }: { params: { noteId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateNoteSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const existing = await getAccessibleNote(params.noteId, user.id);
    if (!existing) return NOT_FOUND();

    const note = await db.note.update({ where: { id: params.noteId }, data: parsed.data });
    return NextResponse.json({ note });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
