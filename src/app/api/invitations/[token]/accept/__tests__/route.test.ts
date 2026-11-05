import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const groupInvitation = {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  };
  const user = {
    findUnique: vi.fn(),
  };
  const group = {
    findUnique: vi.fn(),
  };
  const groupMember = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  };
  const activityLog = {
    create: vi.fn(),
  };
  const notification = {
    createMany: vi.fn(),
  };

  return {
    groupInvitation,
    user,
    group,
    groupMember,
    activityLog,
    notification,
    $transaction: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/access", () => access);

import { POST } from "@/app/api/invitations/[token]/accept/route";

function makeAcceptRequest(token = "test-token"): Request {
  return new Request(`https://example.test/api/invitations/${token}/accept`, {
    method: "POST",
  });
}

describe("POST /api/invitations/[token]/accept (Phase 10C.1B)", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default transaction executes callback immediately with mocked db
    db.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(db));

    // Default authenticated user
    access.getSessionUser.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    db.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      name: "Student One",
    });

    // Default group member admin lookup
    db.groupMember.findMany.mockResolvedValue([{ userId: "admin-1" }]);
  });

  // 10. Unauthenticated requests remain rejected
  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await POST(makeAcceptRequest(), { params: { token: "token-1" } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("sign in");
    expect(db.groupMember.create).not.toHaveBeenCalled();
  });

  it("returns 404 when invitation token does not exist", async () => {
    db.groupInvitation.findUnique.mockResolvedValue(null);

    const res = await POST(makeAcceptRequest(), { params: { token: "missing-token" } });
    expect(res.status).toBe(404);
    expect(db.groupMember.create).not.toHaveBeenCalled();
  });

  // 3. Deleted-group invitation acceptance is rejected
  // 4. Rejected acceptance creates no membership
  // 5. Rejected acceptance does not mark the invitation accepted
  it("rejects invitation acceptance when parent group is soft-deleted, creating no member and keeping status unchanged", async () => {
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      token: "deleted-group-token",
      email: "student@example.com",
      groupId: "grp-deleted",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      group: {
        id: "grp-deleted",
        deletedAt: new Date(), // Soft-deleted parent group
      },
    });

    const res = await POST(makeAcceptRequest("deleted-group-token"), {
      params: { token: "deleted-group-token" },
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found.");

    // Membership must not be created
    expect(db.groupMember.create).not.toHaveBeenCalled();

    // Invitation must not be consumed or updated
    expect(db.groupInvitation.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  // Race safety test
  it("rejects invitation acceptance if group is soft-deleted concurrently during the transaction", async () => {
    // Initial lookup succeeds
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      token: "race-token",
      email: "student@example.com",
      groupId: "grp-raced",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      group: {
        id: "grp-raced",
        deletedAt: null,
      },
    });

    // But inside tx, group is concurrently soft-deleted (deletedAt !== null) so findUnique returns null
    db.group.findUnique.mockResolvedValue(null);

    const res = await POST(makeAcceptRequest("race-token"), {
      params: { token: "race-token" },
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found.");

    // Must not create membership or mark invitation accepted
    expect(db.groupMember.create).not.toHaveBeenCalled();
    expect(db.groupInvitation.updateMany).not.toHaveBeenCalled();
  });

  // 6. Expired invitation behavior remains unchanged
  it("rejects an expired invitation with 409 Conflict and marks it EXPIRED for active groups", async () => {
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-expired",
      token: "expired-token",
      email: "student@example.com",
      groupId: "grp-active",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date(Date.now() - 10000), // in the past
      group: {
        id: "grp-active",
        deletedAt: null,
      },
    });
    db.groupInvitation.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(makeAcceptRequest("expired-token"), {
      params: { token: "expired-token" },
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("This invitation has expired.");

    // Status flipped to EXPIRED
    expect(db.groupInvitation.updateMany).toHaveBeenCalledWith({
      where: { token: "expired-token", status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    expect(db.groupMember.create).not.toHaveBeenCalled();
  });

  // 7. Revoked/accepted invitation behavior remains unchanged
  it("rejects an already accepted or cancelled invitation with 409 Conflict", async () => {
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-used",
      token: "used-token",
      email: "student@example.com",
      groupId: "grp-active",
      role: "MEMBER",
      status: "ACCEPTED",
      expiresAt: new Date(Date.now() + 100000),
      group: {
        id: "grp-active",
        deletedAt: null,
      },
    });

    const res = await POST(makeAcceptRequest("used-token"), {
      params: { token: "used-token" },
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("This invitation is no longer available.");
    expect(db.groupMember.create).not.toHaveBeenCalled();
  });

  // Email mismatch check
  it("rejects invitation acceptance when caller email does not match invitation email", async () => {
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-diff",
      token: "diff-token",
      email: "other@example.com",
      groupId: "grp-active",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      group: {
        id: "grp-active",
        deletedAt: null,
      },
    });

    const res = await POST(makeAcceptRequest("diff-token"), {
      params: { token: "diff-token" },
    });

    expect(res.status).toBe(403);
    expect(db.groupMember.create).not.toHaveBeenCalled();
  });

  // 8. Active-group invitation acceptance still succeeds
  it("successfully accepts invitation for an active group, creating member and notifications", async () => {
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-valid",
      token: "valid-token",
      email: "student@example.com",
      groupId: "grp-active",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      group: {
        id: "grp-active",
        deletedAt: null,
      },
    });
    // In transaction group check succeeds
    db.group.findUnique.mockResolvedValue({ id: "grp-active", name: "Bio Study Group" });
    // User is not already a member
    db.groupMember.findUnique.mockResolvedValue(null);
    // Conditional update consumes invitation
    db.groupInvitation.updateMany.mockResolvedValue({ count: 1 });
    // Member created
    db.groupMember.create.mockResolvedValue({
      id: "gm-new",
      groupId: "grp-active",
      userId: "user-1",
      role: "MEMBER",
    });

    const res = await POST(makeAcceptRequest("valid-token"), {
      params: { token: "valid-token" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      groupId: "grp-active",
      role: "MEMBER",
      alreadyMember: false,
    });

    expect(db.groupMember.create).toHaveBeenCalledWith({
      data: { groupId: "grp-active", userId: "user-1", role: "MEMBER" },
    });
    expect(db.groupInvitation.updateMany).toHaveBeenCalledWith({
      where: { token: "valid-token", status: "PENDING" },
      data: { status: "ACCEPTED" },
    });
    expect(db.activityLog.create).toHaveBeenCalled();
    expect(db.notification.createMany).toHaveBeenCalled();
  });

  // 9. Duplicate membership behavior remains unchanged
  it("handles duplicate membership gracefully without creating a second membership", async () => {
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-dup",
      token: "dup-token",
      email: "student@example.com",
      groupId: "grp-active",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      group: {
        id: "grp-active",
        deletedAt: null,
      },
    });
    db.group.findUnique.mockResolvedValue({ id: "grp-active", name: "Bio Study Group" });
    // User is ALREADY a member
    db.groupMember.findUnique.mockResolvedValue({
      id: "gm-existing",
      groupId: "grp-active",
      userId: "user-1",
      role: "ADMIN",
    });
    db.groupInvitation.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(makeAcceptRequest("dup-token"), {
      params: { token: "dup-token" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      groupId: "grp-active",
      role: "ADMIN",
      alreadyMember: true,
    });

    // Marked accepted
    expect(db.groupInvitation.updateMany).toHaveBeenCalledWith({
      where: { token: "dup-token", status: "PENDING" },
      data: { status: "ACCEPTED" },
    });
    // No second membership created
    expect(db.groupMember.create).not.toHaveBeenCalled();
    // No new activity/notification created for duplicate join
    expect(db.activityLog.create).not.toHaveBeenCalled();
  });
});

