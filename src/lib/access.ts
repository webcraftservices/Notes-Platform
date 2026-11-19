import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import type { MemberRole, Prisma, GroupMember } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { roleMeetsMinimum } from "@/lib/group-role";
import { assertSubjectScopeInvariant, resolveSubjectOwner, SubjectScopeInvariantError } from "@/lib/subject-scope";

// Re-exported so Phase 6.4+ Subject create/update routes can import the
// scope invariant from the same place they already import everything else
// access-related, without needing to know it physically lives in its own
// pure/testable file — see lib/subject-scope.ts for why it's split out.
export { assertSubjectScopeInvariant, SubjectScopeInvariantError };

/**
 * Every data-access check in the app funnels through this file. Route
 * handlers and server components should never write their own `where`
 * clause for "does this user own/belong-to X" — call the matching
 * assert-or-get helper here instead, so the access rule only exists once.
 *
 * Resources resolve access through exactly one of two paths:
 *   - Workspace membership (personal content)
 *   - Group membership (shared content) — added in Phase 6, the `groupId`
 *     branch below is already wired so Phase 6 doesn't have to touch these.
 */

export class NotAuthorizedError extends Error {
  constructor() {
    super("Not authorized");
    this.name = "NotAuthorizedError";
  }
}

/** For server components. Redirects to sign-in if there's no session. */
export async function requireUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/sign-in");
  return session.user;
}

/** For route handlers. Returns null instead of redirecting. */
export async function getSessionUser() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ? session.user : null;
}

/**
 * Each user currently has exactly one personal workspace (created at
 * signup). Workspace switching / multiple workspaces per user is not a
 * Phase 2 feature — this helper is the single place that assumption lives,
 * so relaxing it later is a one-file change.
 */
export async function getPrimaryWorkspace(userId: string) {
  const membership = await db.workspaceMember.findFirst({
    where: { userId },
    include: { workspace: true },
    orderBy: { joinedAt: "asc" },
  });
  if (!membership) {
    throw new Error(
      `User ${userId} has no workspace. Every account should get one at signup — check auth.ts events.createUser.`
    );
  }
  return membership.workspace;
}

async function userIsWorkspaceMember(workspaceId: string, userId: string) {
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  return !!membership;
}

export async function userIsGroupMember(groupId: string, userId: string) {
  const membership = await db.groupMember.findFirst({
    where: {
      groupId,
      userId,
      group: { deletedAt: null },
    },
    select: { id: true },
  });
  return !!membership;
}

export type LockedGroupRecord = {
  id: string;
  deletedAt: Date | null;
};

export type LockedGroupMemberRecord = GroupMember;

export type LockedGroupInvitationRecord = {
  id: string;
  groupId: string;
  email: string;
  role: MemberRole;
  status: string;
  token: string;
  expiresAt: Date;
};

/**
 * Acquires a row-level FOR SHARE lock on the parent Group within a transaction.
 * Serializes resource creation against concurrent group deletion under PostgreSQL READ COMMITTED.
 *
 * Conflict semantics:
 * - FOR SHARE is compatible with concurrent FOR SHARE locks (multiple resource creations do not block each other).
 * - FOR SHARE conflicts with FOR UPDATE and FOR NO KEY UPDATE (group deletion update).
 * - If resource creation acquires FOR SHARE first, deletion waits until resource creation commits.
 * - If deletion acquires its lock first, resource creation waits until deletion commits, then observes deletedAt !== null and aborts.
 */
export async function lockGroupForShare(
  tx: Prisma.TransactionClient,
  groupId: string
): Promise<LockedGroupRecord | null> {
  if (typeof tx?.$queryRaw !== "function") {
    throw new Error("Transaction client does not support raw query locking (tx.$queryRaw is missing).");
  }
  const rows = await tx.$queryRaw<LockedGroupRecord[]>`
    SELECT id, "deletedAt" FROM "Group" WHERE id = ${groupId} FOR SHARE
  `;
  return rows[0] ?? null;
}

/**
 * Acquires an exclusive row-level FOR UPDATE lock on the Group within a transaction.
 * Used at the start of group deletion to ensure no concurrent resource creations can slip past.
 */
