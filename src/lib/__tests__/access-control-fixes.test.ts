import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  groupMember: { findFirst: vi.fn() },
  workspaceMember: { findUnique: vi.fn() },
  chapter: { findUnique: vi.fn() },
  topic: { findUnique: vi.fn() },
  note: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import {
  getAccessibleChapter,
  getAccessibleNote,
  getAccessibleTopic,
  NotAuthorizedError,
} from "@/lib/access";

describe("access control hardening (group note revocation + soft-deleted ancestors)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("blocks former group member from reading/mutating a group note they originally authored", async () => {
    db.note.findUnique.mockResolvedValue({
      id: "note-group-1",
      authorId: "user-former-author",
      deletedAt: null,
      topic: {
        id: "topic-1",
        deletedAt: null,
        chapter: {
          id: "chap-1",
          deletedAt: null,
          subject: {
            id: "subj-1",
            workspaceId: null,
            groupId: "group-1",
            deletedAt: null,
          },
        },
      },
    });
    db.groupMember.findFirst.mockResolvedValue(null);

    await expect(getAccessibleNote("note-group-1", "user-former-author")).rejects.toThrow(
      NotAuthorizedError
    );
  });

  it("allows standalone author note access when topic is null", async () => {
    db.note.findUnique.mockResolvedValue({
      id: "note-standalone",
      authorId: "user-1",
      deletedAt: null,
      topic: null,
    });

    const result = await getAccessibleNote("note-standalone", "user-1");
    expect(result?.id).toBe("note-standalone");
  });

  it("returns null for notes, topics, and chapters under soft-deleted parents/subjects", async () => {
    db.note.findUnique.mockResolvedValue({
      id: "note-1",
      authorId: "user-1",
      deletedAt: null,
      topic: {
        id: "topic-1",
        deletedAt: new Date(),
        chapter: {
          id: "chap-1",
          deletedAt: null,
          subject: { id: "subj-1", workspaceId: "ws-1", groupId: null, deletedAt: null },
        },
      },
    });
    expect(await getAccessibleNote("note-1", "user-1")).toBeNull();

    db.topic.findUnique.mockResolvedValue({
      id: "topic-1",
      deletedAt: null,
      chapter: {
        id: "chap-1",
        deletedAt: null,
        subject: { id: "subj-1", workspaceId: "ws-1", groupId: null, deletedAt: new Date() },
      },
    });
    expect(await getAccessibleTopic("topic-1", "user-1")).toBeNull();

    db.chapter.findUnique.mockResolvedValue({
      id: "chap-1",
      deletedAt: null,
      subject: { id: "subj-1", workspaceId: "ws-1", groupId: null, deletedAt: new Date() },
    });
    expect(await getAccessibleChapter("chap-1", "user-1")).toBeNull();
  });
});
