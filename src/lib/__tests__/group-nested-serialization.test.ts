import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  group: { update: vi.fn(), findFirst: vi.fn() },
  groupMember: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  user: { findUnique: vi.fn() },
  subject: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  chapter: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  topic: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  note: { findFirst: vi.fn(), create: vi.fn() },
  flashcardDeck: { update: vi.fn(), delete: vi.fn() },
  flashcard: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  material: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  subscription: { findUnique: vi.fn() },
  groupInvitation: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  activityLog: { create: vi.fn() },
  notification: { create: vi.fn(), createMany: vi.fn() },
  $executeRaw: vi.fn(),
}));

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  chapter: { findFirst: vi.fn(), create: vi.fn() },
  topic: { findFirst: vi.fn(), create: vi.fn() },
  groupMember: { findUnique: vi.fn(), findFirst: vi.fn() },
  groupInvitation: { findUnique: vi.fn() },
  material: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleSubject: vi.fn(),
  getAccessibleChapter: vi.fn(),
  getAccessibleGroup: vi.fn(),
  getAccessibleFlashcardDeck: vi.fn(),
  getGroupRole: vi.fn(),
  requireGroupRole: vi.fn(),
  assertSubjectManageAccess: vi.fn(),
  findUserByNormalizedEmail: vi.fn(),
}));
vi.mock("@/lib/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access")>();
  return {
    ...actual,
    getSessionUser: access.getSessionUser,
    getAccessibleSubject: access.getAccessibleSubject,
    getAccessibleChapter: access.getAccessibleChapter,
    getAccessibleGroup: access.getAccessibleGroup,
    getAccessibleFlashcardDeck: access.getAccessibleFlashcardDeck,
    getGroupRole: access.getGroupRole,
    requireGroupRole: access.requireGroupRole,
    assertSubjectManageAccess: access.assertSubjectManageAccess,
    findUserByNormalizedEmail: access.findUserByNormalizedEmail,
  };
});

vi.mock("@/lib/activity", () => ({
  createActivityLog: vi.fn().mockResolvedValue(undefined),
  ActivityAction: {
    MEMBER_INVITED: "member.invited",
    INVITATION_CANCELLED: "invitation.cancelled",
    INVITATION_RESENT: "invitation.resent",
    MEMBER_ROLE_CHANGED: "member.role_changed",
    MEMBER_REMOVED: "member.removed",
    MEMBER_LEFT: "member.left",
    SUBJECT_UPDATED: "subject.updated",
    MATERIAL_ADDED: "material.added",
  },
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue({ count: 0 }),
  getGroupAdminUserIds: vi.fn().mockResolvedValue([]),
}));

const storageMocks = vi.hoisted(() => ({
  getStorageService: vi.fn(),
  getStorageUsage: vi.fn(),
  queueDocumentExtractionIfNeeded: vi.fn(),
}));
vi.mock("@/lib/services/storage", () => ({
  getStorageService: storageMocks.getStorageService,
}));
vi.mock("@/lib/storage-usage", () => ({
  getStorageUsage: storageMocks.getStorageUsage,
}));
vi.mock("@/lib/document-extraction", () => ({
  queueDocumentExtractionIfNeeded: storageMocks.queueDocumentExtractionIfNeeded,
  cancelActiveDocumentExtractionForMaterial: vi.fn(),
}));

import { POST as createChapter } from "@/app/api/subjects/[subjectId]/chapters/route";
import { PATCH as updateSubject } from "@/app/api/subjects/[subjectId]/route";
import { POST as createTopic } from "@/app/api/chapters/[chapterId]/topics/route";
import { PATCH as updateGroup } from "@/app/api/groups/[groupId]/route";
import { POST as createInvitation } from "@/app/api/groups/[groupId]/invitations/route";
import { DELETE as cancelInvitation } from "@/app/api/groups/[groupId]/invitations/[invitationId]/route";
import { POST as resendInvitation } from "@/app/api/groups/[groupId]/invitations/[invitationId]/resend/route";
import {
  PATCH as updateMemberRole,
  DELETE as removeMember,
} from "@/app/api/groups/[groupId]/members/[userId]/route";
import { PATCH as updateDeck } from "@/app/api/flashcards/[deckId]/route";
import { POST as createCard } from "@/app/api/flashcards/[deckId]/cards/route";
import { POST as completeMaterialUpload } from "@/app/api/materials/[materialId]/complete/route";
import { PUT as uploadLocalBytes } from "@/app/api/storage/upload/route";
import { LocalStorageService } from "@/lib/services/storage-local";
import { S3StorageService } from "@/lib/services/storage-s3";
import { getOrCreateTopicNote } from "@/lib/notes";
import { assertActiveHierarchyScopeWithinTx, ScopeNotFoundError } from "@/lib/materials-scope";
import { NotAuthorizedError } from "@/lib/access";

