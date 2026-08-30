import { describe, expect, it } from "vitest";
import { generateInvitationToken, invitationExpiryDate, INVITATION_TTL_MS } from "@/lib/invitation-token";

describe("generateInvitationToken", () => {
  it("produces a 64-character hex string (32 random bytes)", () => {
    const token = generateInvitationToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different token on every call", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateInvitationToken()));
    expect(tokens.size).toBe(50);
  });

  it("does not embed any obviously-recognizable input (sanity check against a naive derivation bug)", () => {
    const token = generateInvitationToken();
    expect(token).not.toContain("group");
    expect(token).not.toContain("email");
  });
});

describe("invitationExpiryDate", () => {
  it("returns a date INVITATION_TTL_MS after the given date", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const expiry = invitationExpiryDate(from);
    expect(expiry.getTime() - from.getTime()).toBe(INVITATION_TTL_MS);
  });

  it("defaults to now when no date is given", () => {
    const before = Date.now();
    const expiry = invitationExpiryDate();
    const after = Date.now();
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + INVITATION_TTL_MS);
    expect(expiry.getTime()).toBeLessThanOrEqual(after + INVITATION_TTL_MS);
  });
});
