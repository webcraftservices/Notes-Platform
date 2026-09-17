import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  quizAttempt: { findMany: vi.fn() },
  aIConversation: { findMany: vi.fn() },
  aIMessage: { count: vi.fn(), findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { getQuizProgress, getTutorActivity, getStudyProgress } from "@/lib/study-progress";
import type { ResolvedAIScope } from "@/lib/access";

const TOPIC_SCOPE: ResolvedAIScope = {
  ownerType: "workspace",
  workspaceId: "workspace-1",
  groupId: null,
  subjectId: "subject-1",
  chapterId: "chapter-1",
  topicId: "topic-1",
};

const GROUP_SCOPE: ResolvedAIScope = {
  ownerType: "group",
  workspaceId: null,
  groupId: "group-1",
  subjectId: null,
  chapterId: null,
  topicId: null,
};

function attempt(overrides: Partial<{
  id: string;
  quizId: string;
  score: number;
  startedAt: Date;
  completedAt: Date | null;
  quizTitle: string;
}> = {}) {
  return {
    id: overrides.id ?? "attempt-1",
    quizId: overrides.quizId ?? "quiz-1",
    userId: "user-1",
    answers: {},
    score: overrides.score ?? 80,
    weakTopics: [],
    startedAt: overrides.startedAt ?? new Date("2026-09-01T10:00:00Z"),
    completedAt: overrides.completedAt ?? new Date("2026-09-01T10:05:00Z"),
    quiz: { title: overrides.quizTitle ?? "Zeroth Law Quiz" },
  };
}

describe("getQuizProgress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns zeroed progress with no attempts, without throwing", async () => {
    db.quizAttempt.findMany.mockResolvedValue([]);

    const progress = await getQuizProgress("user-1");

    expect(progress).toEqual({ attempts: 0, latest: null, bestScore: null, averageScore: null, history: [] });
  });

  it("always scopes the query to the requesting user", async () => {
    db.quizAttempt.findMany.mockResolvedValue([]);

    await getQuizProgress("user-1");

    expect(db.quizAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) })
    );
  });

  it("reports a single attempt as its own latest/best/average", async () => {
    db.quizAttempt.findMany.mockResolvedValue([attempt({ score: 75 })]);

    const progress = await getQuizProgress("user-1");

    expect(progress.attempts).toBe(1);
    expect(progress.bestScore).toBe(75);
    expect(progress.averageScore).toBe(75);
    expect(progress.latest?.id).toBe("attempt-1");
  });

  it("keeps multiple attempts on the same quiz distinct — never collapses them", async () => {
    db.quizAttempt.findMany.mockResolvedValue([
      attempt({ id: "a3", score: 90, startedAt: new Date("2026-09-03T00:00:00Z") }),
      attempt({ id: "a2", score: 40, startedAt: new Date("2026-09-02T00:00:00Z") }),
      attempt({ id: "a1", score: 70, startedAt: new Date("2026-09-01T00:00:00Z") }),
    ]);

    const progress = await getQuizProgress("user-1");

    expect(progress.attempts).toBe(3);
    expect(progress.history).toHaveLength(3);
    expect(progress.latest?.id).toBe("a3");
    expect(progress.bestScore).toBe(90);
    expect(progress.averageScore).toBe(Math.round((90 + 40 + 70) / 3));
  });

  it("aggregates across multiple quizzes under the same topic rollup", async () => {
    db.quizAttempt.findMany.mockResolvedValue([
      attempt({ id: "a1", quizId: "quiz-1", quizTitle: "Quiz 1", score: 100 }),
      attempt({ id: "a2", quizId: "quiz-2", quizTitle: "Quiz 2", score: 50 }),
    ]);

    const progress = await getQuizProgress("user-1", TOPIC_SCOPE);

    expect(progress.attempts).toBe(2);
    expect(new Set(progress.history.map((h) => h.quizId))).toEqual(new Set(["quiz-1", "quiz-2"]));
    expect(db.quizAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1", quiz: { topicId: "topic-1" } }),
      })
    );
  });

  it("narrows a bare group scope to the group's own quizzes", async () => {
    db.quizAttempt.findMany.mockResolvedValue([]);

    await getQuizProgress("user-1", GROUP_SCOPE);

    expect(db.quizAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ quiz: { groupId: "group-1" } }) })
    );
  });

  it("caps history length without dropping attempts/bestScore/averageScore accuracy", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      attempt({ id: `a${i}`, score: i, startedAt: new Date(2026, 0, i + 1) })
    );
    db.quizAttempt.findMany.mockResolvedValue(many);

    const progress = await getQuizProgress("user-1");

    expect(progress.attempts).toBe(25);
    expect(progress.history.length).toBeLessThanOrEqual(20);
    expect(progress.bestScore).toBe(24);
  });

  it("never lets User B's attempts leak into User A's progress", async () => {
    // The mock only returns what a real `WHERE userId = 'user-a'` query
    // would — this test asserts the call itself is user-scoped, which is
    // the actual privacy boundary (the DB, not this test, filters rows).
    db.quizAttempt.findMany.mockResolvedValue([attempt({ id: "a-owned-by-user-a" })]);

    await getQuizProgress("user-a");

    const callArgs = db.quizAttempt.findMany.mock.calls[0][0];
    expect(callArgs.where.userId).toBe("user-a");
    expect(callArgs.where.userId).not.toBe("user-b");
  });
});

