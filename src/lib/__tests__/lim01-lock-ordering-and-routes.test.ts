import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  user: { findUnique: vi.fn() },
  groupInvitation: { findUnique: vi.fn(), updateMany: vi.fn() },
  groupMember: { findMany: vi.fn() },
  activityLog: { create: vi.fn() },
  notification: { create: vi.fn(), createMany: vi.fn() },
  material: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  topic: { findUnique: vi.fn() },
  processingJob: { updateMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  note: { findUnique: vi.fn(), update: vi.fn() },
  noteBlock: { findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  noteVersion: { create: vi.fn(), findFirst: vi.fn() },
  noteChunk: { deleteMany: vi.fn() },
}));

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  groupInvitation: { findUnique: vi.fn() },
  material: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const accessMocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleNote: vi.fn(),
  getAccessibleMaterial: vi.fn(),
  getPrimaryWorkspace: vi.fn(),
}));

vi.mock("@/lib/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access")>();
  return {
    ...actual,
    getSessionUser: accessMocks.getSessionUser,
    getAccessibleNote: accessMocks.getAccessibleNote,
    getAccessibleMaterial: accessMocks.getAccessibleMaterial,
    getPrimaryWorkspace: accessMocks.getPrimaryWorkspace,
  };
});

vi.mock("@/lib/activity", () => ({
  createActivityLog: vi.fn().mockResolvedValue(undefined),
  ActivityAction: {
    INVITATION_DECLINED: "invitation.declined",
    MATERIAL_REMOVED: "material.removed",
  },
}));

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue({ count: 0 }),
  getGroupAdminUserIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/search/note-embedding", () => ({
  syncNoteSearchIndex: vi.fn().mockResolvedValue(undefined),
  deleteNoteChunks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/services/storage", () => ({
  getStorageService: vi.fn().mockReturnValue({ deleteObject: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/lib/document-extraction", () => ({
  cancelActiveDocumentExtractionForMaterial: vi.fn(),
}));

const scopeMocks = vi.hoisted(() => ({
  resolveMaterialScope: vi.fn(),
}));

vi.mock("@/lib/materials-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/materials-scope")>();
  return {
    ...actual,
    resolveMaterialScope: scopeMocks.resolveMaterialScope,
  };
});

import { lockGroupMembersForUpdate, NotAuthorizedError } from "@/lib/access";
import { completeJobWithin, createJobIfNoneActiveWithin } from "@/lib/processing-jobs";
import { POST as declineInvitation } from "@/app/api/invitations/[token]/decline/route";
import { PATCH as patchMaterial } from "@/app/api/materials/[materialId]/route";
import { PATCH as patchNote, DELETE as deleteNote } from "@/app/api/notes/[noteId]/route";
import { PUT as putNoteBlocks } from "@/app/api/notes/[noteId]/blocks/route";
import { POST as restoreNoteVersion } from "@/app/api/notes/[noteId]/versions/[versionId]/restore/route";

