import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  group: { findUnique: vi.fn() },
  groupMember: { findFirst: vi.fn(), findUnique: vi.fn() },
  subject: { findUnique: vi.fn() },
  material: { findUnique: vi.fn(), findFirst: vi.fn() },
  workspaceMember: { findUnique: vi.fn() },
  flashcardDeck: { findUnique: vi.fn() },
  quiz: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));

import {
  userIsGroupMember,
  getGroupRole,
  requireGroupRole,
  getAccessibleGroup,
  getAccessibleSubject,
  getAccessibleMaterial,
  getAccessibleMaterialByStorageKey,
  getAccessibleFlashcardDeck,
  getAccessibleQuiz,
  NotAuthorizedError,
} from "@/lib/access";
import type { MemberRole } from "@prisma/client";

describe("Group access after soft deletion and active group authorization (Phase 10C.1A)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // 1. Active group member is recognized
  it("recognizes an active group member in userIsGroupMember and getAccessibleGroup", async () => {
    db.groupMember.findFirst.mockImplementation(({ where }: { where: { groupId: string; userId: string; group?: { deletedAt: null } } }) => {
      if (where.groupId === "group-active" && where.userId === "user-1" && where.group?.deletedAt === null) {
        return Promise.resolve({ id: "gm-1", groupId: "group-active", userId: "user-1", role: "MEMBER" });
      }
      return Promise.resolve(null);
    });
    db.group.findUnique.mockResolvedValue({ id: "group-active", name: "Active Group", deletedAt: null });

    const isMember = await userIsGroupMember("group-active", "user-1");
    expect(isMember).toBe(true);

    const group = await getAccessibleGroup("group-active", "user-1");
    expect(group).toMatchObject({ id: "group-active", name: "Active Group" });
  });

  // 2. Non-member is rejected
  it("rejects a non-member for an active group", async () => {
    db.groupMember.findFirst.mockResolvedValue(null);
    db.group.findUnique.mockResolvedValue({ id: "group-active", name: "Active Group", deletedAt: null });

    const isMember = await userIsGroupMember("group-active", "user-stranger");
    expect(isMember).toBe(false);

    await expect(getAccessibleGroup("group-active", "user-stranger")).rejects.toThrow(NotAuthorizedError);
  });

  // 3. Member of a soft-deleted group is rejected
  it("rejects membership in userIsGroupMember for a soft-deleted group even if GroupMember row exists", async () => {
    // When group is soft-deleted, relation filter group: { deletedAt: null } returns null from Prisma
    db.groupMember.findFirst.mockImplementation(({ where }: { where: { group?: { deletedAt: null } } }) => {
      if (where.group?.deletedAt === null) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ id: "gm-1" });
    });

    const isMember = await userIsGroupMember("group-deleted", "user-1");
    expect(isMember).toBe(false);

    expect(db.groupMember.findFirst).toHaveBeenCalledWith({
      where: {
        groupId: "group-deleted",
        userId: "user-1",
        group: { deletedAt: null },
      },
      select: { id: true },
    });
  });

  // 4. getGroupRole() does not return an active role for a deleted group
  it("does not return an active role in getGroupRole() and rejects requireGroupRole() for a deleted group", async () => {
    db.groupMember.findFirst.mockImplementation(({ where }: { where: { group?: { deletedAt: null } } }) => {
      if (where.group?.deletedAt === null) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ id: "gm-1", role: "ADMIN" });
    });

    const role = await getGroupRole("group-deleted", "user-1");
    expect(role).toBeNull();

    await expect(requireGroupRole("group-deleted", "user-1", "VIEWER")).rejects.toThrow(NotAuthorizedError);
  });

  // 5. Group-scoped subject access is rejected after group deletion
  it("rejects access to group-scoped subjects when the owning group has been soft-deleted", async () => {
    db.subject.findUnique.mockResolvedValue({
      id: "subj-group-1",
      name: "Group Subject",
      groupId: "group-deleted",
      workspaceId: null,
      deletedAt: null,
    });
    // group: { deletedAt: null } filter excludes the deleted group
    db.groupMember.findFirst.mockResolvedValue(null);

    await expect(getAccessibleSubject("subj-group-1", "user-1")).rejects.toThrow(NotAuthorizedError);
    expect(db.groupMember.findFirst).toHaveBeenCalledWith({
      where: {
        groupId: "group-deleted",
        userId: "user-1",
        group: { deletedAt: null },
      },
      select: { id: true },
    });
  });

  // 6. Group-scoped material access is rejected after group deletion
  it("rejects access to group-scoped material for non-owner members when the group has been soft-deleted", async () => {
    db.material.findUnique.mockResolvedValue({
      id: "mat-group-1",
      name: "Shared Group Document",
      ownerId: "user-creator",
      groupId: "group-deleted",
      workspaceId: null,
      deletedAt: null,
    });
    // user-2 is a member, but the group is soft-deleted so findFirst returns null
    db.groupMember.findFirst.mockResolvedValue(null);

    await expect(getAccessibleMaterial("mat-group-1", "user-2")).rejects.toThrow(NotAuthorizedError);
  });

  // 6b. Group-scoped material access is rejected after group deletion even for material owner (Phase 10C.1D.1)
  it("rejects access to group-scoped material for the creator/owner when the parent group has been soft-deleted", async () => {
    const groupMat = {
      id: "mat-group-1",
      name: "Shared Group Document",
      ownerId: "user-creator",
      groupId: "group-deleted",
      storageKey: "materials/user-creator/mat-group-1.pdf",
      workspaceId: null,
      deletedAt: null,
    };
    db.material.findUnique.mockResolvedValue(groupMat);
    db.material.findFirst.mockResolvedValue(groupMat);
    // Parent group is soft-deleted, so userIsGroupMember finds no active membership
    db.groupMember.findFirst.mockResolvedValue(null);

    // getAccessibleMaterial rejects creator
    await expect(getAccessibleMaterial("mat-group-1", "user-creator")).rejects.toThrow(NotAuthorizedError);

    // getAccessibleMaterialByStorageKey also rejects creator
    await expect(
      getAccessibleMaterialByStorageKey("materials/user-creator/mat-group-1.pdf", "user-creator")
    ).rejects.toThrow(NotAuthorizedError);
  });

  // 6c. Active group material access succeeds for both creator and members
  it("allows access to group-scoped material and storage key when the parent group is active", async () => {
    const groupMat = {
      id: "mat-group-active",
      name: "Active Group Document",
      ownerId: "user-creator",
      groupId: "group-active",
      storageKey: "materials/user-creator/mat-group-active.pdf",
      workspaceId: null,
      deletedAt: null,
    };
    db.material.findUnique.mockResolvedValue(groupMat);
    db.material.findFirst.mockResolvedValue(groupMat);
    db.groupMember.findFirst.mockResolvedValue({ id: "gm-active" });

    // Creator access
    await expect(getAccessibleMaterial("mat-group-active", "user-creator")).resolves.toMatchObject({
      id: "mat-group-active",
    });
    await expect(
      getAccessibleMaterialByStorageKey("materials/user-creator/mat-group-active.pdf", "user-creator")
    ).resolves.toMatchObject({ id: "mat-group-active" });

    // Non-creator member access
    await expect(getAccessibleMaterial("mat-group-active", "user-member")).resolves.toMatchObject({
      id: "mat-group-active",
    });
    await expect(
      getAccessibleMaterialByStorageKey("materials/user-creator/mat-group-active.pdf", "user-member")
    ).resolves.toMatchObject({ id: "mat-group-active" });
  });

  // 7. Active group access continues to work for all existing roles
  it("continues to correctly authorize all active roles (OWNER, ADMIN, MEMBER, VIEWER)", async () => {
    const roles: MemberRole[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

    for (const testRole of roles) {
      db.groupMember.findFirst.mockResolvedValue({
        id: `gm-${testRole}`,
        groupId: "group-active",
        userId: `user-${testRole}`,
        role: testRole,
      });
      db.group.findUnique.mockResolvedValue({
        id: "group-active",
        name: "Active Group",
        deletedAt: null,
      });

      // getGroupRole returns the role
      const fetchedRole = await getGroupRole("group-active", `user-${testRole}`);
      expect(fetchedRole).toBe(testRole);

      // requireGroupRole with minimum VIEWER succeeds for all roles
      await expect(requireGroupRole("group-active", `user-${testRole}`, "VIEWER")).resolves.toMatchObject({
        role: testRole,
      });

      // getAccessibleGroup succeeds for all roles
      await expect(getAccessibleGroup("group-active", `user-${testRole}`)).resolves.toMatchObject({
        id: "group-active",
      });
    }

    // Role hierarchy check: MEMBER/VIEWER cannot satisfy ADMIN minimum
    db.groupMember.findFirst.mockResolvedValue({
      id: "gm-member",
      groupId: "group-active",
      userId: "user-member",
      role: "MEMBER",
    });
    await expect(requireGroupRole("group-active", "user-member", "ADMIN")).rejects.toThrow(NotAuthorizedError);

    db.groupMember.findFirst.mockResolvedValue({
      id: "gm-viewer",
      groupId: "group-active",
      userId: "user-viewer",
      role: "VIEWER",
    });
    await expect(requireGroupRole("group-active", "user-viewer", "ADMIN")).rejects.toThrow(NotAuthorizedError);

    // ADMIN and OWNER satisfy ADMIN minimum
    db.groupMember.findFirst.mockResolvedValue({
      id: "gm-admin",
      groupId: "group-active",
      userId: "user-admin",
      role: "ADMIN",
    });
    await expect(requireGroupRole("group-active", "user-admin", "ADMIN")).resolves.toMatchObject({ role: "ADMIN" });

    db.groupMember.findFirst.mockResolvedValue({
      id: "gm-owner",
      groupId: "group-active",
      userId: "user-owner",
      role: "OWNER",
    });
    await expect(requireGroupRole("group-active", "user-owner", "ADMIN")).resolves.toMatchObject({ role: "OWNER" });
  });

  // 8. Personal workspace resources remain unaffected
  it("preserves access to personal workspace subjects and materials without invoking group checks", async () => {
    db.subject.findUnique.mockResolvedValue({
      id: "subj-personal",
      name: "Personal Subject",
      workspaceId: "ws-personal",
      groupId: null,
      deletedAt: null,
    });
    db.workspaceMember.findUnique.mockResolvedValue({
      workspaceId: "ws-personal",
      userId: "user-1",
    });

    const subject = await getAccessibleSubject("subj-personal", "user-1");
    expect(subject).toMatchObject({ id: "subj-personal" });
    // Group check must not be called when groupId is null
    expect(db.groupMember.findFirst).not.toHaveBeenCalled();

    // Personal material where caller is owner
    db.material.findUnique.mockResolvedValue({
      id: "mat-personal",
      name: "Personal Notes",
      ownerId: "user-1",
      groupId: null,
      workspaceId: "ws-personal",
      deletedAt: null,
    });
    const material = await getAccessibleMaterial("mat-personal", "user-1");
    expect(material).toMatchObject({ id: "mat-personal" });
    expect(db.groupMember.findFirst).not.toHaveBeenCalled();
  });

  // 9. Workspace-scoped resources remain unaffected
  it("preserves access to non-owned workspace-scoped materials via workspace membership", async () => {
    db.material.findUnique.mockResolvedValue({
      id: "mat-ws",
      name: "Workspace Shared Doc",
      ownerId: "user-creator",
      groupId: null,
      workspaceId: "ws-team",
      deletedAt: null,
    });
    db.workspaceMember.findUnique.mockResolvedValue({
      workspaceId: "ws-team",
      userId: "user-2",
    });

    const material = await getAccessibleMaterial("mat-ws", "user-2");
    expect(material).toMatchObject({ id: "mat-ws" });
    // Group check is never queried
    expect(db.groupMember.findFirst).not.toHaveBeenCalled();
  });

  // 10. Cross-group access remains rejected
  it("rejects access when a user belongs to Group A but attempts to access a subject in Group B", async () => {
    db.subject.findUnique.mockResolvedValue({
      id: "subj-b",
      name: "Group B Subject",
      groupId: "group-b",
      workspaceId: null,
      deletedAt: null,
    });
    // User belongs to group-a, not group-b
    db.groupMember.findFirst.mockImplementation(({ where }: { where: { groupId: string; userId: string; group?: { deletedAt: null } } }) => {
      if (where.groupId === "group-a" && where.userId === "user-1" && where.group?.deletedAt === null) {
        return Promise.resolve({ id: "gm-a", groupId: "group-a", userId: "user-1", role: "MEMBER" });
      }
      return Promise.resolve(null);
    });

    await expect(getAccessibleSubject("subj-b", "user-1")).rejects.toThrow(NotAuthorizedError);
  });
});

