import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within the configured limit", async () => {
    const key = `test:${Math.random()}`;
    const first = await rateLimit(key, { limit: 3, windowSeconds: 60 });
    const second = await rateLimit(key, { limit: 3, windowSeconds: 60 });
    const third = await rateLimit(key, { limit: 3, windowSeconds: 60 });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(third.success).toBe(true);
  });

  it("rejects a request once the limit is exceeded within the window", async () => {
    const key = `test:${Math.random()}`;
    await rateLimit(key, { limit: 2, windowSeconds: 60 });
    await rateLimit(key, { limit: 2, windowSeconds: 60 });
    const third = await rateLimit(key, { limit: 2, windowSeconds: 60 });

    expect(third.success).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("resets the count once the window has elapsed", async () => {
    const key = `test:${Math.random()}`;
    await rateLimit(key, { limit: 1, windowSeconds: 60 });
    const blocked = await rateLimit(key, { limit: 1, windowSeconds: 60 });
    expect(blocked.success).toBe(false);

    vi.advanceTimersByTime(61 * 1000);

    const afterReset = await rateLimit(key, { limit: 1, windowSeconds: 60 });
    expect(afterReset.success).toBe(true);
  });

  it("tracks distinct keys independently, so one user's usage can't block another's", async () => {
    const userA = `user-a:${Math.random()}`;
    const userB = `user-b:${Math.random()}`;

    await rateLimit(userA, { limit: 1, windowSeconds: 60 });
    const aBlocked = await rateLimit(userA, { limit: 1, windowSeconds: 60 });
    const bAllowed = await rateLimit(userB, { limit: 1, windowSeconds: 60 });

    expect(aBlocked.success).toBe(false);
    expect(bAllowed.success).toBe(true);
  });
});
