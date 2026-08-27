import { db } from "@/lib/db";
import type { Topic } from "@prisma/client";

/**
 * Phase 3 keeps the UI to one note per topic — the schema (Note.topicId is
 * a plain nullable FK, not unique) technically allows several, which
 * later phases can expose if needed, but a single get-or-create note per
 * topic is the simplest thing that satisfies "every topic has notes"
 * without adding a notes-list UI this phase doesn't need yet.
 *
 * Extracted from the GET /api/topics/[topicId]/note route in Phase 5 so
 * the AI note-generation job (lib/note-generation.ts) can reuse the exact
 * same get-or-create behavior instead of re-implementing it — see
 * CLAUDE.md's "every new Prisma model access pattern" rule.
 */
export async function getOrCreateTopicNote(topic: Pick<Topic, "id" | "name">, userId: string) {
  let note = await db.note.findFirst({
    where: { topicId: topic.id, deletedAt: null },
    include: { blocks: { orderBy: { order: "asc" } } },
  });

  if (!note) {
    note = await db.note.create({
      data: { topicId: topic.id, authorId: userId, title: topic.name, source: "MANUAL" },
      include: { blocks: { orderBy: { order: "asc" } } },
    });
  }

  return note;
}