describe("LIM-01 Canonical Lock Ordering, Note Routes, Decline Route & Job Completion Guardrails", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    accessMocks.getSessionUser.mockResolvedValue({
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
    });
    accessMocks.getPrimaryWorkspace.mockResolvedValue({ id: "ws-1" });
    db.$transaction.mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx));
    tx.$executeRaw.mockResolvedValue(1);
    tx.noteBlock.findMany.mockResolvedValue([]);
    tx.noteVersion.findFirst.mockResolvedValue(null);
  });

  it("lockGroupMembersForUpdate deduplicates and locks GroupMember rows in canonical ascending userId order", async () => {
    const lockedOrder: string[] = [];
    tx.$queryRaw.mockImplementation(async (_strings: TemplateStringsArray, _groupId: string, uid: string) => {
      lockedOrder.push(uid);
      return [{ id: `gm-${uid}`, groupId: "grp-1", userId: uid, role: "ADMIN", joinedAt: new Date() }];
    });

    const locked = await lockGroupMembersForUpdate(tx as never, "grp-1", ["user-z", "user-a", "user-z", "user-m"]);
    expect(lockedOrder).toEqual(["user-a", "user-m", "user-z"]);
    expect(locked.map((m) => m.userId)).toEqual(["user-a", "user-m", "user-z"]);
  });

  it("Note PATCH, DELETE, PUT blocks, and POST restore enforce Group FOR SHARE -> advisory lock and abort on deleted group/note", async () => {
    const lockOrder: string[] = [];
    let groupDeletedAt: Date | null = null;
    let noteDeletedAt: Date | null = null;

    accessMocks.getAccessibleNote.mockResolvedValue({
      id: "note-1",
      title: "Lecture Note",
      topic: { chapter: { subject: { groupId: "grp-1" } } },
    });
    (db as unknown as { noteVersion?: { findUnique: unknown } }).noteVersion = {
      findUnique: vi.fn().mockResolvedValue({
        id: "ver-1",
        noteId: "note-1",
        snapshot: [{ id: "b1", kind: "TEXT", heading: null, content: { text: "v1" }, order: 0 }],
      }),
    } as never;

    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        lockOrder.push("member_for_share");
        return [{ id: "gm-1", groupId: "grp-1", userId: "user-1", role: "MEMBER", joinedAt: new Date() }];
      }
      lockOrder.push("group_for_share");
      return [{ id: "grp-1", deletedAt: groupDeletedAt }];
    });
    tx.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, key: string) => {
      lockOrder.push(`advisory:${key}`);
      return 1;
    });
    tx.note.findUnique.mockImplementation(async () => ({
      id: "note-1",
      deletedAt: noteDeletedAt,
      topic: { deletedAt: null, chapter: { deletedAt: null, subject: { deletedAt: null, groupId: "grp-1" } } },
    }));
    tx.note.update.mockResolvedValue({ id: "note-1", title: "Updated" });

    // Happy path ordering check for PATCH
    const okPatch = await patchNote(
      new Request("https://example.test/api/notes/note-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated" }),
      }),
      { params: { noteId: "note-1" } }
    );
    expect(okPatch.status).toBe(200);
    expect(lockOrder).toEqual(["group_for_share", "member_for_share", "advisory:note:edit:note-1"]);

    // Soft-deleted group rejects all 4 note mutations with 403 and writes nothing
    groupDeletedAt = new Date();
    const resPatchDeletedGrp = await patchNote(
      new Request("https://example.test/api/notes/note-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated 2" }),
      }),
      { params: { noteId: "note-1" } }
    );
    const resDelDeletedGrp = await deleteNote(
      new Request("https://example.test/api/notes/note-1", { method: "DELETE" }),
      { params: { noteId: "note-1" } }
    );
    const resBlocksDeletedGrp = await putNoteBlocks(
      new Request("https://example.test/api/notes/note-1/blocks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: [] }),
      }),
      { params: { noteId: "note-1" } }
    );
    const resRestoreDeletedGrp = await restoreNoteVersion(
      new Request("https://example.test/api/notes/note-1/versions/ver-1/restore", { method: "POST" }),
      { params: { noteId: "note-1", versionId: "ver-1" } }
    );

    expect([resPatchDeletedGrp.status, resDelDeletedGrp.status, resBlocksDeletedGrp.status, resRestoreDeletedGrp.status]).toEqual([
      403,
      403,
      403,
      403,
    ]);
    expect(tx.note.update).toHaveBeenCalledTimes(1); // Only the initial happy PATCH
    expect(tx.noteChunk.deleteMany).not.toHaveBeenCalled();

    // Active group, but note concurrently soft-deleted before lock completes -> 404
    groupDeletedAt = null;
    noteDeletedAt = new Date();
    const resBlocksDeletedNote = await putNoteBlocks(
      new Request("https://example.test/api/notes/note-1/blocks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: [] }),
      }),
      { params: { noteId: "note-1" } }
    );
    expect(resBlocksDeletedNote.status).toBe(404);
    expect(tx.noteBlock.deleteMany).not.toHaveBeenCalled();
  });

  it("POST /api/invitations/[token]/decline executes inside transaction with Group FOR SHARE -> GroupInvitation FOR UPDATE and marks expired invites", async () => {
    const past = new Date(Date.now() - 60_000);
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      groupId: "grp-1",
      token: "dec-tok",
      email: "alice@example.com",
      status: "PENDING",
      expiresAt: past,
    });

    const lockSeq: string[] = [];
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupInvitation"')) {
        lockSeq.push("invitation_for_update");
        return [
          {
            id: "inv-1",
            groupId: "grp-1",
            email: "alice@example.com",
            role: "MEMBER",
            status: "PENDING",
            token: "dec-tok",
            expiresAt: past,
          },
        ];
      }
      lockSeq.push("group_for_share");
      return [{ id: "grp-1", deletedAt: null }];
    });
    tx.groupInvitation.updateMany.mockResolvedValue({ count: 1 });

    const res = await declineInvitation(new Request("https://example.test", { method: "POST" }), {
      params: { token: "dec-tok" },
    });
    expect(res.status).toBe(409);
    expect(lockSeq).toEqual(["group_for_share", "invitation_for_update"]);
    expect(tx.groupInvitation.updateMany).toHaveBeenCalledWith({
      where: { token: "dec-tok", status: "PENDING" },
      data: { status: "EXPIRED" },
    });
  });

  it("completeJobWithin aborts without marking job SUCCEEDED when material ancestor hierarchy is soft-deleted", async () => {
    tx.$queryRaw.mockResolvedValue([{ id: "grp-1", deletedAt: null }]);
    tx.material.findUnique.mockResolvedValue({
      deletedAt: null,
      groupId: "grp-1",
      group: { deletedAt: null },
      subject: { deletedAt: null },
      chapter: { deletedAt: new Date(), subject: { deletedAt: null } },
      topic: null,
    });

    const completed = await completeJobWithin(tx as never, "job-1", "mat-1");
    expect(completed).toBe(false);
    expect(tx.processingJob.updateMany).not.toHaveBeenCalled();
  });

  it("PATCH /api/materials/[materialId] locks involved groupIds in ascending sorted order inside transaction", async () => {
    scopeMocks.resolveMaterialScope.mockResolvedValue({
      workspaceId: null,
      groupId: "grp-target",
      subjectId: "subj-target",
      chapterId: null,
      topicId: null,
    });
    accessMocks.getAccessibleMaterial.mockResolvedValue({
      id: "mat-1",
      groupId: "grp-zeta",
      workspaceId: null,
      deletedAt: null,
    });

    const lockedGroups: string[] = [];
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, idArg: string) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "Group"')) {
        lockedGroups.push(idArg);
        return [{ id: idArg, deletedAt: null }];
      }
      return [{ id: "gm-1", groupId: idArg, userId: "user-1", role: "MEMBER", joinedAt: new Date() }];
    });
    tx.topic.findUnique.mockResolvedValue(null);
    // Target subject exists and is active
    (tx as unknown as { subject?: { findFirst: unknown } }).subject = {
      findFirst: vi.fn().mockResolvedValue({ id: "subj-target", deletedAt: null }),
    } as never;
    tx.material.updateMany.mockResolvedValue({ count: 1 });
    tx.material.findUnique.mockResolvedValue({ id: "mat-1", groupId: "grp-target" });

    const res = await patchMaterial(
      new Request("https://example.test/api/materials/mat-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: "clh0000000000000000000009" }),
      }),
      { params: { materialId: "mat-1" } }
    );

    expect(res.status).toBe(200);
    // "grp-target" sorts strictly before "grp-zeta"
    expect(lockedGroups).toEqual(["grp-target", "grp-zeta"]);
  });

  it("createJobIfNoneActiveWithin with verifyActorMembership enforces Group FOR SHARE -> GroupMember FOR SHARE -> job advisory lock and aborts when caller membership is removed", async () => {
    const lockOrder: string[] = [];
    tx.material.findUnique.mockResolvedValue({
      deletedAt: null,
      groupId: "grp-1",
      group: { deletedAt: null },
      subject: { deletedAt: null },
      chapter: null,
      topic: null,
    });
    tx.processingJob.updateMany.mockResolvedValue({ count: 0 });
    tx.processingJob.findFirst.mockResolvedValue(null);
    tx.processingJob.create.mockResolvedValue({
      id: "job-created-1",
      userId: "user-1",
      materialId: "mat-1",
      type: "TRANSCRIPTION",
      status: "QUEUED",
    });

    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        lockOrder.push("group_member_for_share");
        return [{ id: "gm-1", groupId: "grp-1", userId: "user-1", role: "MEMBER", joinedAt: new Date() }];
      }
      lockOrder.push("group_for_share");
      return [{ id: "grp-1", deletedAt: null }];
    });
    tx.$executeRaw.mockImplementation(async (_strings: TemplateStringsArray, key: string) => {
      lockOrder.push(`advisory:${key}`);
      return 1;
    });

    const createdRes = await createJobIfNoneActiveWithin(tx as never, {
      userId: "user-1",
      materialId: "mat-1",
      type: "TRANSCRIPTION",
      verifyActorMembership: true,
    });
    expect(createdRes.created).toBe(true);
    expect(lockOrder).toEqual([
      "group_for_share",
      "group_member_for_share",
      "advisory:job:TRANSCRIPTION:mat-1",
    ]);

    // Now simulate caller concurrently removed from group before lock acquisition
    lockOrder.length = 0;
    tx.processingJob.create.mockClear();
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes('FROM "GroupMember"')) {
        lockOrder.push("group_member_for_share");
        return [];
      }
      lockOrder.push("group_for_share");
      return [{ id: "grp-1", deletedAt: null }];
    });

    await expect(
      createJobIfNoneActiveWithin(tx as never, {
        userId: "user-1",
        materialId: "mat-1",
        type: "TRANSCRIPTION",
        verifyActorMembership: true,
      })
    ).rejects.toThrow(NotAuthorizedError);
    expect(lockOrder).toEqual(["group_for_share", "group_member_for_share"]);
    expect(tx.processingJob.create).not.toHaveBeenCalled();
  });
});
