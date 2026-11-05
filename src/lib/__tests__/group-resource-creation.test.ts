import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  group: { findUnique: vi.fn(), updateMany: vi.fn() },
  groupMember: { findFirst: vi.fn() },
  subject: { create: vi.fn(), updateMany: vi.fn() },
  material: { create: vi.fn(), updateMany: vi.fn() },
  chapter: { updateMany: vi.fn() },
  topic: { updateMany: vi.fn() },
  note: { updateMany: vi.fn() },
  aIConversation: { updateMany: vi.fn() },
  groupInvitation: { updateMany: vi.fn() },
  processingJob: { updateMany: vi.fn() },
}));

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  subject: { create: vi.fn() },
  material: { create: vi.fn() },
  groupMember: { findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getPrimaryWorkspace: vi.fn(),
}));
vi.mock("@/lib/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access")>();
  return {
    ...actual,
    getSessionUser: access.getSessionUser,
    getPrimaryWorkspace: access.getPrimaryWorkspace,
  };
});

const activity = vi.hoisted(() => ({
  createActivityLog: vi.fn(),
  ActivityAction: {
    GROUP_DELETED: "group.deleted",
    SUBJECT_CREATED: "subject.created",
    MATERIAL_ADDED: "material.added",
  },
}));
vi.mock("@/lib/activity", () => activity);

const notifications = vi.hoisted(() => ({
  createNotifications: vi.fn(),
}));
vi.mock("@/lib/notifications", () => notifications);

const scope = vi.hoisted(() => ({
  resolveMaterialScope: vi.fn(),
  ScopeNotFoundError: class ScopeNotFoundError extends Error {},
}));
vi.mock("@/lib/materials-scope", () => scope);

const storage = vi.hoisted(() => ({
  getStorageService: () => ({
    createUploadUrl: vi.fn().mockResolvedValue({ uploadUrl: "https://upload.example.com" }),
  }),
}));
vi.mock("@/lib/services/storage", () => storage);

const usage = vi.hoisted(() => ({
  getStorageUsage: vi.fn().mockResolvedValue({
    plan: { maxFileSizeBytes: 50 * 1024 * 1024 },
    remainingBytes: 500 * 1024 * 1024,
  }),
}));
vi.mock("@/lib/storage-usage", () => usage);

import { POST as createSubject } from "@/app/api/subjects/route";
import { POST as createMaterial } from "@/app/api/materials/route";
import { POST as createUploadUrl } from "@/app/api/materials/upload-url/route";
import { DELETE as deleteGroup } from "@/app/api/groups/[groupId]/route";
import { lockGroupForShare, lockGroupForUpdate, assertActiveGroupMemberForCreation } from "@/lib/access";

const currentUser = { id: "user-1", name: "User One", email: "user1@example.com" };
const ownerUser = { id: "user-owner", name: "Owner User", email: "owner@example.com" };
const groupDeletedId = "clh0000000000000000000001";
const groupActiveId = "clh0000000000000000000002";
const subjectId = "clh0000000000000000000003";

