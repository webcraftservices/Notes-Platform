import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const user = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  };
  return {
    user,
    $transaction: vi.fn(),
  };
});
vi.mock("@/lib/db", () => ({ db }));

const provision = vi.hoisted(() => ({
  provisionNewUser: vi.fn(),
}));
vi.mock("@/lib/provision", () => provision);

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("mocked_hashed_password"),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

import { POST } from "@/app/api/auth/register/route";
import { Prisma } from "@prisma/client";

function makeRegisterRequest(body: unknown, ip = "127.0.0.1"): Request {
  return new Request("https://example.test/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback(db));
    db.user.findUnique.mockResolvedValue(null);
    db.user.findFirst.mockResolvedValue(null);
    db.user.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "user-123", email: data.email, name: data.name })
    );
    provision.provisionNewUser.mockResolvedValue(undefined);
  });

  const validPayload = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "Password123",
    confirmPassword: "Password123",
  };

  it("registers successfully with normalized lowercase email", async () => {
    const ip = `ip-${Date.now()}-1`;
    const res = await POST(
      makeRegisterRequest({ ...validPayload, email: "ADA.LOVELACE@EXAMPLE.COM" }, ip)
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe("ada.lovelace@example.com");

    expect(db.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Ada Lovelace",
        email: "ada.lovelace@example.com",
      }),
      select: { id: true, email: true, name: true },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(provision.provisionNewUser).toHaveBeenCalledWith("user-123", db);
  });

  it("rolls back user creation if provisioning fails within the transaction", async () => {
    const ip = `ip-${Date.now()}-rollback`;
    provision.provisionNewUser.mockRejectedValueOnce(new Error("Provisioning timeout"));

    const res = await POST(makeRegisterRequest(validPayload, ip));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Could not create account with these details.");
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("allows successful retry after a failed registration transaction", async () => {
    const ip = `ip-${Date.now()}-retry`;
    // First attempt fails during provisioning
    provision.provisionNewUser.mockRejectedValueOnce(new Error("Transient DB failure"));
    const failRes = await POST(makeRegisterRequest(validPayload, ip));
    expect(failRes.status).toBe(500);

    // Second attempt (retry) succeeds because User was not committed on failure
    db.user.findUnique.mockResolvedValueOnce(null);
    db.user.findFirst.mockResolvedValueOnce(null);
    provision.provisionNewUser.mockResolvedValueOnce(undefined);

    const retryRes = await POST(makeRegisterRequest(validPayload, ip));
    expect(retryRes.status).toBe(201);
    const body = await retryRes.json();
    expect(body.user.email).toBe("ada@example.com");
  });

  it("trims surrounding whitespace from email during registration", async () => {
    const ip = `ip-${Date.now()}-2`;
    const res = await POST(
      makeRegisterRequest({ ...validPayload, email: "   ada@example.com   " }, ip)
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe("ada@example.com");

    expect(db.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "ada@example.com",
      }),
      select: { id: true, email: true, name: true },
    });
  });

  it("rejects duplicate registration when exact email exists", async () => {
    const ip = `ip-${Date.now()}-3`;
    db.user.findUnique.mockResolvedValueOnce({ id: "existing-1", email: "ada@example.com" });

    const res = await POST(makeRegisterRequest(validPayload, ip));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Could not create account with these details.");
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate registration when existing email has different casing", async () => {
    const ip = `ip-${Date.now()}-4`;
    // findUnique with normalized email misses because existing row has legacy casing
    db.user.findUnique.mockResolvedValueOnce(null);
    db.user.findFirst.mockResolvedValueOnce({ id: "legacy-1", email: "Ada@Example.com" });

    const res = await POST(
      makeRegisterRequest({ ...validPayload, email: "ADA@EXAMPLE.COM" }, ip)
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Could not create account with these details.");
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: "ada@example.com", mode: "insensitive" } },
    });
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("safely handles Prisma P2002 unique constraint error without leaking DB internals", async () => {
    const ip = `ip-${Date.now()}-5`;
    // Simulate race condition where findUnique/findFirst passed but concurrent insert caused P2002
    const prismaError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.20.0",
    });
    db.user.create.mockRejectedValueOnce(prismaError);

    const res = await POST(makeRegisterRequest(validPayload, ip));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Could not create account with these details.");
  });

  it("safely handles unexpected database errors with 500 without leaking stack or DB details", async () => {
    const ip = `ip-${Date.now()}-6`;
    db.user.create.mockRejectedValueOnce(new Error("FATAL: connection to server lost"));

    const res = await POST(makeRegisterRequest(validPayload, ip));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Could not create account with these details.");
  });

  it("returns 400 when registration payload fails validation", async () => {
    const ip = `ip-${Date.now()}-7`;
    const res = await POST(
      makeRegisterRequest(
        { ...validPayload, confirmPassword: "MismatchedPassword123" },
        ip
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("returns 429 when IP rate limit is exceeded", async () => {
    const ip = `rate-limited-ip-${Date.now()}`;
    // Limit is 5 per 15 minutes
    for (let i = 0; i < 5; i++) {
      db.user.findUnique.mockResolvedValueOnce(null);
      db.user.findFirst.mockResolvedValueOnce(null);
      await POST(
        makeRegisterRequest({ ...validPayload, email: `user${i}@example.com` }, ip)
      );
    }

    // 6th attempt from the same IP
    const res = await POST(
      makeRegisterRequest({ ...validPayload, email: "user6@example.com" }, ip)
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("Too many attempts");
  });
});
