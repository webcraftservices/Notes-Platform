import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function zodError(error: ZodError) {
  const first = error.issues[0];
  return jsonError(first?.message ?? "Invalid input", 400);
}

export const UNAUTHORIZED = () => jsonError("You need to sign in to do that.", 401);
export const FORBIDDEN = () => jsonError("You don't have access to this.", 403);
export const NOT_FOUND = () => jsonError("Not found.", 404);
