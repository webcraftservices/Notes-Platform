import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleNote, NotAuthorizedError } from "@/lib/access";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, jsonError } from "@/lib/api-response";

interface SnapshotBlock {
  id: string;
  kind: string;
  heading: string | null;
  content: unknown;
  order: number;
  metadata: unknown;
}

/**
 * Restoring is non-destructive: the current state is snapshotted first
 * (so restoring is itself undoable by restoring the version right before
 * it), then the target snapshot's blocks fully replace the current ones.
 */
export async function POST(
  _req: Request,
  { params }: { params: { noteId: string; versionId: string } }
) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const note = await getAccessibleNote(params.noteId, user.id);
    if (!note) return NOT_FOUND();

    const version = await db.noteVersion.findUnique({ where: { id: params.versionId } });
    if (!version || version.noteId !== note.id) return NOT_FOUND();

    const snapshotBlocks = version.snapshot as unknown as SnapshotBlock[];
    if (!Array.isArray(snapshotBlocks)) {
      return jsonError("This version's data looks corrupted and can't be restored.", 422);
    }

    const currentBlocks = await db.noteBlock.findMany({ where: { noteId: note.id } });

    await db.$transaction([
      ...(currentBlocks.length > 0
        ? [
            db.noteVersion.create({
              data: { noteId: note.id, editedById: user.id, snapshot: currentBlocks as unknown as object },
            }),
          ]
        : []),
      db.noteBlock.deleteMany({ where: { noteId: note.id } }),
      ...snapshotBlocks.map((block) =>
        db.noteBlock.create({
          data: {
            noteId: note.id,
            kind: block.kind as never,
            heading: block.heading,
            content: block.content as object,
            order: block.order,
          },
        })
      ),
    ]);

    const blocks = await db.noteBlock.findMany({ where: { noteId: note.id }, orderBy: { order: "asc" } });
    return NextResponse.json({ blocks });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
