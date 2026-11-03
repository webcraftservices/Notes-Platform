import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db }));

import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";

describe("CredentialsProvider authorize", () => {
  const provider = authOptions.providers.find((p) => p.id === "credentials") as any;
  const authorize = provider.options?.authorize ?? provider.authorize;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null if input does not satisfy schema", async () => {
    const result = await authorize(
      { email: "invalid-email", password: "short" },
      { headers: { "x-forwarded-for": "10.0.0.1" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toBeNull();
  });

  it("returns null when user is not found in database", async () => {
    db.user.findUnique.mockResolvedValueOnce(null);
    db.user.findFirst.mockResolvedValueOnce(null);

    const result = await authorize(
      { email: "unknown@example.com", password: "password123" },
      { headers: { "x-forwarded-for": "10.0.0.2" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toBeNull();
  });

  it("returns null when password does not match", async () => {
    const hash = await bcrypt.hash("correct-password", 10);
    db.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      email: "user@example.com",
      name: "User One",
      passwordHash: hash,
      image: null,
    });

    const result = await authorize(
      { email: "user@example.com", password: "wrong-password" },
      { headers: { "x-forwarded-for": "10.0.0.3" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toBeNull();
  });

  it("authorizes successfully and normalizes email lookup", async () => {
    const hash = await bcrypt.hash("Secret1234", 10);
    db.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      email: "user@example.com",
      name: "User One",
      passwordHash: hash,
      image: null,
    });

    const result = await authorize(
      { email: "  User@Example.COM  ", password: "Secret1234" },
      { headers: { "x-forwarded-for": "10.0.0.4" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toEqual({
      id: "u1",
      email: "user@example.com",
      name: "User One",
      image: null,
    });
  });

  it("falls back to case-insensitive findFirst if findUnique misses", async () => {
    const hash = await bcrypt.hash("Secret1234", 10);
    // findUnique misses (e.g. legacy mixed-case stored email in Postgres)
    db.user.findUnique.mockResolvedValueOnce(null);
    // findFirst matches case-insensitively
    db.user.findFirst.mockResolvedValueOnce({
      id: "u2",
      email: "Legacy.User@Example.com",
      name: "Legacy User",
      passwordHash: hash,
      image: null,
    });

    const result = await authorize(
      { email: "legacy.user@example.com", password: "Secret1234" },
      { headers: { "x-forwarded-for": "10.0.0.5" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toEqual({
      id: "u2",
      email: "Legacy.User@Example.com",
      name: "Legacy User",
      image: null,
    });
  });

  it("throttles repeated attempts from the same IP when rate limit is exceeded", async () => {
    const ip = `test-ip-${Date.now()}`;
    const req = { headers: { "x-forwarded-for": ip }, query: {}, body: {}, method: "POST" };

    db.user.findUnique.mockResolvedValue(null);
    db.user.findFirst.mockResolvedValue(null);

    // Up to 10 attempts allowed
    for (let i = 0; i < 10; i++) {
      await authorize(
        { email: `test${i}@example.com`, password: "password123" },
        req
      );
    }

    // 11th attempt throws rate limit error
    await expect(
      authorize(
        { email: "test11@example.com", password: "password123" },
        req
      )
    ).rejects.toThrow("Too many sign-in attempts. Please try again later.");
  });
});
