import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleNote, NotAuthorizedError } from "@/lib/access";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

export async function GET(_req: Request, { params }: { params: { noteId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const note = await getAccessibleNote(params.noteId, user.id);
    if (!note) return NOT_FOUND();

    // Snapshots can be large (full block content); the list view only
    // needs enough to label each entry, not the full payload.
    const versions = await db.noteVersion.findMany({
      where: { noteId: note.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, editedById: true },
      take: 50,
    });

    return NextResponse.json({ versions });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
