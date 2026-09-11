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
});