describe("Group Resource Creation Serialization (Phase 10C.1D.2)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue(currentUser);
    access.getPrimaryWorkspace.mockResolvedValue({ id: "ws-primary" });
    db.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    activity.createActivityLog.mockResolvedValue(undefined);
    usage.getStorageUsage.mockResolvedValue({
      plan: { maxFileSizeBytes: 50 * 1024 * 1024 },
      remainingBytes: 500 * 1024 * 1024,
    });

    // Default: active group returns row from lock query
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes("FOR SHARE") || sql.includes("FOR UPDATE")) {
        return [{ id: groupActiveId, deletedAt: null }];
      }
      return [];
    });
  });

  describe("Lock query generation & lock mode correctness", () => {
    it("lockGroupForShare executes SELECT ... FOR SHARE on Group table", async () => {
      await lockGroupForShare(tx as unknown as Parameters<typeof lockGroupForShare>[0], groupActiveId);
      expect(tx.$queryRaw).toHaveBeenCalled();
      const call = tx.$queryRaw.mock.calls[0]![0];
      const sql = Array.isArray(call) ? call.join("?") : String(call);
      expect(sql).toContain('FROM "Group"');
      expect(sql).toContain("FOR SHARE");
    });

    it("lockGroupForUpdate executes SELECT ... FOR UPDATE on Group table", async () => {
      await lockGroupForUpdate(tx as unknown as Parameters<typeof lockGroupForUpdate>[0], groupActiveId);
      expect(tx.$queryRaw).toHaveBeenCalled();
      const call = tx.$queryRaw.mock.calls[0]![0];
      const sql = Array.isArray(call) ? call.join("?") : String(call);
      expect(sql).toContain('FROM "Group"');
      expect(sql).toContain("FOR UPDATE");
    });
  });

  describe("Fail-closed behavior when locking is unavailable or fails (Phase 10C.1D.2.1)", () => {
    it("lockGroupForShare throws Error when tx.$queryRaw is missing", async () => {
      const brokenTx = {} as unknown as Parameters<typeof lockGroupForShare>[0];
      await expect(lockGroupForShare(brokenTx, groupActiveId)).rejects.toThrow(
        "Transaction client does not support raw query locking (tx.$queryRaw is missing)."
      );
    });

    it("lockGroupForUpdate throws Error when tx.$queryRaw is missing", async () => {
      const brokenTx = {} as unknown as Parameters<typeof lockGroupForUpdate>[0];
      await expect(lockGroupForUpdate(brokenTx, groupActiveId)).rejects.toThrow(
        "Transaction client does not support raw query locking (tx.$queryRaw is missing)."
      );
    });

    it("assertActiveGroupMemberForCreation fails closed and does not proceed when tx.$queryRaw throws", async () => {
      tx.$queryRaw.mockRejectedValueOnce(new Error("Deadlock detected or lock timeout"));
      await expect(
        assertActiveGroupMemberForCreation(tx as unknown as Parameters<typeof assertActiveGroupMemberForCreation>[0], groupActiveId, currentUser.id)
      ).rejects.toThrow("Deadlock detected or lock timeout");
      expect(tx.groupMember.findFirst).not.toHaveBeenCalled();
    });

    it("POST /api/subjects fails closed when tx.$queryRaw throws a database error", async () => {
      tx.$queryRaw.mockRejectedValueOnce(new Error("Database connection lost during lock"));

      const req = new Request("https://example.test/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Math", groupId: groupActiveId }),
      });

      await expect(createSubject(req)).rejects.toThrow("Database connection lost during lock");
      expect(tx.subject.create).not.toHaveBeenCalled();
      expect(activity.createActivityLog).not.toHaveBeenCalled();
    });

    it("POST /api/materials fails closed when tx.$queryRaw throws a database error", async () => {
      scope.resolveMaterialScope.mockResolvedValue({
        workspaceId: null,
        groupId: groupActiveId,
        subjectId,
      });
      tx.$queryRaw.mockRejectedValueOnce(new Error("Database connection lost during lock"));

      const req = new Request("https://example.test/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/doc", title: "Doc", subjectId }),
      });

      await expect(createMaterial(req)).rejects.toThrow("Database connection lost during lock");
      expect(tx.material.create).not.toHaveBeenCalled();
    });

    it("POST /api/materials/upload-url fails closed when tx.$queryRaw throws a database error", async () => {
      scope.resolveMaterialScope.mockResolvedValue({
        workspaceId: null,
        groupId: groupActiveId,
        subjectId,
      });
      tx.$queryRaw.mockRejectedValueOnce(new Error("Database connection lost during lock"));

      const req = new Request("https://example.test/api/materials/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          subjectId,
        }),
      });

      await expect(createUploadUrl(req)).rejects.toThrow("Database connection lost during lock");
      expect(tx.material.create).not.toHaveBeenCalled();
    });
  });

  describe("Endpoint verification with active group", () => {
    it("POST /api/subjects acquires FOR SHARE lock and creates subject", async () => {
      tx.groupMember.findFirst.mockResolvedValue({ id: "gm-1", role: "ADMIN" });
      tx.subject.create.mockResolvedValue({ id: "subj-1", name: "Math", groupId: groupActiveId });

      const req = new Request("https://example.test/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Math", groupId: groupActiveId }),
      });

      const res = await createSubject(req);
      expect(res.status).toBe(201);
      expect(tx.$queryRaw).toHaveBeenCalled();
      const sql = tx.$queryRaw.mock.calls[0]![0];
      expect(Array.isArray(sql) ? sql.join("?") : String(sql)).toContain("FOR SHARE");
      expect(tx.subject.create).toHaveBeenCalled();
      expect(activity.createActivityLog).toHaveBeenCalled();
    });

    it("POST /api/materials acquires FOR SHARE lock and creates material link", async () => {
      scope.resolveMaterialScope.mockResolvedValue({
        workspaceId: null,
        groupId: groupActiveId,
        subjectId,
      });
      tx.groupMember.findFirst.mockResolvedValue({ id: "gm-1", role: "MEMBER" });
      tx.material.create.mockResolvedValue({ id: "mat-1", title: "Doc", groupId: groupActiveId });

      const req = new Request("https://example.test/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/doc", title: "Doc", subjectId }),
      });

      const res = await createMaterial(req);
      expect(res.status).toBe(201);
      expect(tx.$queryRaw).toHaveBeenCalled();
      const sql = tx.$queryRaw.mock.calls[0]![0];
      expect(Array.isArray(sql) ? sql.join("?") : String(sql)).toContain("FOR SHARE");
      expect(tx.material.create).toHaveBeenCalled();
    });

    it("POST /api/materials/upload-url acquires FOR SHARE lock and creates uploading material", async () => {
      scope.resolveMaterialScope.mockResolvedValue({
        workspaceId: null,
        groupId: groupActiveId,
        subjectId,
      });
      tx.groupMember.findFirst.mockResolvedValue({ id: "gm-1", role: "MEMBER" });
      tx.material.create.mockResolvedValue({ id: "mat-upload-1", title: "document", groupId: groupActiveId });

      const req = new Request("https://example.test/api/materials/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          subjectId,
        }),
      });

      const res = await createUploadUrl(req);
      expect(res.status).toBe(200);
      expect(tx.$queryRaw).toHaveBeenCalled();
      const sql = tx.$queryRaw.mock.calls[0]![0];
      expect(Array.isArray(sql) ? sql.join("?") : String(sql)).toContain("FOR SHARE");
      expect(tx.material.create).toHaveBeenCalled();
    });
  });

  describe("Rejection when parent group is soft-deleted", () => {
    beforeEach(() => {
      // Simulate lock query finding row with deletedAt timestamp
      tx.$queryRaw.mockResolvedValue([{ id: groupDeletedId, deletedAt: new Date() }]);
    });

    it("POST /api/subjects rejects creation when group is deleted", async () => {
      const req = new Request("https://example.test/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Math", groupId: groupDeletedId }),
      });

      const res = await createSubject(req);
      expect(res.status).toBe(403);
      expect(tx.subject.create).not.toHaveBeenCalled();
    });

    it("POST /api/materials rejects creation when group is deleted", async () => {
      scope.resolveMaterialScope.mockResolvedValue({
        workspaceId: null,
        groupId: groupDeletedId,
        subjectId,
      });

      const req = new Request("https://example.test/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/doc", title: "Doc", subjectId }),
      });

      const res = await createMaterial(req);
      expect(res.status).toBe(403);
      expect(tx.material.create).not.toHaveBeenCalled();
    });

    it("POST /api/materials/upload-url rejects creation when group is deleted", async () => {
      scope.resolveMaterialScope.mockResolvedValue({
        workspaceId: null,
        groupId: groupDeletedId,
        subjectId,
      });

      const req = new Request("https://example.test/api/materials/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          subjectId,
        }),
      });

      const res = await createUploadUrl(req);
      expect(res.status).toBe(403);
      expect(tx.material.create).not.toHaveBeenCalled();
    });
  });

  describe("Personal and workspace-scoped creation remains unaffected", () => {
    it("POST /api/subjects without groupId does not acquire group lock", async () => {
      db.subject.create.mockResolvedValue({ id: "subj-ws", name: "Personal Math", workspaceId: "ws-primary" });

      const req = new Request("https://example.test/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Personal Math" }),
      });

      const res = await createSubject(req);
      expect(res.status).toBe(201);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(db.subject.create).toHaveBeenCalled();
    });

    it("POST /api/materials with workspace scope does not acquire group lock", async () => {
      scope.resolveMaterialScope.mockResolvedValue({
        workspaceId: "ws-primary",
        groupId: null,
        subjectId: null,
        chapterId: null,
        topicId: null,
      });
      tx.material.create.mockResolvedValue({ id: "mat-ws", title: "Personal Link", workspaceId: "ws-primary" });

      const req = new Request("https://example.test/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/doc", title: "Personal Link" }),
      });

      const res = await createMaterial(req);
      expect(res.status).toBe(201);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.material.create).toHaveBeenCalled();
    });

    it("POST /api/materials/upload-url with workspace scope does not acquire group lock", async () => {
      scope.resolveMaterialScope.mockResolvedValue({
        workspaceId: "ws-primary",
        groupId: null,
        subjectId: null,
        chapterId: null,
        topicId: null,
      });
      tx.material.create.mockResolvedValue({ id: "mat-upload-ws", title: "Personal Doc", workspaceId: "ws-primary" });

      const req = new Request("https://example.test/api/materials/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "doc.pdf",
          mimeType: "application/pdf",
          sizeBytes: 512,
        }),
      });

      const res = await createUploadUrl(req);
      expect(res.status).toBe(200);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.material.create).toHaveBeenCalled();
    });
  });

  describe("Ordering A: Resource Creation acquires lock first, Deletion waits", () => {
    it("Subject creation obtains FOR SHARE lock first; Deletion waits on FOR UPDATE, then cascades to new subject", async () => {
      const executionOrder: string[] = [];

      let resolveCreationCommit!: () => void;
      const creationCommitSignal = new Promise<void>((resolve) => {
        resolveCreationCommit = resolve;
      });

      tx.group.findUnique.mockResolvedValue({
        id: groupActiveId,
        name: "Study Group",
        deletedAt: null,
        members: [{ userId: "user-owner", role: "OWNER" }],
      });
      tx.group.updateMany.mockImplementation(async () => {
        executionOrder.push("deletion:group_deleted");
        return { count: 1 };
      });
      tx.groupMember.findFirst.mockResolvedValue({ id: "gm-1", role: "ADMIN" });
      tx.subject.create.mockImplementation(async () => {
        executionOrder.push("creation:subject_created");
        return { id: "subj-new", name: "New Subj", groupId: groupActiveId };
      });
      tx.subject.updateMany.mockImplementation(async () => {
        executionOrder.push("deletion:subjects_soft_deleted");
        return { count: 1 };
      });

      tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("FOR SHARE")) {
          executionOrder.push("creation:lock_acquired");
          return [{ id: groupActiveId, deletedAt: null }];
        }
        if (sql.includes("FOR UPDATE")) {
          executionOrder.push("deletion:lock_requested");
          await creationCommitSignal;
          executionOrder.push("deletion:lock_acquired");
          return [{ id: groupActiveId, deletedAt: null }];
        }
        return [];
      });

      db.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) => {
        const result = await cb(tx);
        if (executionOrder.includes("creation:subject_created") && !executionOrder.includes("creation:committed")) {
          executionOrder.push("creation:committed");
          resolveCreationCommit();
        }
        return result;
      });

      access.getSessionUser.mockImplementation(async () => currentUser);

      const creationReq = new Request("https://example.test/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Math", groupId: groupActiveId }),
      });

      // 1. Start creation
      const creationPromise = createSubject(creationReq);

      // Wait a tick so creation enters transaction and acquires FOR SHARE
      await new Promise((r) => setTimeout(r, 10));

      // 2. Start deletion with owner user
      access.getSessionUser.mockImplementation(async () => ownerUser);
      const deletionReq = new Request(`https://example.test/api/groups/${groupActiveId}`, { method: "DELETE" });
      const deletionPromise = deleteGroup(deletionReq, { params: { groupId: groupActiveId } });

      const [creationRes, deletionRes] = await Promise.all([creationPromise, deletionPromise]);

      expect(creationRes.status).toBe(201);
      expect(deletionRes.status).toBe(200);

      // Verify execution order: creation finished and committed before deletion acquired lock and cascaded
      expect(executionOrder).toEqual([
        "creation:lock_acquired",
        "creation:subject_created",
        "creation:committed",
        "deletion:lock_requested",
        "deletion:lock_acquired",
        "deletion:group_deleted",
        "deletion:subjects_soft_deleted",
      ]);

      // Deletion cascade was called with the target groupId, catching the new subject
      expect(tx.subject.updateMany).toHaveBeenCalledWith({
        where: { groupId: groupActiveId, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });

  describe("Ordering B: Group Deletion acquires lock first, Creation waits and rejects", () => {
    it("Deletion obtains FOR UPDATE lock first; Subject creation waits on lock, sees deletedAt, and rejects with 403", async () => {
      const executionOrder: string[] = [];

      let resolveDeletionCommit!: () => void;
      const deletionCommitSignal = new Promise<void>((resolve) => {
        resolveDeletionCommit = resolve;
      });

      const deletionTimestamp = new Date();

      tx.group.findUnique.mockResolvedValue({
        id: groupActiveId,
        name: "Study Group",
        deletedAt: null,
        members: [{ userId: "user-owner", role: "OWNER" }],
      });
      tx.group.updateMany.mockImplementation(async () => {
        executionOrder.push("deletion:group_deleted");
        return { count: 1 };
      });
      tx.groupMember.findFirst.mockResolvedValue({ id: "gm-1", role: "ADMIN" });
      tx.subject.create.mockImplementation(async () => {
        executionOrder.push("creation:subject_created");
        return { id: "subj-new", name: "New Subj", groupId: groupActiveId };
      });

      tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("FOR UPDATE")) {
          executionOrder.push("deletion:lock_acquired");
          return [{ id: groupActiveId, deletedAt: null }];
        }
        if (sql.includes("FOR SHARE")) {
          executionOrder.push("creation:lock_requested");
          await deletionCommitSignal;
          executionOrder.push("creation:lock_acquired_sees_deleted");
          return [{ id: groupActiveId, deletedAt: deletionTimestamp }];
        }
        return [];
      });

      db.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) => {
        const result = await cb(tx);
        if (executionOrder.includes("deletion:lock_acquired") && !executionOrder.includes("deletion:committed")) {
          executionOrder.push("deletion:committed");
          resolveDeletionCommit();
        }
        return result;
      });

      // 1. Start deletion with owner
      access.getSessionUser.mockImplementation(async () => ownerUser);
      const deletionReq = new Request(`https://example.test/api/groups/${groupActiveId}`, { method: "DELETE" });
      const deletionPromise = deleteGroup(deletionReq, { params: { groupId: groupActiveId } });

      // Wait a tick so deletion enters transaction and acquires FOR UPDATE
      await new Promise((r) => setTimeout(r, 10));

      // 2. Start creation with member
      access.getSessionUser.mockImplementation(async () => currentUser);
      const creationReq = new Request("https://example.test/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Math", groupId: groupActiveId }),
      });
      const creationPromise = createSubject(creationReq);

      const [deletionRes, creationRes] = await Promise.all([deletionPromise, creationPromise]);

      expect(deletionRes.status).toBe(200);
      expect(creationRes.status).toBe(403);

      expect(executionOrder).toEqual([
        "deletion:lock_acquired",
        "deletion:group_deleted",
        "deletion:committed",
        "creation:lock_requested",
        "creation:lock_acquired_sees_deleted",
      ]);

      // Creation transaction NEVER inserted any subject!
      expect(tx.subject.create).not.toHaveBeenCalled();
      expect(activity.createActivityLog).toHaveBeenCalledTimes(1); // Only GROUP_DELETED
    });
  });
});