describe("Nested Group Resource Creation, In-Transaction RBAC & Side-Effect Serialization (Phase 2 LIM-01)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1", name: "Alice", email: "alice@example.com" });
    db.$transaction.mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx));
  });

  it("POST /api/subjects/[subjectId]/chapters acquires FOR SHARE on parent group and aborts on deleted group", async () => {
    access.getAccessibleSubject.mockResolvedValue({ id: "subj-1", groupId: "grp-1" });
    tx.$queryRaw.mockResolvedValue([{ id: "grp-1", deletedAt: new Date() }]);

    const req = new Request("https://example.test/api/subjects/subj-1/chapters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Chapter 1" }),
    });

    const res = await createChapter(req, { params: { subjectId: "subj-1" } });
    expect(res.status).toBe(403);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const sqlCall = tx.$queryRaw.mock.calls[0]![0];
    expect(Array.isArray(sqlCall) ? sqlCall.join("?") : String(sqlCall)).toContain("FOR SHARE");
    expect(tx.chapter.create).not.toHaveBeenCalled();
  });

  it("POST /api/chapters/[chapterId]/topics acquires FOR SHARE on parent group and creates inside transaction when active", async () => {
    access.getAccessibleChapter.mockResolvedValue({
      id: "chap-1",
      subject: { id: "subj-1", groupId: "grp-1" },
    });
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        return [{ id: "gm-1", groupId: "grp-1", userId: "user-1", role: "MEMBER", joinedAt: new Date() }];
      }
      return [{ id: "grp-1", deletedAt: null }];
    });
    tx.chapter.findFirst.mockResolvedValue({ id: "chap-1" });
    tx.topic.findFirst.mockResolvedValue({ order: 2 });
    tx.topic.create.mockResolvedValue({ id: "top-new", chapterId: "chap-1", name: "Topic 3", order: 3 });

    const req = new Request("https://example.test/api/chapters/chap-1/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Topic 3" }),
    });

    const res = await createTopic(req, { params: { chapterId: "chap-1" } });
    expect(res.status).toBe(201);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.topic.create).toHaveBeenCalledWith({
      data: { name: "Topic 3", chapterId: "chap-1", order: 3 },
    });
  });

  it("POST /api/groups/[groupId]/invitations acquires FOR SHARE lock and rejects if group was deleted or actor demoted concurrently", async () => {
    access.getAccessibleGroup.mockResolvedValue({ id: "grp-1", name: "Study Group" });
    access.requireGroupRole.mockResolvedValue({ id: "gm-1", role: "ADMIN" });
    access.findUserByNormalizedEmail.mockResolvedValue(null);
    // Actor was concurrently demoted from ADMIN to MEMBER before tx lock acquisition
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        return [{ id: "gm-1", groupId: "grp-1", userId: "user-1", role: "MEMBER", joinedAt: new Date() }];
      }
      return [{ id: "grp-1", deletedAt: null }];
    });

    const req = new Request("https://example.test/api/groups/grp-1/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invitee@example.com", role: "MEMBER" }),
    });

    const res = await createInvitation(req, { params: { groupId: "grp-1" } });
    expect(res.status).toBe(403);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.groupInvitation.create).not.toHaveBeenCalled();
  });

  it("DELETE /api/groups/[groupId]/invitations/[invitationId] revalidates ADMIN+ role and PENDING status inside transaction", async () => {
    access.getAccessibleGroup.mockResolvedValue({ id: "grp-1", name: "Study Group" });
    access.requireGroupRole.mockResolvedValue({ id: "gm-1", role: "ADMIN" });
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      groupId: "grp-1",
      email: "invitee@example.com",
      role: "MEMBER",
      status: "PENDING",
    });

    // Case A: Actor concurrently demoted from ADMIN to MEMBER inside transaction
    let actorRole = "MEMBER";
    let invStatus = "ACCEPTED";
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        return [{ id: "gm-1", groupId: "grp-1", userId: "user-1", role: actorRole, joinedAt: new Date() }];
      }
      if (sql.includes('FROM "GroupInvitation"')) {
        return [{
          id: "inv-1",
          groupId: "grp-1",
          email: "invitee@example.com",
          role: "MEMBER",
          status: invStatus,
          token: "tok-1",
          expiresAt: new Date(Date.now() + 60_000),
        }];
      }
      return [{ id: "grp-1", deletedAt: null }];
    });

    const reqA = new Request("https://example.test/api/groups/grp-1/invitations/inv-1", {
      method: "DELETE",
    });
    const resA = await cancelInvitation(reqA, { params: { groupId: "grp-1", invitationId: "inv-1" } });
    expect(resA.status).toBe(403);
    expect(tx.groupInvitation.update).not.toHaveBeenCalled();

    // Case B: Actor is still ADMIN, but invitation was concurrently accepted
    actorRole = "ADMIN";
    invStatus = "ACCEPTED";

    const reqB = new Request("https://example.test/api/groups/grp-1/invitations/inv-1", {
      method: "DELETE",
    });
    const resB = await cancelInvitation(reqB, { params: { groupId: "grp-1", invitationId: "inv-1" } });
    expect(resB.status).toBe(409);
    expect(tx.groupInvitation.update).not.toHaveBeenCalled();
  });

  it("POST /api/groups/[groupId]/invitations/[invitationId]/resend revalidates ADMIN+ role and PENDING status inside transaction", async () => {
    access.getAccessibleGroup.mockResolvedValue({ id: "grp-1", name: "Study Group" });
    access.requireGroupRole.mockResolvedValue({ id: "gm-1", role: "ADMIN" });
    access.findUserByNormalizedEmail.mockResolvedValue(null);
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      groupId: "grp-1",
      email: "invitee@example.com",
      role: "MEMBER",
      status: "PENDING",
    });

    // Case A: Actor concurrently demoted from ADMIN to VIEWER inside transaction
    let actorRole = "VIEWER";
    let invStatus = "CANCELLED";
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        return [{ id: "gm-1", groupId: "grp-1", userId: "user-1", role: actorRole, joinedAt: new Date() }];
      }
      if (sql.includes('FROM "GroupInvitation"')) {
        return [{
          id: "inv-1",
          groupId: "grp-1",
          email: "invitee@example.com",
          role: "MEMBER",
          status: invStatus,
          token: "tok-1",
          expiresAt: new Date(Date.now() + 60_000),
        }];
      }
      return [{ id: "grp-1", deletedAt: null }];
    });

    const req = new Request("https://example.test/api/groups/grp-1/invitations/inv-1/resend", {
      method: "POST",
    });
    const res = await resendInvitation(req, { params: { groupId: "grp-1", invitationId: "inv-1" } });
    expect(res.status).toBe(403);
    expect(tx.groupInvitation.update).not.toHaveBeenCalled();

    // Case B: Actor is ADMIN, but invitation was concurrently cancelled inside transaction
    actorRole = "ADMIN";
    invStatus = "CANCELLED";
    const res2 = await resendInvitation(req, { params: { groupId: "grp-1", invitationId: "inv-1" } });
    expect(res2.status).toBe(409);
    expect(tx.groupInvitation.update).not.toHaveBeenCalled();
  });

  it("PATCH and DELETE /api/groups/[groupId]/members/[userId] revalidate actor role inside transaction to block concurrent demotion races", async () => {
    access.getAccessibleGroup.mockResolvedValue({ id: "grp-1", name: "Study Group" });
    // Pre-transaction read saw actor as ADMIN
    access.getGroupRole.mockResolvedValue("ADMIN");
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, _groupId: string, targetUserId?: string) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        if (targetUserId === "user-1") {
          return [{ id: "gm-actor", groupId: "grp-1", userId: "user-1", role: "MEMBER", joinedAt: new Date() }];
        }
        return [{ id: "gm-target", groupId: "grp-1", userId: "user-2", role: "VIEWER", joinedAt: new Date() }];
      }
      return [{ id: "grp-1", deletedAt: null }];
    });

    const patchReq = new Request("https://example.test/api/groups/grp-1/members/user-2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "MEMBER" }),
    });
    const patchRes = await updateMemberRole(patchReq, {
      params: { groupId: "grp-1", userId: "user-2" },
    });
    expect(patchRes.status).toBe(403);
    expect(tx.groupMember.update).not.toHaveBeenCalled();

    const deleteOtherReq = new Request("https://example.test/api/groups/grp-1/members/user-2", {
      method: "DELETE",
    });
    const deleteOtherRes = await removeMember(deleteOtherReq, {
      params: { groupId: "grp-1", userId: "user-2" },
    });
    expect(deleteOtherRes.status).toBe(403);
    expect(tx.groupMember.delete).not.toHaveBeenCalled();
  });

  it("PATCH /api/groups/[groupId], PATCH /api/subjects/[subjectId], PATCH /api/flashcards/[deckId], and POST /api/flashcards/[deckId]/cards revalidate ADMIN+ inside transaction", async () => {
    access.getAccessibleGroup.mockResolvedValue({ id: "grp-1", name: "Study Group" });
    access.requireGroupRole.mockResolvedValue({ id: "gm-1", role: "ADMIN" });
    access.getAccessibleSubject.mockResolvedValue({ id: "subj-1", name: "Subj", groupId: "grp-1" });
    access.assertSubjectManageAccess.mockResolvedValue(undefined);
    access.getAccessibleFlashcardDeck.mockResolvedValue({
      id: "deck-1",
      title: "Group Deck",
      ownerId: "other-owner",
      groupId: "grp-1",
    });

    // Actor was concurrently demoted from ADMIN to MEMBER inside the transaction
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        return [{ id: "gm-1", groupId: "grp-1", userId: "user-1", role: "MEMBER", joinedAt: new Date() }];
      }
      return [{ id: "grp-1", deletedAt: null }];
    });

    const grpRes = await updateGroup(
      new Request("https://example.test/api/groups/grp-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
      { params: { groupId: "grp-1" } }
    );
    expect(grpRes.status).toBe(403);
    expect(tx.group.update).not.toHaveBeenCalled();

    const subjRes = await updateSubject(
      new Request("https://example.test/api/subjects/subj-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed Subject" }),
      }),
      { params: { subjectId: "subj-1" } }
    );
    expect(subjRes.status).toBe(403);
    expect(tx.subject.update).not.toHaveBeenCalled();

    const deckRes = await updateDeck(
      new Request("https://example.test/api/flashcards/deck-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed Deck" }),
      }),
      { params: { deckId: "deck-1" } }
    );
    expect(deckRes.status).toBe(403);
    expect(tx.flashcardDeck.update).not.toHaveBeenCalled();

    const cardRes = await createCard(
      new Request("https://example.test/api/flashcards/deck-1/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: "Q", back: "A" }),
      }),
      { params: { deckId: "deck-1" } }
    );
    expect(cardRes.status).toBe(403);
    expect(tx.flashcard.create).not.toHaveBeenCalled();
  });

  it("getOrCreateTopicNote acquires Group FOR SHARE BEFORE per-topic advisory lock (top-down lock hierarchy) and aborts on deleted group", async () => {
    const lockOrder: string[] = [];
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        lockOrder.push("group_member_for_share");
        return [{ id: "gm-1", groupId: "grp-1", userId: "user-1", role: "MEMBER", joinedAt: new Date() }];
      }
      lockOrder.push("group_for_share");
      return [{ id: "grp-1", deletedAt: null }];
    });
    tx.$executeRaw.mockImplementation(async () => {
      lockOrder.push("topic_advisory_lock");
      return 1;
    });
    tx.topic.findUnique.mockResolvedValue({
      id: "top-1",
      name: "Topic 1",
      deletedAt: null,
      chapter: {
        deletedAt: null,
        subject: {
          deletedAt: null,
          groupId: "grp-1",
        },
      },
    });
    tx.note.findFirst.mockResolvedValue(null);
    tx.note.create.mockResolvedValue({ id: "note-1", title: "Topic 1", plainText: "Topic 1", blocks: [] });

    await getOrCreateTopicNote({ id: "top-1", name: "Topic 1" }, "user-1", {
      tx: tx as never,
      deferIndexSync: true,
    });

    expect(lockOrder).toEqual(["group_for_share", "group_member_for_share", "topic_advisory_lock"]);

    // Also verify abort when group is soft-deleted
    tx.$queryRaw.mockResolvedValueOnce([{ id: "grp-1", deletedAt: new Date() }]);
    tx.note.create.mockClear();
    await expect(
      getOrCreateTopicNote({ id: "top-1", name: "Topic 1" }, "user-1", { tx: tx as never })
    ).rejects.toThrow(NotAuthorizedError);
    expect(tx.note.create).not.toHaveBeenCalled();
  });

  it("assertActiveHierarchyScopeWithinTx rejects material creation if target topic/chapter/subject was soft-deleted concurrently", async () => {
    tx.topic.findUnique.mockResolvedValue({
      id: "top-1",
      deletedAt: null,
      chapter: {
        deletedAt: new Date(),
        subject: { deletedAt: null },
      },
    });

    await expect(
      assertActiveHierarchyScopeWithinTx(tx as never, {
        subjectId: "subj-1",
        chapterId: "chap-1",
        topicId: "top-1",
      })
    ).rejects.toThrow(ScopeNotFoundError);
  });

  it("POST /api/materials/[materialId]/complete deletes orphaned S3 object and returns 404 when material or parent group was deleted during upload", async () => {
    const s3 = Object.create(S3StorageService.prototype) as S3StorageService;
    s3.headObject = vi.fn().mockResolvedValue({ sizeBytes: 1024 * 1024 });
    s3.deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue(s3);
    storageMocks.getStorageUsage.mockResolvedValue({
      plan: { maxFileSizeBytes: 25 * 1024 * 1024 },
      remainingBytes: 100 * 1024 * 1024,
    });

    // Case A: Material itself was soft-deleted by concurrent group deletion while upload was in flight
    db.material.findUnique.mockResolvedValueOnce({
      id: "mat-del-1",
      ownerId: "user-1",
      groupId: "grp-1",
      status: "UPLOADING",
      storageKey: "materials/user-1/mat-del-1.pdf",
      type: "PDF",
      deletedAt: new Date(),
    });
    db.material.updateMany.mockResolvedValue({ count: 1 });

    const resA = await completeMaterialUpload(
      new Request("https://example.test/api/materials/mat-del-1/complete", { method: "POST" }),
      { params: { materialId: "mat-del-1" } }
    );
    expect(resA.status).toBe(404);
    expect(s3.deleteObject).toHaveBeenCalledWith("materials/user-1/mat-del-1.pdf");
    expect(storageMocks.queueDocumentExtractionIfNeeded).not.toHaveBeenCalled();

    // Case B: Material was read before group deletion, then inside settleUploadAtomicallyWithQuota FOR SHARE sees deleted group
    vi.mocked(s3.deleteObject).mockClear();
    db.material.findUnique.mockResolvedValueOnce({
      id: "mat-del-2",
      ownerId: "user-1",
      groupId: "grp-1",
      status: "UPLOADING",
      storageKey: "materials/user-1/mat-del-2.pdf",
      type: "PDF",
      deletedAt: null,
    });
    tx.$queryRaw.mockResolvedValueOnce([{ id: "grp-1", deletedAt: new Date() }]);
    tx.material.updateMany.mockResolvedValue({ count: 1 });

    const resB = await completeMaterialUpload(
      new Request("https://example.test/api/materials/mat-del-2/complete", { method: "POST" }),
      { params: { materialId: "mat-del-2" } }
    );
    expect(resB.status).toBe(404);
    expect(s3.deleteObject).toHaveBeenCalledWith("materials/user-1/mat-del-2.pdf");
    expect(tx.material.updateMany).toHaveBeenCalledWith({
      where: { id: "mat-del-2", status: "UPLOADING" },
      data: { status: "FAILED" },
    });
    expect(storageMocks.queueDocumentExtractionIfNeeded).not.toHaveBeenCalled();
  });

  it("PUT /api/storage/upload deletes orphaned local file and returns 404 if material was concurrently soft-deleted during write", async () => {
    const local = Object.create(LocalStorageService.prototype) as LocalStorageService;
    local.writeFile = vi.fn().mockResolvedValue(undefined);
    local.deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue(local);
    storageMocks.getStorageUsage.mockResolvedValue({
      plan: { maxFileSizeBytes: 25 * 1024 * 1024 },
      remainingBytes: 100 * 1024 * 1024,
    });

    db.material.findFirst.mockResolvedValueOnce({
      id: "mat-local-1",
      ownerId: "user-1",
      groupId: "grp-1",
      status: "UPLOADING",
      storageKey: "materials/user-1/mat-local-1.pdf",
      deletedAt: null,
    });
    db.groupMember.findFirst.mockResolvedValueOnce({ id: "gm-1" });
    // Simulate concurrent deletion between writeFile and conditional updateMany (count: 0)
    db.material.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await uploadLocalBytes(
      new Request(
        "https://example.test/api/storage/upload?key=materials%2Fuser-1%2Fmat-local-1.pdf",
        {
          method: "PUT",
          body: new Uint8Array([1, 2, 3, 4]),
        }
      )
    );
    expect(res.status).toBe(404);
    expect(local.writeFile).toHaveBeenCalledTimes(1);
    expect(local.deleteObject).toHaveBeenCalledWith("materials/user-1/mat-local-1.pdf");
  });

  it("POST /api/materials/[materialId]/complete acquires Group FOR SHARE -> GroupMember FOR SHARE -> quota advisory lock and rejects removed group members with 403", async () => {
    const s3 = Object.create(S3StorageService.prototype) as S3StorageService;
    s3.headObject = vi.fn().mockResolvedValue({ sizeBytes: 1024 });
    s3.deleteObject = vi.fn().mockResolvedValue(undefined);
    storageMocks.getStorageService.mockReturnValue(s3);
    storageMocks.getStorageUsage.mockResolvedValue({
      plan: { maxFileSizeBytes: 25 * 1024 * 1024 },
      remainingBytes: 100 * 1024 * 1024,
    });

    db.material.findUnique.mockResolvedValueOnce({
      id: "mat-grp-mem-removed",
      ownerId: "user-1",
      groupId: "grp-1",
      status: "UPLOADING",
      storageKey: "materials/user-1/mat-grp-mem-removed.pdf",
      type: "PDF",
      deletedAt: null,
    });

    const lockSeq: string[] = [];
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        lockSeq.push("group_member_for_share");
        return []; // Removed from group concurrently!
      }
      lockSeq.push("group_for_share");
      return [{ id: "grp-1", deletedAt: null }];
    });
    tx.$executeRaw.mockImplementation(async () => {
      lockSeq.push("quota_advisory");
      return 1;
    });
    tx.material.updateMany.mockResolvedValue({ count: 1 });

    const res = await completeMaterialUpload(
      new Request("https://example.test/api/materials/mat-grp-mem-removed/complete", { method: "POST" }),
      { params: { materialId: "mat-grp-mem-removed" } }
    );

    expect(res.status).toBe(403);
    expect(lockSeq).toEqual(["group_for_share", "group_member_for_share"]);
    expect(s3.deleteObject).toHaveBeenCalledWith("materials/user-1/mat-grp-mem-removed.pdf");
    expect(tx.material.updateMany).toHaveBeenCalledWith({
      where: { id: "mat-grp-mem-removed", status: "UPLOADING" },
      data: { status: "FAILED" },
    });
    expect(storageMocks.queueDocumentExtractionIfNeeded).not.toHaveBeenCalled();
  });
});
