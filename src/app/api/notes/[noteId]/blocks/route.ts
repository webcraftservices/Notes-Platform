import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getAccessibleNote,
  assertActiveGroupMemberForCreation,
  NotAuthorizedError,
} from "@/lib/access";
import { saveBlocksSchema } from "@/lib/validation/notes";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { buildNotePlainText } from "@/lib/search/tiptap-text";
import { syncNoteSearchIndex } from "@/lib/search/note-embedding";

const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000; // at most one automatic snapshot per 10 minutes

const SERVER_OWNED_PROVENANCE_KEYS = [
  "materialId",
  "materialTitle",
  "materialType",
  "sourceUnitType",
  "sourcePages",
  "pageNumber",
] as const;

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
    const plainText = buildNotePlainText(note.title, incoming);

    const fallbackGroupId = note.topic?.chapter?.subject?.groupId ?? null;
    const outcome = await db.$transaction(async (tx) => {
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
          return null;
        }
      }

      const existingBlocks = await tx.noteBlock.findMany({
        where: { noteId: note.id },
        orderBy: { order: "asc" },
      });
      const existingMap = new Map(existingBlocks.map((b) => [b.id, b]));

      const toUpdate = incoming.filter((b) => existingMap.has(b.id));
      const toCreate = incoming.filter((b) => !existingMap.has(b.id));
      const keepIds = new Set(toUpdate.map((b) => b.id));

      const lastVersion = await tx.noteVersion.findFirst({
        where: { noteId: note.id },
        orderBy: { createdAt: "desc" },
      });
      const shouldSnapshot =
        explicit || !lastVersion || Date.now() - lastVersion.createdAt.getTime() > AUTO_VERSION_INTERVAL_MS;

      if (shouldSnapshot && existingBlocks.length > 0) {
        await tx.noteVersion.create({
          data: { noteId: note.id, editedById: user.id, snapshot: existingBlocks as unknown as object },
        });
      }

      await tx.noteBlock.deleteMany({ where: { noteId: note.id, id: { notIn: [...keepIds] } } });

      for (const block of toUpdate) {
        const existing = existingMap.get(block.id);
        const existingMeta =
          existing?.metadata && typeof existing.metadata === "object"
            ? (existing.metadata as Record<string, unknown>)
            : null;
        const incomingMeta =
          block.metadata && typeof block.metadata === "object"
            ? (block.metadata as Record<string, unknown>)
            : null;

        // Preserve trusted server-owned provenance from the database
        const trustedProvenance: Record<string, unknown> = {};
        if (existingMeta) {
          for (const key of SERVER_OWNED_PROVENANCE_KEYS) {
            if (key in existingMeta) {
              trustedProvenance[key] = existingMeta[key];
            }
          }
        }

        // Allow non-provenance client metadata, but strip server-owned keys from client input
        const cleanIncoming = incomingMeta ? { ...incomingMeta } : {};
        for (const key of SERVER_OWNED_PROVENANCE_KEYS) {
          delete cleanIncoming[key];
        }

        const mergedMetadata = { ...cleanIncoming, ...trustedProvenance };
        const finalUpdateMeta =
          Object.keys(mergedMetadata).length > 0
            ? (mergedMetadata as Prisma.InputJsonValue)
            : existingMeta
            ? Prisma.DbNull
            : undefined;

        await tx.noteBlock.update({
          where: { id: block.id },
          data: {
            kind: block.kind,
            heading: block.heading || null,
            content: block.content,
            order: block.order,
            metadata: finalUpdateMeta,
          },
        });
      }

      for (const block of toCreate) {
        const incomingMeta =
          block.metadata && typeof block.metadata === "object"
            ? (block.metadata as Record<string, unknown>)
            : null;
        let finalCreateMeta: Prisma.InputJsonValue | undefined = undefined;
        if (incomingMeta) {
          const clean = { ...incomingMeta };
          for (const key of SERVER_OWNED_PROVENANCE_KEYS) {
            delete clean[key];
          }
          if (Object.keys(clean).length > 0) {
            finalCreateMeta = clean as Prisma.InputJsonValue;
          }
        }

        await tx.noteBlock.create({
          data: {
            noteId: note.id,
            kind: block.kind,
            heading: block.heading || null,
            content: block.content,
            order: block.order,
            metadata: finalCreateMeta,
          },
        });
      }

      await tx.note.update({ where: { id: note.id }, data: { plainText } });
      if (note.topicId) {
        await tx.topic.update({ where: { id: note.topicId }, data: {} });
      }

      return { versioned: shouldSnapshot && existingBlocks.length > 0 };
    });

    if (!outcome) return NOT_FOUND();
    const { versioned } = outcome;

    await syncNoteSearchIndex(note.id, plainText, { userId: user.id });

    const saved = await db.noteBlock.findMany({ where: { noteId: note.id }, orderBy: { order: "asc" } });

    return NextResponse.json({ blocks: saved, versioned });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
