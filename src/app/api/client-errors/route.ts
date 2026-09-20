import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { clientErrorSchema } from "@/lib/validation/client-error";
import { logServerError } from "@/lib/api-response";
import { getOrCreateRequestId } from "@/lib/observability/request-id";

/**
 * Lets the client-side global error boundary (`app/error.tsx`) actually
 * reach server logs/Datadog (Phase 9.2, spec §C — before this phase that
 * boundary only did `console.error` in the browser, which nothing durable
 * ever saw). Deliberately unauthenticated — a crash can happen on the
 * sign-in page, before any session exists — so this mirrors
 * `/api/auth/register`'s IP-keyed rate limit (same convention, same
 * header) rather than inventing a new one, and every field is length-
 * capped by `clientErrorSchema` since this is a public write endpoint.
 *
 * This reports an error message/stack the user's OWN browser already
 * generated and displayed — never a channel for arbitrary application
 * data, and never used to fetch or attach anything else about the
 * request (no cookies/headers beyond the rate-limit key, no session
 * lookup).
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const { success } = await rateLimit(`client-errors:${ip}`, { limit: 20, windowSeconds: 60 });
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = clientErrorSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const requestId = getOrCreateRequestId(req);

  // logServerError reads err.message (not err.stack), so the client's
  // reported stack — if it sent one — is passed as an explicit context
  // field instead, alongside everything else safe to log.
  logServerError(
    {
      route: "client-errors",
      op: "report",
      boundary: parsed.data.boundary ?? "global",
      digest: parsed.data.digest,
      stack: parsed.data.stack,
      requestId,
    },
    new Error(parsed.data.message)
  );

  return NextResponse.json({ ok: true, requestId });
}