export async function lockGroupForUpdate(
  tx: Prisma.TransactionClient,
  groupId: string
): Promise<LockedGroupRecord | null> {
  if (typeof tx?.$queryRaw !== "function") {
    throw new Error("Transaction client does not support raw query locking (tx.$queryRaw is missing).");
  }
  const rows = await tx.$queryRaw<LockedGroupRecord[]>`
    SELECT id, "deletedAt" FROM "Group" WHERE id = ${groupId} FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * Acquires a row-level FOR SHARE lock on a single GroupMember row within a transaction
 * so concurrent role demotion/removal (`FOR UPDATE`) serializes cleanly under READ COMMITTED.
 */
export async function lockGroupMemberForShare(
  tx: Prisma.TransactionClient,
  groupId: string,
  userId: string
): Promise<LockedGroupMemberRecord | null> {
  if (typeof tx?.$queryRaw !== "function") {
    throw new Error("Transaction client does not support raw query locking (tx.$queryRaw is missing).");
  }
  const rows = await tx.$queryRaw<LockedGroupMemberRecord[]>`
    SELECT id, "groupId", "userId", role, "joinedAt"
    FROM "GroupMember"
    WHERE "groupId" = ${groupId} AND "userId" = ${userId}
    FOR SHARE
  `;
  return rows[0] ?? null;
}

/**
 * Acquires exclusive FOR UPDATE locks on GroupMember rows in canonical ascending `userId` order.
 * Sorting IDs before acquiring row locks guarantees AB-BA deadlock freedom when two concurrent
 * admins attempt mutually overlapping role/removal mutations.
 */
export async function lockGroupMembersForUpdate(
  tx: Prisma.TransactionClient,
  groupId: string,
  userIds: string[]
): Promise<LockedGroupMemberRecord[]> {
  if (typeof tx?.$queryRaw !== "function") {
    throw new Error("Transaction client does not support raw query locking (tx.$queryRaw is missing).");
  }
  const sortedUniqueUserIds = [...new Set(userIds.filter((id) => Boolean(id && id.trim())))].sort();
  const locked: LockedGroupMemberRecord[] = [];
  for (const uid of sortedUniqueUserIds) {
    const rows = await tx.$queryRaw<LockedGroupMemberRecord[]>`
      SELECT id, "groupId", "userId", role, "joinedAt"
      FROM "GroupMember"
      WHERE "groupId" = ${groupId} AND "userId" = ${uid}
      FOR UPDATE
    `;
    if (rows[0]) {
      locked.push(rows[0]);
    }
  }
  return locked;
}

/**
 * Acquires an exclusive FOR UPDATE lock on a GroupInvitation row by `id` or `token`.
 */
export async function lockGroupInvitationForUpdate(
  tx: Prisma.TransactionClient,
  selector: { id: string } | { token: string }
): Promise<LockedGroupInvitationRecord | null> {
  if (typeof tx?.$queryRaw !== "function") {
    throw new Error("Transaction client does not support raw query locking (tx.$queryRaw is missing).");
  }
  const rows =
    "id" in selector
      ? await tx.$queryRaw<LockedGroupInvitationRecord[]>`
          SELECT id, "groupId", email, role, status, token, "expiresAt"
          FROM "GroupInvitation"
          WHERE id = ${selector.id}
          FOR UPDATE
        `
      : await tx.$queryRaw<LockedGroupInvitationRecord[]>`
          SELECT id, "groupId", email, role, status, token, "expiresAt"
          FROM "GroupInvitation"
          WHERE token = ${selector.token}
          FOR UPDATE
        `;
  return rows[0] ?? null;
}

/**
 * Validates that a user is an active member of a group and holds serialization locks (FOR SHARE)
 * on both the parent Group row and the caller's GroupMember row until the transaction commits.
 * Lock order is strictly top-down: `"Group" FOR SHARE` -> `"GroupMember" FOR SHARE`.
 */
export async function assertActiveGroupMemberForCreation(
  tx: Prisma.TransactionClient,
  groupId: string,
  userId: string,
  allowedRoles?: MemberRole[]
): Promise<GroupMember> {
  const group = await lockGroupForShare(tx, groupId);
  if (!group || group.deletedAt !== null) {
    throw new NotAuthorizedError();
  }

  const member = await lockGroupMemberForShare(tx, groupId, userId);
  if (!member) {
    throw new NotAuthorizedError();
  }
  if (allowedRoles && !allowedRoles.includes(member.role)) {
    throw new NotAuthorizedError();
  }
  return member;
}

/** Throws NotAuthorizedError if the user can't reach this workspace OR (if set) group. */
async function assertScopeAccess(
  userId: string,
  scope: { workspaceId: string | null; groupId: string | null }
) {
  if (scope.groupId) {
    if (await userIsGroupMember(scope.groupId, userId)) return;
  }
  if (scope.workspaceId) {
    if (await userIsWorkspaceMember(scope.workspaceId, userId)) return;
  }
  throw new NotAuthorizedError();
}

export async function getAccessibleSubject(subjectId: string, userId: string) {
  const subject = await db.subject.findUnique({
    where: { id: subjectId, deletedAt: null },
  });
  if (!subject) return null;
  await assertScopeAccess(userId, { workspaceId: subject.workspaceId, groupId: subject.groupId });
  return subject;
}

export async function getAccessibleChapter(chapterId: string, userId: string) {
  const chapter = await db.chapter.findUnique({
    where: { id: chapterId, deletedAt: null },
    include: { subject: true },
  });
  if (!chapter || chapter.subject?.deletedAt != null) return null;
  await assertScopeAccess(userId, {
    workspaceId: chapter.subject.workspaceId,
    groupId: chapter.subject.groupId,
  });
  return chapter;
}

export async function getAccessibleTopic(topicId: string, userId: string) {
  const topic = await db.topic.findUnique({
    where: { id: topicId, deletedAt: null },
    include: { chapter: { include: { subject: true } } },
  });
  if (
    !topic ||
    topic.chapter?.deletedAt != null ||
    topic.chapter?.subject?.deletedAt != null
  ) {
    return null;
  }
  await assertScopeAccess(userId, {
    workspaceId: topic.chapter.subject.workspaceId,
    groupId: topic.chapter.subject.groupId,
  });
  return topic;
}

/**
 * Materials resolve access differently from the Subject/Chapter/Topic tree:
 * every Material has its own ownerId plus an optional attachment point
 * (workspace/subject/chapter/topic/group). The owner can always reach it;
 * beyond that, access follows whichever scope it's attached to — same
 * workspace/group membership rule as everything else.
 */
export async function getAccessibleMaterial(materialId: string, userId: string) {
  const material = await db.material.findUnique({
    where: { id: materialId, deletedAt: null },
  });
  if (!material) return null;

  if (material.groupId) {
    if (await userIsGroupMember(material.groupId, userId)) return material;
    throw new NotAuthorizedError();
  }

  if (material.ownerId === userId) return material;
  if (material.workspaceId) {
    if (await userIsWorkspaceMember(material.workspaceId, userId)) return material;
  }
  throw new NotAuthorizedError();
}

function hasSoftDeletedLearningAncestor(resource: {
  group?: { deletedAt: Date | null } | null;
  subject?: { deletedAt: Date | null } | null;
  chapter?: { deletedAt: Date | null; subject?: { deletedAt: Date | null } | null } | null;
  topic?: {
    deletedAt: Date | null;
    chapter?: { deletedAt: Date | null; subject?: { deletedAt: Date | null } | null } | null;
  } | null;
}): boolean {
  return (
    resource.group?.deletedAt != null ||
    resource.subject?.deletedAt != null ||
    resource.chapter?.deletedAt != null ||
    resource.chapter?.subject?.deletedAt != null ||
    resource.topic?.deletedAt != null ||
    resource.topic?.chapter?.deletedAt != null ||
    resource.topic?.chapter?.subject?.deletedAt != null
  );
}

/**
 * FlashcardDeck/Quiz (Phase 8.1) reuse Material's exact scope shape — see
 * the schema block comment above FlashcardDeck — so access resolves the
 * same way: the owner can always reach their own deck/quiz, otherwise
 * access follows whichever workspace/group it's attached to.
 *
 * Also fails closed (returns null) if any attached hierarchy ancestor
 * (Group, Subject, Chapter, or Topic) has been soft-deleted (`deletedAt != null`),
 * matching `buildActiveDeckAncestorFilter` in `src/lib/srs/due-service.ts`.
 */
export async function getAccessibleFlashcardDeck(deckId: string, userId: string) {
  const deck = await db.flashcardDeck.findUnique({
    where: { id: deckId },
    include: {
      group: { select: { deletedAt: true } },
      subject: { select: { deletedAt: true } },
      chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
      topic: {
        select: {
          deletedAt: true,
          chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
        },
      },
    },
  });
  if (!deck) return null;
  if (hasSoftDeletedLearningAncestor(deck)) return null;

  const {
    group: _group,
    subject: _subject,
    chapter: _chapter,
    topic: _topic,
    ...cleanDeck
  } = deck as typeof deck & {
    group?: unknown;
    subject?: unknown;
    chapter?: unknown;
    topic?: unknown;
  };

  if (cleanDeck.groupId) {
    if (await userIsGroupMember(cleanDeck.groupId, userId)) return cleanDeck;
    throw new NotAuthorizedError();
  }

  if (cleanDeck.ownerId === userId) return cleanDeck;
  if (cleanDeck.workspaceId) {
    if (await userIsWorkspaceMember(cleanDeck.workspaceId, userId)) return cleanDeck;
  }
  throw new NotAuthorizedError();
}

export async function getAccessibleQuiz(quizId: string, userId: string) {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    include: {
      group: { select: { deletedAt: true } },
      subject: { select: { deletedAt: true } },
      chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
      topic: {
        select: {
          deletedAt: true,
          chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
        },
      },
    },
  });
  if (!quiz) return null;
  if (hasSoftDeletedLearningAncestor(quiz)) return null;

  const {
    group: _group,
    subject: _subject,
    chapter: _chapter,
    topic: _topic,
    ...cleanQuiz
  } = quiz as typeof quiz & {
    group?: unknown;
    subject?: unknown;
    chapter?: unknown;
    topic?: unknown;
  };

  if (cleanQuiz.groupId) {
    if (await userIsGroupMember(cleanQuiz.groupId, userId)) return cleanQuiz;
    throw new NotAuthorizedError();
  }

  if (cleanQuiz.ownerId === userId) return cleanQuiz;
  if (cleanQuiz.workspaceId) {
    if (await userIsWorkspaceMember(cleanQuiz.workspaceId, userId)) return cleanQuiz;
  }
  throw new NotAuthorizedError();
}

export async function getAccessibleMaterialByStorageKey(storageKey: string, userId: string) {
  const material = await db.material.findFirst({
    where: { storageKey, deletedAt: null },
  });
  if (!material) return null;

  if (material.groupId) {
    if (await userIsGroupMember(material.groupId, userId)) return material;
    throw new NotAuthorizedError();
  }

  if (material.ownerId === userId) return material;
  if (material.workspaceId) {
    if (await userIsWorkspaceMember(material.workspaceId, userId)) return material;
  }
  throw new NotAuthorizedError();
}

/**
 * A Note's access follows the Topic it's attached to. Phase 3's UI only
 * creates notes tied to a topic (see /api/topics/[topicId]/note), but the
 * schema allows a standalone note (topicId null), so the author-owns
 * fallback keeps that path safe too even though nothing exposes it yet.
 */
export async function getAccessibleNote(noteId: string, userId: string) {
  const note = await db.note.findUnique({
    where: { id: noteId, deletedAt: null },
    include: { topic: { include: { chapter: { include: { subject: true } } } } },
  });
  if (!note) return null;
  if (note.topic) {
    if (
      note.topic.deletedAt != null ||
      note.topic.chapter?.deletedAt != null ||
      note.topic.chapter?.subject?.deletedAt != null
    ) {
      return null;
    }
    await assertScopeAccess(userId, {
      workspaceId: note.topic.chapter.subject.workspaceId,
      groupId: note.topic.chapter.subject.groupId,
    });
    return note;
  }
  if (note.authorId === userId) return note;
  throw new NotAuthorizedError();
}

/**
 * Wraps the getAccessible* helpers above for server *components* (as
 * opposed to route handlers): 404s instead of throwing, since a page
 * should render Next's not-found UI rather than an unhandled error for
 * "this doesn't exist or isn't yours" — the same response either way, so
 * we don't leak which case it was.
 */
export async function requireSubject(subjectId: string, userId: string) {
  try {
    const subject = await getAccessibleSubject(subjectId, userId);
    if (!subject) notFound();
    return subject;
  } catch (err) {
    if (err instanceof NotAuthorizedError) notFound();
    throw err;
  }
}

export async function requireChapter(chapterId: string, userId: string) {
  try {
    const chapter = await getAccessibleChapter(chapterId, userId);
    if (!chapter) notFound();
    return chapter;
  } catch (err) {
    if (err instanceof NotAuthorizedError) notFound();
    throw err;
  }
}

export async function requireTopic(topicId: string, userId: string) {
  try {
    const topic = await getAccessibleTopic(topicId, userId);
    if (!topic) notFound();
    return topic;
  } catch (err) {
    if (err instanceof NotAuthorizedError) notFound();
    throw err;
  }
}

export async function requireMaterial(materialId: string, userId: string) {
  try {
    const material = await getAccessibleMaterial(materialId, userId);
    if (!material) notFound();
    return material;
  } catch (err) {
    if (err instanceof NotAuthorizedError) notFound();
    throw err;
  }
}

/** requireX pair for getAccessibleFlashcardDeck (Phase 8.2 — the minimal deck page needs this). */
export async function requireFlashcardDeck(deckId: string, userId: string) {
  try {
    const deck = await getAccessibleFlashcardDeck(deckId, userId);
    if (!deck) notFound();
    return deck;
  } catch (err) {
    if (err instanceof NotAuthorizedError) notFound();
    throw err;
  }
}

/** requireX pair for getAccessibleQuiz (Phase 8.3 — the quiz-taking page needs this). */
export async function requireQuiz(quizId: string, userId: string) {
  try {
    const quiz = await getAccessibleQuiz(quizId, userId);
    if (!quiz) notFound();
    return quiz;
  } catch (err) {
    if (err instanceof NotAuthorizedError) notFound();
    throw err;
  }
}

/**
 * ProcessingJob ownership is a flat userId check — jobs aren't shared via
 * workspace/subject/etc. membership the way Subject/Chapter/Topic/Material
 * are, since a job represents one user's own in-flight action (spec §49).
 */
export async function getAccessibleProcessingJob(jobId: string, userId: string) {
  const job = await db.processingJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (job.userId !== userId) throw new NotAuthorizedError();
  return job;
}

// ----------------------------------------------------------------------------
// AI conversations (Phase 5, spec §21)
// ----------------------------------------------------------------------------

export interface AIScopeInput {
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
  // Phase 6.5: a bare group scope (no subject/chapter/topic underneath
  // it) — "ask across everything this group has shared." Ignored if any
  // of subjectId/chapterId/topicId is also set (same narrowest-wins
  // precedence as everything else in getAccessibleAIScope).
  groupId?: string;
}

/**
 * A resolved AI scope is owned by exactly one of a personal Workspace or a
 * Group — mirroring Subject's own workspaceId/groupId invariant (see
 * lib/subject-scope.ts) — expressed as a discriminated union rather than
 * two independently-nullable fields, so "both set" or "neither set" is
 * unrepresentable at the type level, not just runtime-checked. Consumers
 * (lib/retrieval.ts, /api/ai/conversations) must narrow on `ownerType`
 * before reading `workspaceId`/`groupId`.
 *
 * subjectId/chapterId/topicId narrow *within* whichever owner the scope
 * belongs to — a group-owned Subject's Topic is still `ownerType: "group"`.
 *
 * Phase 6.5: `ownerType: "group"` is now reachable two ways — a
 * group-owned Subject/Chapter/Topic (resolved via `resolveSubjectOwner`,
 * shipped in Phase 6.4), or a *bare* group scope (`AIScopeInput.groupId`
 * with no subject/chapter/topic set — "ask across everything this group
 * has shared") resolved directly in `getAccessibleAIScope` below.
 */
export type ResolvedAIScope =
  | {
      ownerType: "workspace";
      workspaceId: string;
      groupId: null;
      subjectId: string | null;
      chapterId: string | null;
      topicId: string | null;
    }
  | {
      ownerType: "group";
      workspaceId: null;
      groupId: string;
      subjectId: string | null;
      chapterId: string | null;
      topicId: string | null;
    };

/**
 * Resolves + authorizes the scope for an AIConversation: exactly the
 * narrowest of topicId/chapterId/subjectId identifies how narrow the
 * conversation's retrieval should be; none of them means workspace-level
 * (the global AI Assistant). Mirrors resolveMaterialScope's cascade (a
 * topic's chapter/subject are derived, never independently trusted) so a
 * conversation's stored scope always agrees with how retrieval.ts filters
 * materials — same FK fields, same "narrowest wins" precedence.
 *
 * Ownership (`ownerType`/`workspaceId`/`groupId`) is derived from the
 * resolved Subject itself via `resolveSubjectOwner`, not assumed —
 * `Subject.workspaceId` is nullable (Phase 6.1) since a Subject can
 * belong to a Group instead.
 *
 * Phase 6.5: a *bare* group scope (`AIScopeInput.groupId`, no
 * subject/chapter/topic underneath it — "ask across everything this
 * group has shared") is authorized by group membership alone, mirroring
 * `assertScopeAccess`'s existing "any group member can reach group
 * content" rule (see `userIsGroupMember` above) — matches the Phase 6
 * planning decision that group AI conversations are private-per-user but
 * scoped to *shared* group knowledge, not gated to a manage-level role.
 */
export async function getAccessibleAIScope(input: AIScopeInput, userId: string): Promise<ResolvedAIScope> {
  if (input.topicId) {
    const topic = await getAccessibleTopic(input.topicId, userId);
    if (!topic) throw new NotAuthorizedError();
    return {
      ...resolveSubjectOwner(topic.chapter.subject),
      subjectId: topic.chapter.subjectId,
      chapterId: topic.chapterId,
      topicId: topic.id,
    };
  }

  if (input.chapterId) {
    const chapter = await getAccessibleChapter(input.chapterId, userId);
    if (!chapter) throw new NotAuthorizedError();
    return {
      ...resolveSubjectOwner(chapter.subject),
      subjectId: chapter.subjectId,
      chapterId: chapter.id,
      topicId: null,
    };
  }

  if (input.subjectId) {
    const subject = await getAccessibleSubject(input.subjectId, userId);
    if (!subject) throw new NotAuthorizedError();
    return { ...resolveSubjectOwner(subject), subjectId: subject.id, chapterId: null, topicId: null };
  }

  if (input.groupId) {
    const group = await getAccessibleGroup(input.groupId, userId);
    if (!group) throw new NotAuthorizedError();
    return {
      ownerType: "group",
      workspaceId: null,
      groupId: group.id,
      subjectId: null,
      chapterId: null,
      topicId: null,
    };
  }

  const workspace = await getPrimaryWorkspace(userId);
  return {
    ownerType: "workspace",
    workspaceId: workspace.id,
    groupId: null,
    subjectId: null,
    chapterId: null,
    topicId: null,
  };
}

/**
 * An AIConversation's access is ownership-only (userId match) — unlike
 * Subject/Chapter/Topic/Material, conversations aren't shared just by
 * virtue of workspace membership (spec §21's per-user chat history).
 * Re-checking the underlying scope's access on every read/write (not just
 * conversation ownership) matters because workspace/subject/chapter/topic
 * membership can change after a conversation was created.
 */
export async function getAccessibleAIConversation(conversationId: string, userId: string) {
  const conversation = await db.aIConversation.findUnique({
    where: { id: conversationId, deletedAt: null },
  });
  if (!conversation) return null;
  if (conversation.userId !== userId) throw new NotAuthorizedError();

  await getAccessibleAIScope(
    {
      topicId: conversation.topicId ?? undefined,
      chapterId: conversation.chapterId ?? undefined,
      subjectId: conversation.subjectId ?? undefined,
      groupId: conversation.groupId ?? undefined,
    },
    userId
  );

  return conversation;
}

// ----------------------------------------------------------------------------
// Groups (Phase 6.1, spec §32-34)
// ----------------------------------------------------------------------------

/**
 * Returns the caller's role in a Group, or null if they're not a member.
 * Distinct from the existing `userIsGroupMember` (boolean-only, used by
 * `assertScopeAccess` for Subject/Chapter/Topic/Material) — Phase 6.1's
 * permission matrix (spec §34) needs the actual role, not just membership,
 * to tell OWNER/ADMIN apart from MEMBER/VIEWER.
 */
export async function getGroupRole(groupId: string, userId: string): Promise<MemberRole | null> {
  const membership = await db.groupMember.findFirst({
    where: {
      groupId,
      userId,
      group: { deletedAt: null },
    },
    select: { role: true },
  });
  return membership?.role ?? null;
}

/**
 * Throws NotAuthorizedError unless the caller's role in the group meets
 * `minimum` in the OWNER > ADMIN > MEMBER > VIEWER hierarchy (see
 * lib/group-role.ts). Returns the GroupMember row itself so callers that
 * also want `role`/`joinedAt` don't need a second query.
 */
export async function requireGroupRole(groupId: string, userId: string, minimum: MemberRole) {
  const membership = await db.groupMember.findFirst({
    where: {
      groupId,
      userId,
      group: { deletedAt: null },
    },
  });
  if (!membership || !roleMeetsMinimum(membership.role, minimum)) {
    throw new NotAuthorizedError();
  }
  return membership;
}

/**
 * A Group is only accessible to its members (any role, including VIEWER)
 * — unlike Subject/Chapter/Topic, there's no "workspace" fallback, since a
 * Group has no workspace of its own. Returns null if the group doesn't
 * exist at all; throws NotAuthorizedError if it exists but the caller
 * isn't a member — same null-vs-throw split as `getAccessibleSubject` and
 * friends, so route handlers can map each case to the right status code
 * (404 vs 403) while `requireGroup` below collapses both into a 404 for
 * server components.
 */
export async function getAccessibleGroup(groupId: string, userId: string) {
  const group = await db.group.findUnique({ where: { id: groupId, deletedAt: null } });
  if (!group) return null;
  const role = await getGroupRole(groupId, userId);
  if (!role) throw new NotAuthorizedError();
  return group;
}

export async function requireGroup(groupId: string, userId: string) {
  try {
    const group = await getAccessibleGroup(groupId, userId);
    if (!group) notFound();
    return group;
  } catch (err) {
    if (err instanceof NotAuthorizedError) notFound();
    throw err;
  }
}

/**
 * Group Subject mutations (create/rename/archive/delete) require ADMIN+ in
 * the owning group — master prompt §34's permission matrix, Phase 6.4 §2.
 * Workspace/personal Subjects have no analogous extra check: reaching one
 * at all already requires workspace membership (today, a single-member
 * personal workspace), which getAccessibleSubject/getAccessibleGroup above
 * already enforce — so this only adds a check for the group branch,
 * leaving workspace Subject authorization completely unchanged.
 *
 * Deliberately NOT extended to Chapter/Topic/Material mutations — the
 * Phase 6.4 permission matrix only covers Subject-level create/edit/
 * delete. Chapter/Topic/Material mutations under a group Subject keep
 * today's existing behavior (any group member, any role); see
 * PROJECT_STATE.md's "Known limitations" for why this is a deliberate
 * scope boundary rather than an oversight.
 */
export async function assertSubjectManageAccess(scope: { groupId: string | null }, userId: string) {
  if (scope.groupId) {
    await requireGroupRole(scope.groupId, userId, "ADMIN");
  }
}

/**
 * Finds a User by email, case-insensitively (Phase 6.2). `User.email` is
 * stored exactly as the person typed it at signup (see
 * `api/auth/register/route.ts`) — it is NOT stored pre-normalized — so a
 * plain `db.user.findUnique({ where: { email } })` against an already
 * `normalizeEmail()`-lowercased invitation address would silently miss a
 * user who originally registered as `Test@Example.com`. Postgres's
 * case-insensitive `mode: "insensitive"` comparison is used instead of
 * assuming either side is already normalized. Callers should still pass
 * an already-`normalizeEmail()`-normalized value in for consistency/
 * readability, but correctness does not depend on it.
 */
export async function findUserByNormalizedEmail(email: string) {
  return db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, deletedAt: null },
  });
}
