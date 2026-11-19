import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleNote,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { updateNoteSchema } from "@/lib/validation/notes";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { buildNotePlainText } from "@/lib/search/tiptap-text";
import { syncNoteSearchIndex, deleteNoteChunks } from "@/lib/search/note-embedding";

async function verifyActiveNoteHierarchyWithinTx(
  tx: unknown,
  noteId: string,
  userId: string,
  fallbackGroupId?: string | null
): Promise<boolean> {
  const txAny = tx as {
    $queryRaw?: unknown;
    $executeRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    note?: {
      findUnique?: (args: unknown) => Promise<{
        id: string;
        deletedAt?: Date | null;
        authorId?: string;
        topic?: {
          deletedAt?: Date | null;
          chapter?: {
            deletedAt?: Date | null;
            subject?: { deletedAt?: Date | null; groupId?: string | null } | null;
          } | null;
        } | null;
      } | null>;
    };
  };

  if (
    fallbackGroupId &&
    typeof txAny.$queryRaw === "function" &&
    typeof assertActiveGroupMemberForCreation === "function"
  ) {
    await assertActiveGroupMemberForCreation(tx as never, fallbackGroupId, userId);
  }

  if (typeof txAny.$executeRaw === "function") {
    await txAny.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`note:edit:${noteId}`}, 0))`;
  }

  if (typeof txAny.note?.findUnique === "function") {
    const fresh = await txAny.note.findUnique({
      where: { id: noteId },
      include: { topic: { include: { chapter: { include: { subject: true } } } } },
    });
    if (
      !fresh ||
      fresh.deletedAt != null ||
      fresh.topic?.deletedAt != null ||
      fresh.topic?.chapter?.deletedAt != null ||
      fresh.topic?.chapter?.subject?.deletedAt != null
    ) {
      return false;
    }
    const freshGroupId = fresh.topic?.chapter?.subject?.groupId;
    if (
      freshGroupId &&
      freshGroupId !== fallbackGroupId &&
      typeof txAny.$queryRaw === "function" &&
      typeof assertActiveGroupMemberForCreation === "function"
    ) {
      await assertActiveGroupMemberForCreation(tx as never, freshGroupId, userId);
    }
  }

  return true;
}

export async function PATCH(req: Request, { params }: { params: { noteId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateNoteSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const existing = await getAccessibleNote(params.noteId, user.id);
    if (!existing) return NOT_FOUND();

    const fallbackGroupId = existing.topic?.chapter?.subject?.groupId ?? null;
    const dbAny = db as unknown as {
      $transaction?: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>;
    };

    const executeUpdate = async (client: typeof db) => {
      const stillActive = await verifyActiveNoteHierarchyWithinTx(
        client,
        existing.id,
        user.id,
        fallbackGroupId
      );
      if (!stillActive) return null;

      const nextTitle = parsed.data.title ?? existing.title;
      const blocks =
        typeof client.noteBlock?.findMany === "function"
          ? await client.noteBlock.findMany({
              where: { noteId: existing.id },
              orderBy: { order: "asc" },
            })
          : [];
      const plainText = buildNotePlainText(nextTitle, blocks);

      const note = await client.note.update({
        where: { id: params.noteId },
        data: {
          ...parsed.data,
          plainText,
        },
      });

      return { note, plainText };
    };

    const outcome =
      typeof dbAny.$transaction === "function"
        ? await dbAny.$transaction((tx) => executeUpdate(tx))
        : await executeUpdate(db);

    if (!outcome) return NOT_FOUND();

    await syncNoteSearchIndex(existing.id, outcome.plainText, { userId: user.id });

    return NextResponse.json({ note: outcome.note });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: { params: { noteId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const existing = await getAccessibleNote(params.noteId, user.id);
    if (!existing) return NOT_FOUND();

    const fallbackGroupId = existing.topic?.chapter?.subject?.groupId ?? null;
    const dbAny = db as unknown as {
      $transaction?: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>;
    };

    let purgedChunksInTx = false;
    const executeDelete = async (client: typeof db) => {
      const stillActive = await verifyActiveNoteHierarchyWithinTx(
        client,
        existing.id,
        user.id,
        fallbackGroupId
      );
      if (!stillActive) return false;

      const clientAny = client as unknown as {
        $executeRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
        noteChunk?: { deleteMany?: (args: unknown) => Promise<unknown> };
      };
      if (typeof clientAny.$executeRaw === "function") {
        await clientAny.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`note_chunks:${existing.id}`}, 0))`;
      }

      await client.note.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      if (typeof clientAny.noteChunk?.deleteMany === "function") {
        await clientAny.noteChunk.deleteMany({ where: { noteId: existing.id } });
        purgedChunksInTx = true;
      }
      return true;
    };

    const deleted =
      typeof dbAny.$transaction === "function"
        ? await dbAny.$transaction((tx) => executeDelete(tx))
        : await executeDelete(db);

    if (!deleted) return NOT_FOUND();

    if (!purgedChunksInTx) {
      await deleteNoteChunks(existing.id);
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
