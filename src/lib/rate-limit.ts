/**
 * Rate limiter with a production-grade distributed backend and a local
 * development fallback (Phase 9.1, spec §9/§88).
 *
 * Production (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set):
 *   Shared state in Upstash Redis via the official `@upstash/redis` REST
 *   client. Every server instance / serverless invocation reads and
 *   writes the same bucket, so a user's limit can't be reset just by
 *   landing on a different instance.
 *
 * Local development (no Redis env vars):
 *   Falls back to the original in-memory Map-based bucket. This is
 *   intentionally NOT distributed — it only protects a single process —
 *   and is never used when Redis is configured. It exists purely so the
 *   app keeps working with zero setup locally (spec §10).
 *
 * The public function signature is unchanged from the pre-9.1
 * implementation on purpose: every existing call site (`rateLimit(key,
 * { limit, windowSeconds })`) keeps working without modification.
 */

import { Redis } from "@upstash/redis";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
}

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

// --- In-memory fallback (single-instance only — see module doc above) -----

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function inMemoryRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowSeconds * 1000 });
    return { success: true, remaining: opts.limit - 1 };
  }

  if (bucket.count >= opts.limit) {
    return { success: false, remaining: 0 };
  }

  bucket.count += 1;
  return { success: true, remaining: opts.limit - bucket.count };
}

// --- Upstash Redis backend (production / any multi-instance deployment) ---

/**
 * A fresh client is constructed per call rather than cached as a module
 * singleton. The Upstash client is a thin stateless REST wrapper (there is
 * no persistent connection to hold open), so this costs nothing at
 * runtime, and it keeps this module free of long-lived state that would
 * otherwise need explicit resetting between requests/tests.
 */
function getRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * Fixed-window counter. `INCR` is atomic in Redis, so concurrent requests
 * against the same key can never under-count each other; the TTL is set
 * only on the request that takes the count to 1 (i.e. the request that
 * created the key), which is the standard, simplest-robust fixed-window
 * pattern — deliberately not `@upstash/ratelimit`'s sliding-window
 * algorithm, to keep this a small, easily-reviewed change on top of the
 * existing (already fixed-window) in-memory behavior rather than a new
 * algorithm with different edge-case semantics.
 *
 * Key strategy: `ratelimit:<key>` — namespaced so this never collides with
 * unrelated data if the same Redis instance is reused for something else.
 */
async function redisRateLimit(redis: Redis, key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;

  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      // Only the request that just created the key sets its expiry, so a
      // concurrent request that also observes count === 1 (a benign race
      // right at window creation) just re-issues the same TTL — never a
      // correctness problem, at worst a redundant EXPIRE call.
      await redis.expire(redisKey, opts.windowSeconds);
    }

    if (count > opts.limit) {
      return { success: false, remaining: 0 };
    }
    return { success: true, remaining: Math.max(0, opts.limit - count) };
  } catch (err) {
    // Fail OPEN, not closed: a Redis-side hiccup should not take down
    // every rate-limited endpoint in the app (auth, AI chat, uploads,
    // search — see every rateLimit() call site). The alternative
    // (fail closed) would turn a transient Redis outage into a total
    // outage of those features. This is logged loudly so a sustained
    // Redis outage is visible in server logs rather than silently
    // disabling rate limiting.
    console.error("[rate-limit] Redis request failed — failing open for this check", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: true, remaining: opts.limit };
  }
}

// --- Public API -------------------------------------------------------------

export async function rateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const redis = getRedisClient();
  if (redis) return redisRateLimit(redis, key, opts);
  return inMemoryRateLimit(key, opts);
}

export type RedisHealthStatus =
  | { configured: false }
  | { configured: true; reachable: true }
  | { configured: true; reachable: false; error: string };

/**
 * For the readiness endpoint (Phase 9.2, spec §E) — NOT used by rateLimit()
 * itself. A single `PING` is cheap enough to do for real (unlike a real AI
 * call, which spec §E explicitly says never to make here), so this
 * reports actual reachability when Redis is configured, rather than just
 * "the env vars exist". When Redis isn't configured at all, that's not a
 * failure — the app is deliberately, safely running on the in-memory
 * fallback (see module doc above) — so this reports `configured: false`
 * rather than `reachable: false`.
 */
export async function checkRedisHealth(): Promise<RedisHealthStatus> {
  const redis = getRedisClient();
  if (!redis) return { configured: false };

  try {
    await redis.ping();
    return { configured: true, reachable: true };
  } catch (err) {
    return { configured: true, reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}
