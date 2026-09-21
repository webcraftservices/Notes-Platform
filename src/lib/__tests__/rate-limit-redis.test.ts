import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisInstances: MockRedis[] = [];

/**
 * Minimal mock of the one `@upstash/redis` surface rate-limit.ts touches
 * (`incr` / `expire`), with an in-memory store so `INCR` semantics
 * (atomic increment, starts at 1) are actually exercised rather than
 * stubbed with canned return values. The store is module-level (shared
 * across every `new Redis(...)` instance), mirroring real Redis: distinct
 * client objects pointed at the same URL/token all talk to the same
 * server-side state — rate-limit.ts deliberately constructs a fresh
 * client per call (see its doc comment), so the mock has to model that
 * sharing to be a faithful stand-in. Every constructed instance is also
 * captured in `redisInstances` so a test can control how many logical
 * clients were constructed, and can force a specific instance to fail.
 */
const sharedStore = new Map<string, number>();
let failNext = false;
let hangNext = false;
let incrCalls = 0;

class MockRedis {
  constructor(public config: { url: string; token: string; retry?: unknown }) {
    redisInstances.push(this);
  }

  async incr(key: string): Promise<number> {
    incrCalls += 1;
    if (hangNext) return new Promise<number>(() => {}); // never settles: a black-holed connection
    if (failNext) throw new Error("simulated Redis outage");
    const next = (sharedStore.get(key) ?? 0) + 1;
    sharedStore.set(key, next);
    return next;
  }

  async ping(): Promise<string> {
    if (hangNext) return new Promise<string>(() => {});
    if (failNext) throw new Error("simulated Redis outage");
    return "PONG";
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    if (failNext) throw new Error("simulated Redis outage");
    return 1;
  }
}

vi.mock("@upstash/redis", () => ({ Redis: MockRedis }));

// Reset by both describe blocks' beforeEach below.
function resetMockRedis() {
  redisInstances.length = 0;
  sharedStore.clear();
  failNext = false;
  hangNext = false;
  incrCalls = 0;
}

describe("rateLimit — backend selection", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    resetMockRedis();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("uses the in-memory fallback when Redis env vars are not set", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");

    const key = `fallback:${Math.random()}`;
    const result = await rateLimit(key, { limit: 3, windowSeconds: 60 });

    expect(result.success).toBe(true);
    expect(redisInstances).toHaveLength(0);
  });

  it("uses the in-memory fallback when only one of the two Redis env vars is set", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    const { rateLimit } = await import("@/lib/rate-limit");

    await rateLimit(`partial-env:${Math.random()}`, { limit: 3, windowSeconds: 60 });

    expect(redisInstances).toHaveLength(0);
  });

  it("uses Redis when both env vars are configured", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    const { rateLimit } = await import("@/lib/rate-limit");

    await rateLimit(`redis-path:${Math.random()}`, { limit: 3, windowSeconds: 60 });

    expect(redisInstances.length).toBeGreaterThan(0);
  });
});

describe("rateLimit — Redis-backed behavior", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    resetMockRedis();
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("allows requests within the configured limit", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    const key = `redis-allow:${Math.random()}`;

    const first = await rateLimit(key, { limit: 3, windowSeconds: 60 });
    const second = await rateLimit(key, { limit: 3, windowSeconds: 60 });
    const third = await rateLimit(key, { limit: 3, windowSeconds: 60 });

    expect(first).toEqual({ success: true, remaining: 2 });
    expect(second).toEqual({ success: true, remaining: 1 });
    expect(third).toEqual({ success: true, remaining: 0 });
  });

  it("rejects a request once the limit is exceeded within the window", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    const key = `redis-reject:${Math.random()}`;

    await rateLimit(key, { limit: 2, windowSeconds: 60 });
    await rateLimit(key, { limit: 2, windowSeconds: 60 });
    const third = await rateLimit(key, { limit: 2, windowSeconds: 60 });

    expect(third).toEqual({ success: false, remaining: 0 });
  });

  it("shares the same logical bucket across multiple calls for the same key", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    const key = `redis-shared-bucket:${Math.random()}`;

    await rateLimit(key, { limit: 5, windowSeconds: 60 });
    await rateLimit(key, { limit: 5, windowSeconds: 60 });
    await rateLimit(key, { limit: 5, windowSeconds: 60 });

    expect(sharedStore.get(`ratelimit:${key}`)).toBe(3);
  });

  it("tracks distinct keys independently, so one user's usage can't block another's", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    const userA = `redis-user-a:${Math.random()}`;
    const userB = `redis-user-b:${Math.random()}`;

    await rateLimit(userA, { limit: 1, windowSeconds: 60 });
    const aBlocked = await rateLimit(userA, { limit: 1, windowSeconds: 60 });
    const bAllowed = await rateLimit(userB, { limit: 1, windowSeconds: 60 });

    expect(aBlocked.success).toBe(false);
    expect(bAllowed.success).toBe(true);
  });

  it("falls back to the in-memory limiter (not fully open) and logs when Redis throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rateLimit } = await import("@/lib/rate-limit");
    const key = `redis-outage:${Math.random()}`;

    await rateLimit(key, { limit: 2, windowSeconds: 60 });
    failNext = true;

    // Never fails CLOSED: requests within the local limit are still allowed…
    const second = await rateLimit(key, { limit: 2, windowSeconds: 60 });
    expect(second.success).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[rate-limit]"),
      expect.objectContaining({ key })
    );

    // …but no longer fails fully OPEN: the per-instance limiter still
    // enforces the limit during the outage (previously every request passed).
    await rateLimit(key, { limit: 2, windowSeconds: 60 });
    const blocked = await rateLimit(key, { limit: 2, windowSeconds: 60 });
    expect(blocked.success).toBe(false);
    consoleSpy.mockRestore();
  });

  it("stops calling Redis for a cool-down period after a failure, so an outage doesn't tax every request", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rateLimit } = await import("@/lib/rate-limit");

    failNext = true;
    await rateLimit(`cooldown-a:${Math.random()}`, { limit: 5, windowSeconds: 60 });
    const callsAfterFailure = incrCalls;
    expect(callsAfterFailure).toBe(1);

    await rateLimit(`cooldown-b:${Math.random()}`, { limit: 5, windowSeconds: 60 });
    await rateLimit(`cooldown-c:${Math.random()}`, { limit: 5, windowSeconds: 60 });

    expect(incrCalls).toBe(callsAfterFailure);
    consoleSpy.mockRestore();
  });

  it("does not hang when Redis accepts the connection but never answers — it times out and degrades", async () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { rateLimit } = await import("@/lib/rate-limit");
      hangNext = true;

      const pending = rateLimit(`redis-hang:${Math.random()}`, { limit: 5, windowSeconds: 60 });
      await vi.advanceTimersByTimeAsync(1500);
      const result = await pending;

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("constructs the Redis client with automatic retries disabled", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    await rateLimit(`redis-no-retry:${Math.random()}`, { limit: 5, windowSeconds: 60 });

    expect((redisInstances[0]?.config as { retry?: unknown }).retry).toBe(false);
  });
});
