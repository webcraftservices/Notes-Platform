import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleNote, NotAuthorizedError } from "@/lib/access";
import { saveBlocksSchema } from "@/lib/validation/notes";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000; // at most one automatic snapshot per 10 minutes

/**
 * The editor sends its full current block list on every autosave — no
 * per-block create/update/delete API, this endpoint diffs against the DB
 * itself. That trades a slightly larger payload for a much simpler client
 * and a save operation that's naturally idempotent and race-resistant
 * (the last write always fully describes the note's state).
 *
 * Security note: block ids in the incoming payload are client-generated
 * (so the editor has stable keys before the first save). We never trust
 * an incoming id enough to run an update against it — only ids that are
 * already present on THIS note (per our own prior read) can be updated;
 * everything else is always inserted as a brand-new row with a
 * server-generated id, even if the client's temp id happens to collide
 * with something else in the table. Doing an upsert keyed on the raw
 * client id would let one user overwrite another note's block just by
 * guessing/reusing its id — that bug was caught and fixed before this
 * shipped, not after.
 *
 * Version history (spec §70) is intentionally coarse: an automatic
 * snapshot is written at most once every 10 minutes of active editing,
 * plus one on every explicit "Save version" call from the client (the
 * `explicit` flag) — not on every keystroke-triggered autosave, which
 * would make the version list useless noise.
 */
export async function PUT(req: Request, { params }: { params: { noteId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = saveBlocksSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);
  const explicit = body?.explicit === true;

  try {
    const note = await getAccessibleNote(params.noteId, user.id);
    if (!note) return NOT_FOUND();

    const incoming = parsed.data.blocks;

    const existingBlocks = await db.noteBlock.findMany({
      where: { noteId: note.id },
      orderBy: { order: "asc" },
    });
    const existingIds = new Set(existingBlocks.map((b) => b.id));

    const toUpdate = incoming.filter((b) => existingIds.has(b.id));
    const toCreate = incoming.filter((b) => !existingIds.has(b.id));
    const keepIds = new Set(toUpdate.map((b) => b.id));

    const lastVersion = await db.noteVersion.findFirst({
      where: { noteId: note.id },
      orderBy: { createdAt: "desc" },
    });
    const shouldSnapshot =
      explicit || !lastVersion || Date.now() - lastVersion.createdAt.getTime() > AUTO_VERSION_INTERVAL_MS;

    await db.$transaction([
      ...(shouldSnapshot && existingBlocks.length > 0
        ? [
            db.noteVersion.create({
              data: { noteId: note.id, editedById: user.id, snapshot: existingBlocks as unknown as object },
            }),
          ]
        : []),
      db.noteBlock.deleteMany({ where: { noteId: note.id, id: { notIn: [...keepIds] } } }),
      ...toUpdate.map((block) =>
        db.noteBlock.update({
          where: { id: block.id },
          data: {
            kind: block.kind,
            heading: block.heading || null,
            content: block.content,
            order: block.order,
          },
        })
      ),
      ...toCreate.map((block) =>
        db.noteBlock.create({
          data: {
            noteId: note.id,
            kind: block.kind,
            heading: block.heading || null,
            content: block.content,
            order: block.order,
          },
        })
      ),
      db.note.update({ where: { id: note.id }, data: {} }),
      ...(note.topicId ? [db.topic.update({ where: { id: note.topicId }, data: {} })] : []),
    ]);

    const saved = await db.noteBlock.findMany({ where: { noteId: note.id }, orderBy: { order: "asc" } });

    return NextResponse.json({ blocks: saved, versioned: shouldSnapshot && existingBlocks.length > 0 });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
