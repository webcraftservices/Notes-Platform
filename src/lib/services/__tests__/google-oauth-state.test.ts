import { describe, expect, it, beforeAll, vi } from "vitest";
import { signOAuthState, verifyOAuthState } from "@/lib/services/google-oauth-state";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-not-used-in-production-32bytes";
});

describe("signOAuthState / verifyOAuthState", () => {
  it("verifies a state it just signed for the same user", () => {
    const state = signOAuthState("user_123");
    expect(verifyOAuthState(state, "user_123")).toBe(true);
  });

  it("rejects the state for a different user", () => {
    const state = signOAuthState("user_123");
    expect(verifyOAuthState(state, "user_456")).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const state = signOAuthState("user_123");
    const [payload, signature] = state.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: "user_456", nonce: "x", issuedAt: Date.now() })).toString(
      "base64url"
    );
    expect(verifyOAuthState(`${tamperedPayload}.${signature}`, "user_456")).toBe(false);
    void payload;
  });

  it("rejects a malformed state string", () => {
    expect(verifyOAuthState("not-a-valid-state", "user_123")).toBe(false);
    expect(verifyOAuthState("", "user_123")).toBe(false);
  });

  it("rejects an expired state", () => {
    vi.useFakeTimers();
    try {
      const state = signOAuthState("user_123");
      vi.advanceTimersByTime(11 * 60 * 1000); // past the 10-minute TTL
      expect(verifyOAuthState(state, "user_123")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
