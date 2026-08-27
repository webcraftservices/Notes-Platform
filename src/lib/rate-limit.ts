/**
 * Minimal rate limiter.
 *
 * Dev/single-instance default: in-memory token bucket. This does NOT work
 * correctly across multiple server instances (spec §88 requires this to
 * protect auth, AI, and upload endpoints in production).
 *
 * Production swap: replace the Map-based store below with Upstash Redis
 * (`@upstash/ratelimit`) or an equivalent shared store — the function
 * signature is intentionally kept provider-agnostic so call sites never change.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export async function rateLimit(
  key: string,
  opts: { limit: number; windowSeconds: number }
): Promise<{ success: boolean; remaining: number }> {
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
