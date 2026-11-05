import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const profile = { upsert: vi.fn().mockResolvedValue({}) };
  const subscription = { upsert: vi.fn().mockResolvedValue({}) };
  const workspaceMember = { findFirst: vi.fn().mockResolvedValue(null) };
  const workspace = { create: vi.fn().mockResolvedValue({ id: "ws-test" }) };

  return {
    profile,
    subscription,
    workspaceMember,
    workspace,
    $transaction: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db }));

import { provisionNewUser } from "@/lib/provision";

describe("provisionNewUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      return callback(db);
    });
    db.workspaceMember.findFirst.mockResolvedValue(null);
  });

  it("provisions a new user with its own transaction when no tx is provided", async () => {
    await provisionNewUser("user-auto-tx");

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.profile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-auto-tx" },
      update: {},
      create: { userId: "user-auto-tx" },
    });
    expect(db.subscription.upsert).toHaveBeenCalledWith({
      where: { userId: "user-auto-tx" },
      update: {},
      create: { userId: "user-auto-tx", plan: "FREE" },
    });
    expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-auto-tx" },
    });
    expect(db.workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "My Workspace",
          ownerId: "user-auto-tx",
          mode: "STUDY",
          members: { create: { userId: "user-auto-tx", role: "OWNER" } },
        }),
      })
    );
  });

  it("provisions within an existing transaction client without starting a nested transaction", async () => {
    const mockTx = {
      profile: { upsert: vi.fn().mockResolvedValue({}) },
      subscription: { upsert: vi.fn().mockResolvedValue({}) },
      workspaceMember: { findFirst: vi.fn().mockResolvedValue(null) },
      workspace: { create: vi.fn().mockResolvedValue({ id: "ws-tx-1" }) },
    };

    await provisionNewUser("user-in-tx", mockTx as any);

    // Should NOT invoke db.$transaction when tx is already passed
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(mockTx.profile.upsert).toHaveBeenCalledWith({
      where: { userId: "user-in-tx" },
      update: {},
      create: { userId: "user-in-tx" },
    });
    expect(mockTx.subscription.upsert).toHaveBeenCalledWith({
      where: { userId: "user-in-tx" },
      update: {},
      create: { userId: "user-in-tx", plan: "FREE" },
    });
    expect(mockTx.workspace.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: "user-in-tx",
        }),
      })
    );
  });

  it("does not create a duplicate workspace if one already exists for the user", async () => {
    db.workspaceMember.findFirst.mockResolvedValue({ id: "mem-1", workspaceId: "ws-existing" });

    await provisionNewUser("user-with-ws");

    expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({ where: { userId: "user-with-ws" } });
    expect(db.workspace.create).not.toHaveBeenCalled();
  });
});