describe("getTutorActivity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns zeroed activity with no Tutor conversations", async () => {
    db.aIConversation.findMany.mockResolvedValue([]);

    const activity = await getTutorActivity("user-1");

    expect(activity).toEqual({ sessions: 0, messages: 0, lastActiveAt: null });
    expect(db.aIMessage.count).not.toHaveBeenCalled();
  });

  it("only ever queries kind = TUTOR — never CHAT", async () => {
    db.aIConversation.findMany.mockResolvedValue([]);

    await getTutorActivity("user-1");

    expect(db.aIConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", kind: "TUTOR" }) })
    );
  });

  it("counts sessions and messages, and reports the last active timestamp", async () => {
    db.aIConversation.findMany.mockResolvedValue([{ id: "conv-1" }, { id: "conv-2" }]);
    db.aIMessage.count.mockResolvedValue(14);
    db.aIMessage.findFirst.mockResolvedValue({ createdAt: new Date("2026-09-10T12:00:00Z") });

    const activity = await getTutorActivity("user-1");

    expect(activity.sessions).toBe(2);
    expect(activity.messages).toBe(14);
    expect(activity.lastActiveAt).toEqual(new Date("2026-09-10T12:00:00Z"));
    expect(db.aIMessage.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: { in: ["conv-1", "conv-2"] } } })
    );
  });

  it("narrows to a topic scope when one is provided", async () => {
    db.aIConversation.findMany.mockResolvedValue([]);

    await getTutorActivity("user-1", TOPIC_SCOPE);

    expect(db.aIConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ topicId: "topic-1" }) })
    );
  });

  it("is unaffected by a mix of TUTOR and CHAT activity — CHAT never contributes", async () => {
    // A real query already filters kind: "TUTOR" server-side; this test
    // pins that the where-clause sent to the DB excludes CHAT rather
    // than filtering client-side after the fact.
    db.aIConversation.findMany.mockResolvedValue([{ id: "tutor-conv" }]);
    db.aIMessage.count.mockResolvedValue(3);
    db.aIMessage.findFirst.mockResolvedValue({ createdAt: new Date("2026-09-05T00:00:00Z") });

    const activity = await getTutorActivity("user-1");

    const callArgs = db.aIConversation.findMany.mock.calls[0][0];
    expect(callArgs.where.kind).toBe("TUTOR");
    expect(activity.sessions).toBe(1);
  });
});

describe("getStudyProgress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("combines quiz progress and tutor activity for a user with no history", async () => {
    db.quizAttempt.findMany.mockResolvedValue([]);
    db.aIConversation.findMany.mockResolvedValue([]);

    const progress = await getStudyProgress("user-1");

    expect(progress.quizzes.attempts).toBe(0);
    expect(progress.tutor.sessions).toBe(0);
  });

  it("handles a zero-question quiz's attempt (score 0) without dividing by zero", async () => {
    db.quizAttempt.findMany.mockResolvedValue([attempt({ score: 0 })]);
    db.aIConversation.findMany.mockResolvedValue([]);

    const progress = await getStudyProgress("user-1");

    expect(progress.quizzes.averageScore).toBe(0);
    expect(progress.quizzes.bestScore).toBe(0);
    expect(Number.isNaN(progress.quizzes.averageScore)).toBe(false);
  });
});
