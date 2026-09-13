import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  flashcardDeck: { findUnique: vi.fn() },
  quiz: { findUnique: vi.fn() },
  workspaceMember: { findUnique: vi.fn() },
  groupMember: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));

import { getAccessibleFlashcardDeck, getAccessibleQuiz, NotAuthorizedError } from "@/lib/access";

describe("Learning scope authorization (Phase 8.1)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null for a FlashcardDeck that doesn't exist", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue(null);
    await expect(getAccessibleFlashcardDeck("deck-1", "user-1")).resolves.toBeNull();
  });

  it("always allows the owner, regardless of scope membership", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue({
      id: "deck-1",
      ownerId: "user-1",
      groupId: "group-1",
      workspaceId: null,
    });
    // Owner shortcut must not even need to check membership.
    const deck = await getAccessibleFlashcardDeck("deck-1", "user-1");
    expect(deck).toMatchObject({ id: "deck-1" });
    expect(db.groupMember.findUnique).not.toHaveBeenCalled();
  });

  it("allows a group member to reach a group-scoped deck they don't own", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue({
      id: "deck-1",
      ownerId: "owner-user",
      groupId: "group-1",
      workspaceId: null,
    });
    db.groupMember.findUnique.mockResolvedValue({ groupId: "group-1", userId: "user-2", role: "MEMBER" });

    const deck = await getAccessibleFlashcardDeck("deck-1", "user-2");
    expect(deck).toMatchObject({ id: "deck-1" });
  });

  it("rejects a non-member for a group-scoped deck", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue({
      id: "deck-1",
      ownerId: "owner-user",
      groupId: "group-1",
      workspaceId: null,
    });
    db.groupMember.findUnique.mockResolvedValue(null);

    await expect(getAccessibleFlashcardDeck("deck-1", "user-2")).rejects.toThrow(NotAuthorizedError);
  });

  it("allows a workspace member to reach a workspace-scoped deck they don't own", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue({
      id: "deck-1",
      ownerId: "owner-user",
      groupId: null,
      workspaceId: "workspace-1",
    });
    db.workspaceMember.findUnique.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-2" });

    const deck = await getAccessibleFlashcardDeck("deck-1", "user-2");
    expect(deck).toMatchObject({ id: "deck-1" });
  });

  it("rejects a non-member for a workspace-scoped deck", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue({
      id: "deck-1",
      ownerId: "owner-user",
      groupId: null,
      workspaceId: "workspace-1",
    });
    db.workspaceMember.findUnique.mockResolvedValue(null);

    await expect(getAccessibleFlashcardDeck("deck-1", "user-2")).rejects.toThrow(NotAuthorizedError);
  });

  it("returns null for a Quiz that doesn't exist", async () => {
    db.quiz.findUnique.mockResolvedValue(null);
    await expect(getAccessibleQuiz("quiz-1", "user-1")).resolves.toBeNull();
  });

  it("allows a group member to reach a group-scoped quiz they don't own", async () => {
    db.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      ownerId: "owner-user",
      groupId: "group-1",
      workspaceId: null,
    });
    db.groupMember.findUnique.mockResolvedValue({ groupId: "group-1", userId: "user-2", role: "VIEWER" });

    const quiz = await getAccessibleQuiz("quiz-1", "user-2");
    expect(quiz).toMatchObject({ id: "quiz-1" });
  });

  it("rejects a non-member for a group-scoped quiz", async () => {
    db.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      ownerId: "owner-user",
      groupId: "group-1",
      workspaceId: null,
    });
    db.groupMember.findUnique.mockResolvedValue(null);

    await expect(getAccessibleQuiz("quiz-1", "user-2")).rejects.toThrow(NotAuthorizedError);
  });
});