describe("Flashcard and quiz access isolation on deleted groups (Phase 10C.1D)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // 1. Creator cannot access flashcard deck attached to deleted group
  it("rejects access to a group-attached flashcard deck when the group is soft-deleted, even for the creator", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue({
      id: "deck-group-1",
      title: "Group Deck",
      ownerId: "user-creator",
      groupId: "group-deleted",
      workspaceId: null,
    });
    // groupMember.findFirst returns null because group is soft-deleted
    db.groupMember.findFirst.mockResolvedValue(null);

    await expect(getAccessibleFlashcardDeck("deck-group-1", "user-creator")).rejects.toThrow(NotAuthorizedError);
    expect(db.groupMember.findFirst).toHaveBeenCalledWith({
      where: {
        groupId: "group-deleted",
        userId: "user-creator",
        group: { deletedAt: null },
      },
      select: { id: true },
    });
  });

  // 2. Creator cannot access quiz attached to deleted group
  it("rejects access to a group-attached quiz when the group is soft-deleted, even for the creator", async () => {
    db.quiz.findUnique.mockResolvedValue({
      id: "quiz-group-1",
      title: "Group Quiz",
      ownerId: "user-creator",
      groupId: "group-deleted",
      workspaceId: null,
    });
    db.groupMember.findFirst.mockResolvedValue(null);

    await expect(getAccessibleQuiz("quiz-group-1", "user-creator")).rejects.toThrow(NotAuthorizedError);
    expect(db.groupMember.findFirst).toHaveBeenCalledWith({
      where: {
        groupId: "group-deleted",
        userId: "user-creator",
        group: { deletedAt: null },
      },
      select: { id: true },
    });
  });

  // 3. Active group owner and members can access active group flashcard deck and quiz
  it("allows active group members and creator to access active group flashcard deck and quiz", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue({
      id: "deck-active",
      title: "Active Deck",
      ownerId: "user-creator",
      groupId: "group-active",
      workspaceId: null,
    });
    db.quiz.findUnique.mockResolvedValue({
      id: "quiz-active",
      title: "Active Quiz",
      ownerId: "user-creator",
      groupId: "group-active",
      workspaceId: null,
    });
    db.groupMember.findFirst.mockResolvedValue({ id: "gm-1" });

    // Creator access
    await expect(getAccessibleFlashcardDeck("deck-active", "user-creator")).resolves.toMatchObject({ id: "deck-active" });
    await expect(getAccessibleQuiz("quiz-active", "user-creator")).resolves.toMatchObject({ id: "quiz-active" });

    // Member access
    await expect(getAccessibleFlashcardDeck("deck-active", "user-member")).resolves.toMatchObject({ id: "deck-active" });
    await expect(getAccessibleQuiz("quiz-active", "user-member")).resolves.toMatchObject({ id: "quiz-active" });
  });

  // 4. Non-member cannot access active group flashcard deck or quiz
  it("rejects non-members from accessing active group flashcard deck or quiz", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue({
      id: "deck-active",
      title: "Active Deck",
      ownerId: "user-creator",
      groupId: "group-active",
      workspaceId: null,
    });
    db.quiz.findUnique.mockResolvedValue({
      id: "quiz-active",
      title: "Active Quiz",
      ownerId: "user-creator",
      groupId: "group-active",
      workspaceId: null,
    });
    db.groupMember.findFirst.mockResolvedValue(null);

    await expect(getAccessibleFlashcardDeck("deck-active", "user-stranger")).rejects.toThrow(NotAuthorizedError);
    await expect(getAccessibleQuiz("quiz-active", "user-stranger")).rejects.toThrow(NotAuthorizedError);
  });

  // 5. Personal flashcard deck and quiz access preserved
  it("preserves access to personal flashcard decks and quizzes for the owner", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue({
      id: "deck-personal",
      title: "Personal Deck",
      ownerId: "user-1",
      groupId: null,
      workspaceId: null,
    });
    db.quiz.findUnique.mockResolvedValue({
      id: "quiz-personal",
      title: "Personal Quiz",
      ownerId: "user-1",
      groupId: null,
      workspaceId: null,
    });

    await expect(getAccessibleFlashcardDeck("deck-personal", "user-1")).resolves.toMatchObject({ id: "deck-personal" });
    await expect(getAccessibleQuiz("quiz-personal", "user-1")).resolves.toMatchObject({ id: "quiz-personal" });

    // Group check must never be called for personal resources
    expect(db.groupMember.findFirst).not.toHaveBeenCalled();
  });

  // 6. Workspace-scoped flashcard deck and quiz access preserved
  it("preserves access to workspace-scoped flashcard decks and quizzes via workspace membership", async () => {
    db.flashcardDeck.findUnique.mockResolvedValue({
      id: "deck-ws",
      title: "Workspace Deck",
      ownerId: "user-creator",
      groupId: null,
      workspaceId: "ws-team",
    });
    db.quiz.findUnique.mockResolvedValue({
      id: "quiz-ws",
      title: "Workspace Quiz",
      ownerId: "user-creator",
      groupId: null,
      workspaceId: "ws-team",
    });
    db.workspaceMember.findUnique.mockResolvedValue({
      workspaceId: "ws-team",
      userId: "user-colleague",
    });

    await expect(getAccessibleFlashcardDeck("deck-ws", "user-colleague")).resolves.toMatchObject({ id: "deck-ws" });
    await expect(getAccessibleQuiz("quiz-ws", "user-colleague")).resolves.toMatchObject({ id: "quiz-ws" });
    expect(db.groupMember.findFirst).not.toHaveBeenCalled();
  });
});

