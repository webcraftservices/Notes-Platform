import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { sendDatadogLog } from "@/lib/observability/datadog";

/**
 * `extra` merges additional stable, machine-readable fields into the body
 * (e.g. `{ code: "AI_QUOTA_EXCEEDED" }`) alongside the human-readable
 * `error` message — added for Phase 5 Task 6 so quota/rate-limit
 * responses carry a code the frontend can branch on without string-
 * matching `error`. Never put secrets, stack traces, or DB internals in
 * `extra` (spec §13/§87).
 */
export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function zodError(error: ZodError) {
  const first = error.issues[0];
  return jsonError(first?.message ?? "Invalid input", 400);
}

export const UNAUTHORIZED = () => jsonError("You need to sign in to do that.", 401);
export const FORBIDDEN = () => jsonError("You don't have access to this.", 403);
export const NOT_FOUND = () => jsonError("Not found.", 404);
export const CONFLICT = (message = "This already exists.") => jsonError(message, 409);

/**
 * Generic fallback for a genuinely unexpected server-side failure — a bug,
 * not a known/expected condition (Phase 9.1, spec §13/§14). Deliberately
 * generic: never pass the caught error's own message here, since it may
 * contain stack details, file paths, or provider/DB internals (spec §13).
 * Call `logServerError` alongside this so the failure is still diagnosable
 * from server logs even though the client only sees this safe message.
 */
export const INTERNAL_ERROR = () => jsonError("Something went wrong. Please try again.", 500);

/**
 * Structured server-side error logging (spec §15/§89, extended in Phase
 * 9.2 §A/§Step3) for the failures that reach `INTERNAL_ERROR`/`SERVICE_
 * UNAVAILABLE` — i.e. failures that were NOT one of the app's known/
 * expected error types (auth, validation, not-found, quota, rate-limit,
 * service-not-configured, ...), which already have their own specific
 * status codes and don't need this.
 *
 * Mirrors the existing `console.error("[scope] message", {...context})`
 * convention already used in lib/ai-usage.ts — this is not a new logging
 * framework, just a shared shape for the context that convention already
 * carries ad hoc at each call site. As of Phase 9.2 the same safe context
 * is also forwarded to Datadog (a no-op when DD_API_KEY isn't set — see
 * lib/observability/datadog.ts) so these failures are visible in
 * production monitoring, not just local/platform console output.
 *
 * Never pass secrets, tokens, full prompts, raw document/transcript
 * contents, or other sensitive values in `context` — everything here is
 * both a local console line AND, in production, a Datadog log event.
 */
export function logServerError(context: { route: string; op?: string; [key: string]: unknown }, err: unknown) {
  const { route, ...rest } = context;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[api:${route}]`, { ...rest, error: message });
  // Fire-and-forget: never delays or fails the response this is called
  // from. sendDatadogLog itself never throws/rejects (see its doc
  // comment); .catch is defensive belt-and-braces in case that contract
  // is ever violated by a future edit.
  void sendDatadogLog({ level: "error", message: `${route}: ${message}`, route, ...rest }).catch(() => {});
}
