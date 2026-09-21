import { jsonError, logServerError } from "@/lib/api-response";
import { GoogleApiError, GOOGLE_RECONNECT_REQUIRED, GOOGLE_TEMPORARILY_UNAVAILABLE } from "@/lib/services/google-errors";
import { RequestTimeoutError } from "@/lib/fetch-timeout";

/**
 * Phase 9.4 — the one place the Google API routes turn an unexpected
 * failure into a response. These routes previously returned `err.message`
 * for *any* thrown value with a 502, which sent raw provider excerpts —
 * and, for a non-Google failure such as a Prisma error inside the import
 * transaction, internal error text — to the browser.
 *
 *   - GoogleApiError      → its `publicMessage` (already user-safe); 409 when
 *                           the fix is to reconnect, otherwise 502.
 *   - RequestTimeoutError → 504 with a generic "try again" message.
 *   - anything else       → logged server-side, generic 500.
 */
export function googleFailureResponse(err: unknown, context: { route: string; op: string; userId: string }) {
  if (err instanceof GoogleApiError) {
    logServerError(context, err);
    return jsonError(err.publicMessage, err.publicMessage === GOOGLE_RECONNECT_REQUIRED ? 409 : 502);
  }
  if (err instanceof RequestTimeoutError) {
    logServerError(context, err);
    return jsonError(GOOGLE_TEMPORARILY_UNAVAILABLE, 504);
  }
  logServerError(context, err);
  return jsonError("Something went wrong. Please try again.", 500);
}
