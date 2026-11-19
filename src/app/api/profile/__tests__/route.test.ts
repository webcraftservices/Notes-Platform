import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/access", () => access);

const db = vi.hoisted(() => ({
  user: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
  profile: { update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));

import { PATCH } from "@/app/api/profile/route";

describe("PATCH /api/profile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    db.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
    db.user.update.mockResolvedValue({
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
      image: null,
      updatedAt: new Date("2026-11-16T00:00:00.000Z"),
    });
    db.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
      image: null,
      updatedAt: new Date("2026-11-16T00:00:00.000Z"),
    });
    db.profile.update.mockResolvedValue({ userId: "user-1", theme: "DARK" });
  });

  it("queries user with explicit safe select (never exposing passwordHash)", async () => {
    const res1 = await PATCH(
      new Request("https://example.test/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice Renamed" }),
      })
    );
    expect(res1.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { name: "Alice Renamed" },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        updatedAt: true,
      },
    });

    const json1 = await res1.json();
    expect(json1.user).not.toHaveProperty("passwordHash");

    const res2 = await PATCH(
      new Request("https://example.test/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: "DARK" }),
      })
    );
    expect(res2.status).toBe(200);
    expect(db.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        updatedAt: true,
      },
    });
  });
});
