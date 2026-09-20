import { randomUUID } from "crypto";

/**
 * Lightweight request/correlation ID (Phase 9.2, spec §B). No request ID
 * existed anywhere in the app before this — no middleware header
 * injection, no AsyncLocalStorage context. Rather than rewrite
 * `middleware.ts` (which only wraps a subset of routes — see its
 * `config.matcher` — and would need to run on every route, including ones
 * outside that matcher, to be a real correlation mechanism), this is
 * called directly at the top of the one route this phase instruments,
 * mirroring how `logServerError`/`INTERNAL_ERROR` were introduced in
 * Phase 9.1: a small, reusable helper, adopted where it's actually needed
 * rather than forced everywhere at once.
 *
 * Reuses an incoming id when the platform/CDN already provides one
 * (`x-request-id` is a common reverse-proxy convention; `x-vercel-id` is
 * Vercel's own), so a single request's trace stays correlated end-to-end
 * instead of getting a second, disconnected id at this layer. Otherwise
 * generates a fresh opaque UUID — not derived from anything sensitive
 * (no user id, email, or session data folded in).
 */
export function getOrCreateRequestId(req: { headers: Headers }): string {
  const incoming = req.headers.get("x-request-id") || req.headers.get("x-vercel-id");
  return incoming || randomUUID();
}
