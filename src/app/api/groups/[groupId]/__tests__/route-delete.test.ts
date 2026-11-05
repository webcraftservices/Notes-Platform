import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  group: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  subject: { updateMany: vi.fn() },
  chapter: { updateMany: vi.fn() },
  topic: { updateMany: vi.fn() },
  note: { updateMany: vi.fn() },
  material: { updateMany: vi.fn() },
  aIConversation: { updateMany: vi.fn() },
  groupInvitation: { updateMany: vi.fn() },
  processingJob: { updateMany: vi.fn() },
}));

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  group: { findUnique: vi.fn(), update: vi.fn() },
  groupMember: { count: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleGroup: vi.fn(),
  getGroupRole: vi.fn(),
  requireGroupRole: vi.fn(),
}));
vi.mock("@/lib/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access")>();
  return {
    ...actual,
    getSessionUser: access.getSessionUser,
    getAccessibleGroup: access.getAccessibleGroup,
    getGroupRole: access.getGroupRole,
    requireGroupRole: access.requireGroupRole,
  };
});

const activity = vi.hoisted(() => ({
  createActivityLog: vi.fn(),
  ActivityAction: {
    GROUP_DELETED: "group.deleted",
  },
}));
vi.mock("@/lib/activity", () => activity);

const notifications = vi.hoisted(() => ({
  createNotifications: vi.fn(),
}));
vi.mock("@/lib/notifications", () => notifications);

import { DELETE } from "@/app/api/groups/[groupId]/route";

const ownerUser = { id: "user-owner", name: "Alice", email: "alice@example.com" };
const memberUser = { id: "user-member", name: "Bob", email: "bob@example.com" };
const adminUser = { id: "user-admin", name: "Charlie", email: "charlie@example.com" };

const activeGroup = {
  id: "group-1",
  name: "Study Group",
  deletedAt: null,
  members: [
    { id: "gm-1", groupId: "group-1", userId: "user-owner", role: "OWNER" },
    { id: "gm-2", groupId: "group-1", userId: "user-member", role: "MEMBER" },
    { id: "gm-3", groupId: "group-1", userId: "user-admin", role: "ADMIN" },
  ],
};

const callDelete = (groupId = "group-1") =>
  DELETE(new Request(`https://example.test/api/groups/${groupId}`, { method: "DELETE" }), {
    params: { groupId },
  });

