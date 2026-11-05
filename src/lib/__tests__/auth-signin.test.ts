import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
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
    db.user.findMany.mockResolvedValue([]);
  });

  it("returns null if input does not satisfy schema", async () => {
    const result = await authorize(
      { email: "invalid-email", password: "short" },
      { headers: { "x-forwarded-for": "10.0.0.1" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toBeNull();
  });

  it("returns null when user is not found in database (zero matches)", async () => {
    db.user.findMany.mockResolvedValueOnce([]);

    const result = await authorize(
      { email: "unknown@example.com", password: "password123" },
      { headers: { "x-forwarded-for": "10.0.0.2" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toBeNull();
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { email: { equals: "unknown@example.com", mode: "insensitive" }, deletedAt: null },
      take: 2,
    });
  });

  it("fails authentication when password does not match", async () => {
    const hash = await bcrypt.hash("correct-password", 10);
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "u1",
        email: "user@example.com",
        name: "User One",
        passwordHash: hash,
        image: null,
      },
    ]);

    const result = await authorize(
      { email: "user@example.com", password: "wrong-password" },
      { headers: { "x-forwarded-for": "10.0.0.3" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toBeNull();
  });

  it("authenticates one lowercase account successfully", async () => {
    const hash = await bcrypt.hash("Secret1234", 10);
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "u1",
        email: "student@example.com",
        name: "Student Lowercase",
        passwordHash: hash,
        image: null,
      },
    ]);

    const result = await authorize(
      { email: "  student@example.com  ", password: "Secret1234" },
      { headers: { "x-forwarded-for": "10.0.0.4" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toEqual({
      id: "u1",
      email: "student@example.com",
      name: "Student Lowercase",
      image: null,
    });
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { email: { equals: "student@example.com", mode: "insensitive" }, deletedAt: null },
      take: 2,
    });
  });

  it("authenticates one mixed-case legacy account successfully", async () => {
    const hash = await bcrypt.hash("Secret1234", 10);
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "u2",
        email: "Scholar.Student@University.edu",
        name: "Scholar Student",
        passwordHash: hash,
        image: null,
      },
    ]);

    const result = await authorize(
      { email: "SCHOLAR.STUDENT@UNIVERSITY.EDU", password: "Secret1234" },
      { headers: { "x-forwarded-for": "10.0.0.5" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toEqual({
      id: "u2",
      email: "Scholar.Student@University.edu",
      name: "Scholar Student",
      image: null,
    });
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { email: { equals: "scholar.student@university.edu", mode: "insensitive" }, deletedAt: null },
      take: 2,
    });
  });

  it("rejects two mixed-case legacy accounts with different casing", async () => {
    const hash1 = await bcrypt.hash("Secret1234", 10);
    const hash2 = await bcrypt.hash("Secret5678", 10);
    // Two legacy accounts differ only by capitalization
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "u-legacy-1",
        email: "Student.Scholar@University.edu",
        name: "Student One",
        passwordHash: hash1,
        image: null,
      },
      {
        id: "u-legacy-2",
        email: "STUDENT.SCHOLAR@UNIVERSITY.EDU",
        name: "Student Two",
        passwordHash: hash2,
        image: null,
      },
    ]);

    const result = await authorize(
      { email: "student.scholar@university.edu", password: "Secret1234" },
      { headers: { "x-forwarded-for": "10.0.0.6" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toBeNull();
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { email: { equals: "student.scholar@university.edu", mode: "insensitive" }, deletedAt: null },
      take: 2,
    });
  });

  it("rejects one lowercase account plus one mixed-case account, even when exact lowercase is submitted", async () => {
    const hash1 = await bcrypt.hash("Secret1234", 10);
    const hash2 = await bcrypt.hash("Secret5678", 10);
    // Both exact lowercase and mixed-case exist in database
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "u-exact-1",
        email: "student@example.com",
        name: "Student Lowercase",
        passwordHash: hash1,
        image: null,
      },
      {
        id: "u-legacy-2",
        email: "Student@example.com",
        name: "Student Mixed",
        passwordHash: hash2,
        image: null,
      },
    ]);

    // Submitting exact lowercase address
    const result = await authorize(
      { email: "student@example.com", password: "Secret1234" },
      { headers: { "x-forwarded-for": "10.0.0.7" }, query: {}, body: {}, method: "POST" }
    );
    // Must return null immediately due to ambiguity, never authenticating the exact match
    expect(result).toBeNull();
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { email: { equals: "student@example.com", mode: "insensitive" }, deletedAt: null },
      take: 2,
    });
  });

  it("does not authenticate soft-deleted accounts", async () => {
    // Database query specifies deletedAt: null, so soft-deleted accounts return empty array
    db.user.findMany.mockResolvedValueOnce([]);

    const result = await authorize(
      { email: "deleted.user@example.com", password: "Password123" },
      { headers: { "x-forwarded-for": "10.0.0.8" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toBeNull();
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { email: { equals: "deleted.user@example.com", mode: "insensitive" }, deletedAt: null },
      take: 2,
    });
  });

  it("returns null when user has no passwordHash (e.g. OAuth only)", async () => {
    db.user.findMany.mockResolvedValueOnce([
      {
        id: "u-oauth",
        email: "oauth.user@example.com",
        name: "OAuth User",
        passwordHash: null,
        image: null,
      },
    ]);

    const result = await authorize(
      { email: "oauth.user@example.com", password: "Password123" },
      { headers: { "x-forwarded-for": "10.0.0.9" }, query: {}, body: {}, method: "POST" }
    );
    expect(result).toBeNull();
  });

  it("throttles repeated attempts from the same IP when rate limit is exceeded", async () => {
    const ip = `test-ip-${Date.now()}`;
    const req = { headers: { "x-forwarded-for": ip }, query: {}, body: {}, method: "POST" };

    db.user.findMany.mockResolvedValue([]);

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
