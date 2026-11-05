import React from "react";
(globalThis as any).React = React;
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const db = vi.hoisted(() => ({
  groupInvitation: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  groupMember: {
    findUnique: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  requireUser: vi.fn(),
}));
vi.mock("@/lib/access", () => access);

const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() })),
}));
vi.mock("next/navigation", () => navigation);

import InvitationPage from "@/app/invitations/[token]/page";

describe("InvitationPage landing page (Phase 10C.1B)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    navigation.notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    navigation.useRouter.mockReturnValue({ push: vi.fn(), refresh: vi.fn() });
    access.requireUser.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    db.user.findUnique.mockResolvedValue({ email: "student@example.com" });
    db.groupMember.findUnique.mockResolvedValue(null);
  });

  // 1. Active-group invitation landing page remains valid
  it("renders invitation landing page with group details for an active group", async () => {
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-active",
      token: "active-token",
      email: "student@example.com",
      groupId: "grp-active",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      group: {
        id: "grp-active",
        name: "Physics Study Circle",
        description: "Coursework and exam prep",
        deletedAt: null,
      },
    });

    const pageElement = await InvitationPage({ params: { token: "active-token" } });
    const html = renderToStaticMarkup(pageElement);

    expect(html).toContain("Join Physics Study Circle");
    expect(html).toContain("Coursework and exam prep");
    expect(navigation.notFound).not.toHaveBeenCalled();
  });

  // 2. Deleted-group invitation landing page is invalid/unavailable
  it("treats invitation for a soft-deleted group as not found and does not reveal group details", async () => {
    db.groupInvitation.findUnique.mockResolvedValue({
      id: "inv-deleted",
      token: "deleted-token",
      email: "student@example.com",
      groupId: "grp-deleted",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      group: {
        id: "grp-deleted",
        name: "Secret Deleted Group",
        description: "Confidential research",
        deletedAt: new Date(),
      },
    });

    await expect(InvitationPage({ params: { token: "deleted-token" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navigation.notFound).toHaveBeenCalled();
  });

  it("triggers notFound for non-existent invitation token", async () => {
    db.groupInvitation.findUnique.mockResolvedValue(null);

    await expect(InvitationPage({ params: { token: "non-existent" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navigation.notFound).toHaveBeenCalled();
  });
});
