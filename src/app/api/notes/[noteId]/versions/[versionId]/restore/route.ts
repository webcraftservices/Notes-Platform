import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleNote,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, jsonError } from "@/lib/api-response";
import { buildNotePlainText } from "@/lib/search/tiptap-text";
import { syncNoteSearchIndex } from "@/lib/search/note-embedding";

interface SnapshotBlock {
  id: string;
  kind: string;
  heading: string | null;
  content: unknown;
  order: number;
  metadata?: unknown;
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

    const plainText = buildNotePlainText(note.title ?? "", snapshotBlocks);

    const fallbackGroupId = note.topic?.chapter?.subject?.groupId ?? null;
    const restored = await db.$transaction(async (tx) => {
      const txAny = tx as unknown as {
        $queryRaw?: unknown;
        $executeRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
        note?: {
          findUnique?: (args: unknown) => Promise<{
            id: string;
            deletedAt?: Date | null;
            topic?: {
              deletedAt?: Date | null;
              chapter?: {
                deletedAt?: Date | null;
                subject?: { deletedAt?: Date | null; groupId?: string | null } | null;
              } | null;
            } | null;
          } | null>;
          update?: (args: unknown) => Promise<unknown>;
        };
      };

      if (
        fallbackGroupId &&
        typeof txAny.$queryRaw === "function" &&
        typeof assertActiveGroupMemberForCreation === "function"
      ) {
        await assertActiveGroupMemberForCreation(tx, fallbackGroupId, user.id);
      }

      if (typeof txAny.$executeRaw === "function") {
        await txAny.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`note:edit:${note.id}`}, 0))`;
      }

      if (typeof txAny.note?.findUnique === "function") {
        const fresh = await txAny.note.findUnique({
          where: { id: note.id },
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
      }

      const currentBlocks = await tx.noteBlock.findMany({ where: { noteId: note.id } });
      if (currentBlocks.length > 0) {
        await tx.noteVersion.create({
          data: { noteId: note.id, editedById: user.id, snapshot: currentBlocks as unknown as object },
        });
      }

      await tx.noteBlock.deleteMany({ where: { noteId: note.id } });

      for (const block of snapshotBlocks) {
        await tx.noteBlock.create({
          data: {
            noteId: note.id,
            kind: block.kind as never,
            heading: block.heading,
            content: block.content as object,
            order: block.order,
            metadata: (block.metadata as Prisma.InputJsonValue) ?? undefined,
          },
        });
      }

      if (typeof tx.note?.update === "function") {
        await tx.note.update({ where: { id: note.id }, data: { plainText } });
      }
      return true;
    });

    if (!restored) return NOT_FOUND();

    await syncNoteSearchIndex(note.id, plainText, { userId: user.id });

    const blocks = await db.noteBlock.findMany({ where: { noteId: note.id }, orderBy: { order: "asc" } });
    return NextResponse.json({ blocks });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
