import { NextResponse } from "next/server";
import type { ZodError } from "zod";

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
