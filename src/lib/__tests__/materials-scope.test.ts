import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getAccessibleSubject: vi.fn(),
  getAccessibleChapter: vi.fn(),
  getAccessibleTopic: vi.fn(),
}));

vi.mock("@/lib/access", () => access);

import { resolveMaterialScope } from "@/lib/materials-scope";

describe("resolveMaterialScope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("copies a topic's ancestor chapter and subject IDs", async () => {
    access.getAccessibleTopic.mockResolvedValue({
      id: "topic-1",
      chapterId: "chapter-1",
      chapter: {
        subjectId: "subject-1",
        subject: { workspaceId: "workspace-1", groupId: null },
      },
    });

    await expect(resolveMaterialScope({ topicId: "topic-1" }, "user-1", "workspace-1")).resolves.toEqual({
      workspaceId: "workspace-1",
      groupId: null,
      subjectId: "subject-1",
      chapterId: "chapter-1",
      topicId: "topic-1",
    });
  });

  it("copies a chapter's ancestor subject ID", async () => {
    access.getAccessibleChapter.mockResolvedValue({
      id: "chapter-1",
      subjectId: "subject-1",
      subject: { workspaceId: "workspace-1", groupId: null },
    });

    await expect(resolveMaterialScope({ chapterId: "chapter-1" }, "user-1", "workspace-1")).resolves.toEqual({
      workspaceId: "workspace-1",
      groupId: null,
      subjectId: "subject-1",
      chapterId: "chapter-1",
      topicId: null,
    });
  });

  it("returns the subject ID for subject-level material", async () => {
    access.getAccessibleSubject.mockResolvedValue({
      id: "subject-1",
      workspaceId: "workspace-1",
      groupId: null,
    });

    await expect(resolveMaterialScope({ subjectId: "subject-1" }, "user-1", "workspace-1")).resolves.toEqual({
      workspaceId: "workspace-1",
      groupId: null,
      subjectId: "subject-1",
      chapterId: null,
      topicId: null,
    });
  });
});
