import { db } from "@/lib/db";
import type { Prisma, Topic } from "@prisma/client";
import {
  assertActiveGroupMemberForCreation,
  lockGroupForShare,
  NotAuthorizedError,
} from "@/lib/access";
import { buildNotePlainText } from "@/lib/search/tiptap-text";
import { syncNoteSearchIndex } from "@/lib/search/note-embedding";

export interface GetOrCreateTopicNoteOptions {
  tx?: Prisma.TransactionClient;
  deferIndexSync?: boolean;
}

type TopicWithOptionalAncestors = Pick<Topic, "id" | "name"> & {
  deletedAt?: Date | null;
  chapter?: {
    deletedAt?: Date | null;
    subject?: {
      deletedAt?: Date | null;
      groupId?: string | null;
    } | null;
  } | null;
};

async function runGetOrCreateInClient(
  client: Prisma.TransactionClient | typeof db,
  topic: TopicWithOptionalAncestors,
  userId: string
) {
  const lockable = client as unknown as {
    $executeRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    $queryRaw?: unknown;
    groupMember?: {
      findFirst?: (args: unknown) => Promise<unknown>;
    };
    topic?: {
      findUnique?: (args: unknown) => Promise<TopicWithOptionalAncestors | null>;
    };
  };

  let resolvedGroupId: string | null = topic.chapter?.subject?.groupId ?? null;
  if (typeof lockable.topic?.findUnique === "function") {
    const liveTopic = await lockable.topic.findUnique({
      where: { id: topic.id, deletedAt: null },
      include: { chapter: { include: { subject: true } } },
    });
    if (
      !liveTopic ||
      liveTopic.deletedAt != null ||
      liveTopic.chapter?.deletedAt != null ||
      liveTopic.chapter?.subject?.deletedAt != null
    ) {
      throw new NotAuthorizedError();
    }
    resolvedGroupId = liveTopic.chapter?.subject?.groupId ?? resolvedGroupId;
  }

  // Acquire Group FOR SHARE (and revalidate active group membership when available)
  // BEFORE the per-topic advisory lock to enforce top-down lock ordering (Group -> Topic).
  if (resolvedGroupId && typeof lockable.$queryRaw === "function") {
    if (
      typeof assertActiveGroupMemberForCreation === "function" &&
      typeof lockable.groupMember?.findFirst === "function"
    ) {
      await assertActiveGroupMemberForCreation(
        client as Prisma.TransactionClient,
        resolvedGroupId,
        userId
      );
    } else {
      const lockedGroup = await lockGroupForShare(
        client as Prisma.TransactionClient,
        resolvedGroupId
      );
      if (!lockedGroup || lockedGroup.deletedAt !== null) {
        throw new NotAuthorizedError();
      }
    }
  }

  if (typeof lockable.$executeRaw === "function") {
    await lockable.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`note:topic:${topic.id}`}, 0))`;
  }

  // Re-verify active hierarchy after lock acquisition in case a parent Subject/Chapter/Topic
  // was soft-deleted concurrently while waiting on the lock.
  if (typeof lockable.topic?.findUnique === "function") {
    const verifiedTopic = await lockable.topic.findUnique({
      where: { id: topic.id, deletedAt: null },
      include: { chapter: { include: { subject: true } } },
    });
    if (
      !verifiedTopic ||
      verifiedTopic.deletedAt != null ||
      verifiedTopic.chapter?.deletedAt != null ||
      verifiedTopic.chapter?.subject?.deletedAt != null
    ) {
      throw new NotAuthorizedError();
    }
  }

  let note = await client.note.findFirst({
    where: { topicId: topic.id, deletedAt: null },
    include: { blocks: { orderBy: { order: "asc" } } },
  });
  let created = false;

  if (!note) {
    const plainText = buildNotePlainText(topic.name, []);
    note = await client.note.create({
      data: { topicId: topic.id, authorId: userId, title: topic.name, plainText, source: "MANUAL" },
      include: { blocks: { orderBy: { order: "asc" } } },
    });
    created = true;
  }

  return { note, created };
}

/**
 * Phase 3 keeps the UI to one note per topic — serialized via a Postgres
 * transaction-scoped advisory lock (`note:topic:${topic.id}`) so concurrent
 * GET /api/topics/[topicId]/note or worker jobs never create duplicate notes
 * for the same Topic.
 *
 * When the Topic belongs to a Group, also acquires `FOR SHARE` on the parent
 * Group row (and verifies active group membership) before the per-topic advisory
 * lock, and verifies that the Topic/Chapter/Subject/Group hierarchy is still
 * active (`deletedAt === null`) inside the transaction so concurrent
 * `DELETE /api/groups/[groupId]` cannot leave behind an active `Note`.
 */
export async function getOrCreateTopicNote(
  topic: TopicWithOptionalAncestors,
  userId: string,
  options?: GetOrCreateTopicNoteOptions
) {
  if (options?.tx) {
    const { note, created } = await runGetOrCreateInClient(options.tx, topic, userId);
    if (created && note?.id && !options.deferIndexSync) {
      await syncNoteSearchIndex(note.id, note.plainText ?? buildNotePlainText(topic.name, []), {
        userId,
      });
    }
    return note;
  }

  const dbWithTx = db as unknown as {
    $transaction?: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  };
  const { note, created } =
    typeof dbWithTx.$transaction === "function"
      ? await dbWithTx.$transaction((tx) => runGetOrCreateInClient(tx, topic, userId))
      : await runGetOrCreateInClient(db, topic, userId);

  if (created && note?.id && !options?.deferIndexSync) {
    await syncNoteSearchIndex(note.id, note.plainText ?? buildNotePlainText(topic.name, []), {
      userId,
    });
  }

  return note;
}