describe("DELETE /api/groups/[groupId] — Atomic Group Deletion & Resource Isolation (Phase 10C.1D)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue(ownerUser);
    db.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    tx.group.findUnique.mockResolvedValue(activeGroup);
    tx.group.updateMany.mockResolvedValue({ count: 1 });
    tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
      if (sql.includes("FOR UPDATE")) {
        return [{ id: "group-1", deletedAt: null }];
      }
      return [];
    });
    tx.subject.updateMany.mockResolvedValue({ count: 2 });
    tx.chapter.updateMany.mockResolvedValue({ count: 4 });
    tx.topic.updateMany.mockResolvedValue({ count: 8 });
    tx.note.updateMany.mockResolvedValue({ count: 8 });
    tx.material.updateMany.mockResolvedValue({ count: 5 });
    tx.aIConversation.updateMany.mockResolvedValue({ count: 3 });
    tx.groupInvitation.updateMany.mockResolvedValue({ count: 2 });
    tx.processingJob.updateMany.mockResolvedValue({ count: 1 });

    activity.createActivityLog.mockResolvedValue(undefined);
    notifications.createNotifications.mockResolvedValue({ count: 2 });
  });

  // 1. Authentication
  it("rejects unauthenticated callers with 401", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await callDelete();
    expect(res.status).toBe(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  // 2. Non-existent group
  it("returns 404 when the group does not exist", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    tx.group.findUnique.mockResolvedValue(null);

    const res = await callDelete("group-nonexistent");
    expect(res.status).toBe(404);
    expect(tx.group.updateMany).not.toHaveBeenCalled();
  });

  // 3. Already soft-deleted group
  it("returns 404 when the group is already soft-deleted", async () => {
    tx.$queryRaw.mockResolvedValue([{
      id: "group-1",
      deletedAt: new Date(Date.now() - 3600000),
    }]);
    tx.group.findUnique.mockResolvedValue({
      ...activeGroup,
      deletedAt: new Date(Date.now() - 3600000),
    });

    const res = await callDelete();
    expect(res.status).toBe(404);
    expect(tx.group.updateMany).not.toHaveBeenCalled();
    expect(activity.createActivityLog).not.toHaveBeenCalled();
    expect(notifications.createNotifications).not.toHaveBeenCalled();
  });

  // 4. Non-member caller
  it("returns 403 when the caller is not a member of the group", async () => {
    access.getSessionUser.mockResolvedValue({ id: "user-stranger", name: "Stranger" });

    const res = await callDelete();
    expect(res.status).toBe(403);
    expect(tx.group.update).not.toHaveBeenCalled();
  });

  // 5. Non-owner members (MEMBER and ADMIN)
  it("returns 403 when caller is a MEMBER of the group", async () => {
    access.getSessionUser.mockResolvedValue(memberUser);

    const res = await callDelete();
    expect(res.status).toBe(403);
    expect(tx.group.update).not.toHaveBeenCalled();
  });

  it("returns 403 when caller is an ADMIN of the group", async () => {
    access.getSessionUser.mockResolvedValue(adminUser);

    const res = await callDelete();
    expect(res.status).toBe(403);
    expect(tx.group.update).not.toHaveBeenCalled();
  });

  // 6. Successful owner deletion sequence & shared timestamp
  it("executes the full cascading soft-delete sequence with a shared timestamp when caller is OWNER", async () => {
    const res = await callDelete();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });

    // Transaction executed
    expect(db.$transaction).toHaveBeenCalledTimes(1);

    // Group verified inside transaction
    expect(tx.group.findUnique).toHaveBeenCalledWith({
      where: { id: "group-1" },
      include: { members: true },
    });

    // 4. Group soft-deleted atomically
    expect(tx.group.updateMany).toHaveBeenCalledWith({
      where: { id: "group-1", deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    const sharedTimestamp = tx.group.updateMany.mock.calls[0]![0].data.deletedAt;

    // 5. Subjects soft-deleted
    expect(tx.subject.updateMany).toHaveBeenCalledWith({
      where: { groupId: "group-1", deletedAt: null },
      data: { deletedAt: sharedTimestamp },
    });

    // 6. Chapters soft-deleted
    expect(tx.chapter.updateMany).toHaveBeenCalledWith({
      where: { subject: { groupId: "group-1" }, deletedAt: null },
      data: { deletedAt: sharedTimestamp },
    });

    // 7. Topics soft-deleted
    expect(tx.topic.updateMany).toHaveBeenCalledWith({
      where: { chapter: { subject: { groupId: "group-1" } }, deletedAt: null },
      data: { deletedAt: sharedTimestamp },
    });

    // 8. Notes soft-deleted
    expect(tx.note.updateMany).toHaveBeenCalledWith({
      where: { topic: { chapter: { subject: { groupId: "group-1" } } }, deletedAt: null },
      data: { deletedAt: sharedTimestamp },
    });

    // 9. Materials soft-deleted
    expect(tx.material.updateMany).toHaveBeenCalledWith({
      where: { groupId: "group-1", deletedAt: null },
      data: { deletedAt: sharedTimestamp },
    });

    // 10. AIConversations soft-deleted
    expect(tx.aIConversation.updateMany).toHaveBeenCalledWith({
      where: { groupId: "group-1", deletedAt: null },
      data: { deletedAt: sharedTimestamp },
    });

    // 11. Pending invitations cancelled
    expect(tx.groupInvitation.updateMany).toHaveBeenCalledWith({
      where: { groupId: "group-1", status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    // 12. Active processing jobs cancelled
    expect(tx.processingJob.updateMany).toHaveBeenCalledWith({
      where: {
        material: { groupId: "group-1" },
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: {
        status: "CANCELLED",
        error: "Parent group was deleted.",
        completedAt: sharedTimestamp,
      },
    });

    // 13. Activity log created inside transaction
    expect(activity.createActivityLog).toHaveBeenCalledWith(tx, {
      groupId: "group-1",
      userId: "user-owner",
      action: "group.deleted",
      targetType: "group",
      targetId: "group-1",
      metadata: { targetName: "Study Group" },
    });

    // 14. Notifications created for other members (excluding owner)
    expect(notifications.createNotifications).toHaveBeenCalledWith(
      tx,
      ["user-member", "user-admin"],
      {
        type: "SYSTEM",
        title: 'Alice deleted the group "Study Group".',
      }
    );
  });

  // 7. Notification targeting: owner excluded & sole owner
  it("does not send notifications if the owner is the sole member of the group", async () => {
    tx.group.findUnique.mockResolvedValue({
      ...activeGroup,
      members: [{ id: "gm-1", groupId: "group-1", userId: "user-owner", role: "OWNER" }],
    });

    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(notifications.createNotifications).not.toHaveBeenCalled();
  });

  // 8. Personal/workspace resources isolation
  it("strictly scopes soft-deletes to the target groupId and does not touch workspace-scoped resources", async () => {
    await callDelete();

    // Verify all where clauses contain groupId or relation to groupId
    for (const call of tx.subject.updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ groupId: "group-1" });
    }
    for (const call of tx.chapter.updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ subject: { groupId: "group-1" } });
    }
    for (const call of tx.topic.updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ chapter: { subject: { groupId: "group-1" } } });
    }
    for (const call of tx.note.updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ topic: { chapter: { subject: { groupId: "group-1" } } } });
    }
    for (const call of tx.material.updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ groupId: "group-1" });
    }
    for (const call of tx.aIConversation.updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ groupId: "group-1" });
    }
    for (const call of tx.groupInvitation.updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ groupId: "group-1" });
    }
    for (const call of tx.processingJob.updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ material: { groupId: "group-1" } });
    }
  });

  // 9. Historical child records preserved
  it("does not delete historical records like MaterialChunk, Transcript, NoteBlock, or GroupMember", async () => {
    await callDelete();

    // In tx, models not in the deletion list are never called
    expect((tx as Record<string, unknown>).materialChunk).toBeUndefined();
    expect((tx as Record<string, unknown>).transcript).toBeUndefined();
    expect((tx as Record<string, unknown>).noteBlock).toBeUndefined();
    expect((tx as Record<string, unknown>).groupMember).toBeUndefined();
  });

  // 10. Transaction failure & rollback
  it("rolls back all changes if an operation inside the transaction throws", async () => {
    tx.material.updateMany.mockRejectedValue(new Error("Database connection interrupted"));

    await expect(callDelete()).rejects.toThrow("Database connection interrupted");
  });

  // 11. Repeated deletion returns 404 and does not duplicate activity or notifications
  it("repeated deletion returns 404 and does not re-trigger activity or notifications", async () => {
    // First deletion succeeds
    const res1 = await callDelete();
    expect(res1.status).toBe(200);

    // Second call simulates group now having deletedAt set
    tx.group.findUnique.mockResolvedValue({
      ...activeGroup,
      deletedAt: new Date(),
    });
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.$queryRaw.mockResolvedValueOnce([{
      id: "group-1",
      deletedAt: new Date(),
    }]);

    const res2 = await callDelete();
    expect(res2.status).toBe(404);
    expect(tx.group.updateMany).not.toHaveBeenCalled();
    expect(activity.createActivityLog).not.toHaveBeenCalled();
    expect(notifications.createNotifications).not.toHaveBeenCalled();
  });

  // 12. Concurrent deletion race deduplication (Phase 10C.1D.1)
  it("prevents duplicate deletion and duplicate logs/notifications when two requests race", async () => {
    // Both requests initially read the active group, but the losing request gets count: 0 on atomic updateMany
    tx.group.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await callDelete();
    expect(res.status).toBe(404);

    // Loser aborted immediately: no child resource cascades, no activity log, no notifications
    expect(tx.subject.updateMany).not.toHaveBeenCalled();
    expect(tx.chapter.updateMany).not.toHaveBeenCalled();
    expect(tx.topic.updateMany).not.toHaveBeenCalled();
    expect(tx.note.updateMany).not.toHaveBeenCalled();
    expect(tx.material.updateMany).not.toHaveBeenCalled();
    expect(tx.aIConversation.updateMany).not.toHaveBeenCalled();
    expect(tx.groupInvitation.updateMany).not.toHaveBeenCalled();
    expect(tx.processingJob.updateMany).not.toHaveBeenCalled();
    expect(activity.createActivityLog).not.toHaveBeenCalled();
    expect(notifications.createNotifications).not.toHaveBeenCalled();
  });

  // 13. Fail-Closed on raw locking failure (Phase 10C.1D.2.1)
  it("fails closed when tx.$queryRaw is missing or throws an unexpected database error", async () => {
    // A: Missing $queryRaw
    const brokenTx = { ...tx, $queryRaw: undefined };
    db.$transaction.mockImplementationOnce(async (cb: (client: typeof tx) => unknown) => cb(brokenTx as unknown as typeof tx));

    await expect(callDelete()).rejects.toThrow("Transaction client does not support raw query locking");
    expect(tx.group.updateMany).not.toHaveBeenCalled();

    // B: Database error during lock acquisition
    tx.$queryRaw.mockRejectedValueOnce(new Error("Database connection timed out during locking"));
    await expect(callDelete()).rejects.toThrow("Database connection timed out during locking");
    expect(tx.group.updateMany).not.toHaveBeenCalled();
  });
});

