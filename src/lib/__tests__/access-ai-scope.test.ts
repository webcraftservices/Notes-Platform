import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  subject: { findUnique: vi.fn() },
  chapter: { findUnique: vi.fn() },
  topic: { findUnique: vi.fn() },
  aIConversation: { findUnique: vi.fn() },
  workspaceMember: { findUnique: vi.fn() },
  groupMember: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));

import {
  getAccessibleAIConversation,
  getAccessibleAIScope,
  NotAuthorizedError,
} from "@/lib/access";

describe("AI scope authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects an inaccessible Subject scope", async () => {
    db.subject.findUnique.mockResolvedValue({
      id: "subject-1",
      workspaceId: "workspace-1",
      groupId: null,
    });
    db.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(getAccessibleAIScope({ subjectId: "subject-1" }, "user-1")).rejects.toThrow(NotAuthorizedError);
  });

  it("rejects an inaccessible Chapter scope", async () => {
    db.chapter.findUnique.mockResolvedValue({
      id: "chapter-1",
      subjectId: "subject-1",
      subject: { workspaceId: "workspace-1", groupId: null },
    });
    db.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(getAccessibleAIScope({ chapterId: "chapter-1" }, "user-1")).rejects.toThrow(NotAuthorizedError);
  });

  it("re-authorizes a stored AI conversation scope before retrieval can use it", async () => {
    db.aIConversation.findUnique.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      subjectId: "subject-1",
      chapterId: null,
      topicId: null,
      groupId: null,
    });
    db.subject.findUnique.mockResolvedValue({
      id: "subject-1",
      workspaceId: "workspace-1",
      groupId: null,
    });
    db.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(getAccessibleAIConversation("conversation-1", "user-1")).rejects.toThrow(NotAuthorizedError);
  });

  /**
   * Phase 8.4 — AI Tutor conversation privacy, exercised against the real
   * `getAccessibleAIConversation`/`getAccessibleAIScope` (only `db` is
   * mocked — same boundary as every other test in this file). The audit's
   * central finding was that the pre-existing tests for this behavior
   * mocked `@/lib/access` itself and injected a `kind: "TUTOR"` value that
   * had no corresponding schema column, so they could never prove this.
   * `AIConversation.kind` is now a real column (see the
   * 20260916090000_ai_conversation_kind migration) that
   * `db.aIConversation.findUnique` returns as an ordinary scalar field —
   * `getAccessibleAIConversation` needed zero code changes for `kind` to
   * flow through it, so these tests exercise the function completely
   * unmodified.
   */
  it("lets the owning user access their own real TUTOR-kind conversation for an authorized Topic", async () => {
    db.aIConversation.findUnique.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      kind: "TUTOR",
      subjectId: null,
      chapterId: null,
      topicId: "topic-1",
      groupId: null,
    });
    db.topic.findUnique.mockResolvedValue({
      id: "topic-1",
      chapterId: "chapter-1",
      chapter: { subjectId: "subject-1", subject: { workspaceId: "workspace-1", groupId: null } },
    });
    db.workspaceMember.findUnique.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" });

    const conversation = await getAccessibleAIConversation("conversation-1", "user-1");
    expect(conversation?.id).toBe("conversation-1");
    expect(conversation?.kind).toBe("TUTOR");
  });

  it("denies a different user access to someone else's real TUTOR-kind conversation, even for a Topic they can both reach", async () => {
    db.aIConversation.findUnique.mockResolvedValue({
      id: "conversation-1",
      userId: "owner-1",
      kind: "TUTOR",
      subjectId: null,
      chapterId: null,
      topicId: "topic-1",
      groupId: null,
    });
    // Note: getAccessibleAIConversation's ownership check runs and throws
    // BEFORE ever resolving the Topic scope, so db.topic.findUnique isn't
    // even consulted here — attacker-1 is rejected purely on ownership,
    // regardless of whether they could otherwise reach topic-1.

    await expect(getAccessibleAIConversation("conversation-1", "attacker-1")).rejects.toThrow(NotAuthorizedError);
    expect(db.topic.findUnique).not.toHaveBeenCalled();
  });

  it("does not let group Topic membership substitute for conversation ownership — a second group member gets denied, not granted, access to the first member's Tutor conversation", async () => {
    db.aIConversation.findUnique.mockResolvedValue({
      id: "conversation-1",
      userId: "member-a",
      kind: "TUTOR",
      subjectId: null,
      chapterId: null,
      topicId: "topic-1",
      groupId: null,
    });
    // Even if member-b is a legitimate member of the group that owns
    // topic-1 (so they could create their OWN Tutor conversation for it),
    // that must never grant them member-a's conversation.
    db.groupMember.findUnique.mockResolvedValue({ groupId: "group-1", userId: "member-b" });

    await expect(getAccessibleAIConversation("conversation-1", "member-b")).rejects.toThrow(NotAuthorizedError);
  });
});
