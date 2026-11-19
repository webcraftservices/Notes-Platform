import type { Prisma } from "@prisma/client";
import { getAccessibleSubject, getAccessibleChapter, getAccessibleTopic } from "@/lib/access";
import { resolveSubjectOwner } from "@/lib/subject-scope";

export interface MaterialScope {
  workspaceId: string | null;
  groupId: string | null;
  subjectId: string | null;
  chapterId: string | null;
  topicId: string | null;
}

/**
 * Re-verifies inside an active transaction that any hierarchy attachment
 * (`topicId`, `chapterId`, or `subjectId`) and its parent chain are still
 * non-deleted (`deletedAt === null`). Prevents attaching a new Material
 * to a Topic, Chapter, or Subject that was soft-deleted concurrently
 * between `resolveMaterialScope()` and the `db.$transaction` commit.
 */
export async function assertActiveHierarchyScopeWithinTx(
  tx: Prisma.TransactionClient,
  scope: Pick<MaterialScope, "subjectId" | "chapterId" | "topicId">
): Promise<void> {
  const txHierarchy = tx as unknown as {
    topic?: {
      findUnique?: (args: unknown) => Promise<{
        id: string;
        deletedAt?: Date | null;
        chapter?: {
          deletedAt?: Date | null;
          subject?: { deletedAt?: Date | null } | null;
        } | null;
      } | null>;
    };
    chapter?: {
      findUnique?: (args: unknown) => Promise<{
        id: string;
        deletedAt?: Date | null;
        subject?: { deletedAt?: Date | null } | null;
      } | null>;
    };
    subject?: {
      findUnique?: (args: unknown) => Promise<{
        id: string;
        deletedAt?: Date | null;
      } | null>;
    };
  };

  if (scope.topicId && typeof txHierarchy.topic?.findUnique === "function") {
    const topic = await txHierarchy.topic.findUnique({
      where: { id: scope.topicId, deletedAt: null },
      include: { chapter: { include: { subject: true } } },
    });
    if (
      !topic ||
      topic.deletedAt != null ||
      topic.chapter?.deletedAt != null ||
      topic.chapter?.subject?.deletedAt != null
    ) {
      throw new ScopeNotFoundError("topic");
    }
    return;
  }

  if (scope.chapterId && typeof txHierarchy.chapter?.findUnique === "function") {
    const chapter = await txHierarchy.chapter.findUnique({
      where: { id: scope.chapterId, deletedAt: null },
      include: { subject: true },
    });
    if (!chapter || chapter.deletedAt != null || chapter.subject?.deletedAt != null) {
      throw new ScopeNotFoundError("chapter");
    }
    return;
  }

  if (scope.subjectId && typeof txHierarchy.subject?.findUnique === "function") {
    const subject = await txHierarchy.subject.findUnique({
      where: { id: scope.subjectId, deletedAt: null },
    });
    if (!subject || subject.deletedAt != null) {
      throw new ScopeNotFoundError("subject");
    }
  }
}

/**
 * A Material's owner (workspace vs group) always follows the owner of the
 * Subject/Chapter/Topic it's attached to — a Material can't have its own
 * independent scope, so this must never be passed in by the caller. This
 * mirrors `lib/subject-scope.ts`'s `resolveSubjectOwner`: exactly one of
 * workspaceId/groupId is non-null, never both, never neither (Phase 6.4).
 *
 * A Material with no subject/chapter/topic attachment ("Unorganized")
 * falls back to the caller's own personal workspace — there is no
 * equivalent "Unorganized within a Group" home in this phase, since group
 * materials only exist by being attached under a Group Subject.
 *
 * Passing a topicId derives its chapter/subject automatically rather than
 * trusting three independently-supplied IDs to agree — mismatched IDs
 * from a client would otherwise silently attach a material to the wrong
 * subject (or the wrong owner).
 *
 * Throws NotAuthorizedError (via the underlying getAccessible* helpers) if
 * the user can't reach the requested subject/chapter/topic — this is also
 * what keeps cross-group attachment impossible: a user who isn't a member
 * of the owning group can't resolve a scope for one of its subjects at
 * all.
 */
export async function resolveMaterialScope(
  input: { subjectId?: string; chapterId?: string; topicId?: string },
  userId: string,
  workspaceId: string
): Promise<MaterialScope> {
  if (input.topicId) {
    const topic = await getAccessibleTopic(input.topicId, userId);
    if (!topic) throw new ScopeNotFoundError("topic");
    const owner = resolveSubjectOwner(topic.chapter.subject);
    return {
      workspaceId: owner.workspaceId,
      groupId: owner.groupId,
      subjectId: topic.chapter.subjectId,
      chapterId: topic.chapterId,
      topicId: topic.id,
    };
  }

  if (input.chapterId) {
    const chapter = await getAccessibleChapter(input.chapterId, userId);
    if (!chapter) throw new ScopeNotFoundError("chapter");
    const owner = resolveSubjectOwner(chapter.subject);
    return {
      workspaceId: owner.workspaceId,
      groupId: owner.groupId,
      subjectId: chapter.subjectId,
      chapterId: chapter.id,
      topicId: null,
    };
  }

  if (input.subjectId) {
    const subject = await getAccessibleSubject(input.subjectId, userId);
    if (!subject) throw new ScopeNotFoundError("subject");
    const owner = resolveSubjectOwner(subject);
    return {
      workspaceId: owner.workspaceId,
      groupId: owner.groupId,
      subjectId: subject.id,
      chapterId: null,
      topicId: null,
    };
  }

  return { workspaceId, groupId: null, subjectId: null, chapterId: null, topicId: null };
}

export class ScopeNotFoundError extends Error {
  constructor(public readonly kind: "subject" | "chapter" | "topic") {
    super(`${kind} not found or not accessible`);
  }
}
