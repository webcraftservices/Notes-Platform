import { getAccessibleSubject, getAccessibleChapter, getAccessibleTopic } from "@/lib/access";

export interface MaterialScope {
  workspaceId: string;
  subjectId: string | null;
  chapterId: string | null;
  topicId: string | null;
}

/**
 * Materials always belong to the user's workspace (so "Unorganized" still
 * has a well-defined home to list from), and may additionally be attached
 * to a subject, a chapter within that subject, or a topic within that
 * chapter. Passing a topicId derives its chapter/subject automatically
 * rather than trusting three independently-supplied IDs to agree —
 * mismatched IDs from a client would otherwise silently attach a material
 * to the wrong subject.
 *
 * Throws NotAuthorizedError (via the underlying getAccessible* helpers) if
 * the user can't reach the requested subject/chapter/topic.
 */
export async function resolveMaterialScope(
  input: { subjectId?: string; chapterId?: string; topicId?: string },
  userId: string,
  workspaceId: string
): Promise<MaterialScope> {
  if (input.topicId) {
    const topic = await getAccessibleTopic(input.topicId, userId);
    if (!topic) throw new ScopeNotFoundError("topic");
    return {
      workspaceId,
      subjectId: topic.chapter.subjectId,
      chapterId: topic.chapterId,
      topicId: topic.id,
    };
  }

  if (input.chapterId) {
    const chapter = await getAccessibleChapter(input.chapterId, userId);
    if (!chapter) throw new ScopeNotFoundError("chapter");
    return { workspaceId, subjectId: chapter.subjectId, chapterId: chapter.id, topicId: null };
  }

  if (input.subjectId) {
    const subject = await getAccessibleSubject(input.subjectId, userId);
    if (!subject) throw new ScopeNotFoundError("subject");
    return { workspaceId, subjectId: subject.id, chapterId: null, topicId: null };
  }

  return { workspaceId, subjectId: null, chapterId: null, topicId: null };
}

export class ScopeNotFoundError extends Error {
  constructor(public readonly kind: "subject" | "chapter" | "topic") {
    super(`${kind} not found or not accessible`);
  }
}
