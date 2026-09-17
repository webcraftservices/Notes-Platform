import { db } from "@/lib/db";
import type { ResolvedAIScope } from "@/lib/access";
import { materialWhereForScope } from "@/lib/retrieval-scope";

/**
 * Phase 8.5 — Study Progress.
 *
 * Deliberately NOT a new `StudyProgress` model. `QuizAttempt` and the
 * Phase 8.4 `AIConversation`/`AIMessage` (`kind = TUTOR`) rows are
 * already real, persisted, per-user activity — this file only aggregates
 * them. See PROJECT_STATE.md's Phase 8.5 audit for why a second tracking
 * table would be redundant and why `FlashcardReview` is deliberately not
 * included here (it has no write path yet — see
 * `flashcards/[deckId]/route.ts`'s doc comment).
 *
 * Every function takes `userId` explicitly and starts its query from
 * `WHERE userId = userId` — never inferred, never defaulted, and never
 * satisfied by content-scope membership alone. A group-owned Quiz or
 * Tutor-enabled Topic is shared CONTENT (any group member can reach it),
 * but `QuizAttempt`/`AIConversation` rows are private ACTIVITY: two
 * members of the same group who both took the same Quiz each see only
 * their own attempts (see `learning-access.test.ts`, `access-ai-scope.
 * test.ts`). `scope`, when provided, is trusted completely — it must
 * already be an *authorized* `ResolvedAIScope` (from
 * `getAccessibleAIScope`), never raw, unauthorized IDs. It is used only
 * to narrow which shared Quiz/Topic the activity is attached to, via the
 * exact same narrowest-wins where clause `lib/retrieval-scope.ts` already
 * uses for Material — Quiz and AIConversation both carry the identical
 * five-field scope shape (workspaceId/groupId/subjectId/chapterId/
 * topicId).
 *
 * No `scope` at all means the true global aggregate: every attempt/
 * session this user has ever made, regardless of which workspace or
 * group the underlying Quiz/Topic belongs to. This is still fully
 * private — the `userId` filter never changes — it's just unnarrowed.
 * This is what the dashboard's "Study Activity" widget uses; a Topic's
 * Study Tools panel instead passes a topicId-narrowed scope.
 */

export interface QuizAttemptSummary {
  id: string;
  quizId: string;
  quizTitle: string;
  score: number;
  startedAt: Date;
  completedAt: Date | null;
}

export interface QuizProgress {
  attempts: number;
  latest: QuizAttemptSummary | null;
  bestScore: number | null;
  averageScore: number | null;
  /** Most recent attempts first, capped — see MAX_HISTORY below. */
  history: QuizAttemptSummary[];
}

export interface TutorActivity {
  sessions: number;
  messages: number;
  lastActiveAt: Date | null;
}

export interface StudyProgress {
  quizzes: QuizProgress;
  tutor: TutorActivity;
}

// Mirrors the "take: N" convention already used for other recent-activity
// lists (see lib/dashboard.ts) — a personal history list, not a paginated
// report; deliberately not overbuilt with real pagination for Phase 8.5.
const MAX_HISTORY = 20;

/**
 * Real, private, per-user Quiz progress. Multiple attempts on the same
 * Quiz are never collapsed: `attempts` counts every one of them, `latest`
 * is the most recently started, `bestScore`/`averageScore` are computed
 * across all of them, and multiple Quizzes under one scope (e.g. several
 * quizzes generated for the same Topic over time) all contribute to the
 * same rollup because the where-clause narrows by `quiz.topicId` (etc.),
 * not by a single `quizId`.
 */
export async function getQuizProgress(userId: string, scope?: ResolvedAIScope): Promise<QuizProgress> {
  const quizWhere = scope ? materialWhereForScope(scope) : {};

  const attempts = await db.quizAttempt.findMany({
    where: { userId, quiz: quizWhere },
    include: { quiz: { select: { title: true } } },
    orderBy: { startedAt: "desc" },
  });

  if (attempts.length === 0) {
    return { attempts: 0, latest: null, bestScore: null, averageScore: null, history: [] };
  }

  const history: QuizAttemptSummary[] = attempts.slice(0, MAX_HISTORY).map((a) => ({
    id: a.id,
    quizId: a.quizId,
    quizTitle: a.quiz.title,
    score: a.score,
    startedAt: a.startedAt,
    completedAt: a.completedAt,
  }));

  const bestScore = Math.max(...attempts.map((a) => a.score));
  const averageScore = Math.round(attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length);

  return {
    attempts: attempts.length,
    latest: history[0],
    bestScore,
    averageScore,
    history,
  };
}

/**
 * Real, private, per-user AI Tutor activity. Only `AIConversation` rows
 * with `kind = TUTOR` count as a "session" — a plain "Ask AI" (`kind =
 * CHAT`) conversation never contributes here, matching the distinction
 * `AIConversation.kind`'s own schema comment establishes. Reads the
 * actual conversation/message tables rather than the `tutor_chat`
 * `UsageRecord` ledger: `UsageRecord` is a best-effort accounting record
 * (see `lib/ai-usage.ts`), while `AIConversation`/`AIMessage` are the
 * real persisted activity this feature is meant to reflect.
 */
export async function getTutorActivity(userId: string, scope?: ResolvedAIScope): Promise<TutorActivity> {
  const scopeWhere = scope ? materialWhereForScope(scope) : {};

  const conversations = await db.aIConversation.findMany({
    where: { userId, kind: "TUTOR", deletedAt: null, ...scopeWhere },
    select: { id: true },
  });

  if (conversations.length === 0) {
    return { sessions: 0, messages: 0, lastActiveAt: null };
  }

  const conversationIds = conversations.map((c) => c.id);

  const [messages, lastMessage] = await Promise.all([
    db.aIMessage.count({ where: { conversationId: { in: conversationIds } } }),
    db.aIMessage.findFirst({
      where: { conversationId: { in: conversationIds } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    sessions: conversations.length,
    messages,
    lastActiveAt: lastMessage?.createdAt ?? null,
  };
}

/** Convenience wrapper — the shape `GET /api/progress` returns. */
export async function getStudyProgress(userId: string, scope?: ResolvedAIScope): Promise<StudyProgress> {
  const [quizzes, tutor] = await Promise.all([getQuizProgress(userId, scope), getTutorActivity(userId, scope)]);
  return { quizzes, tutor };
}
