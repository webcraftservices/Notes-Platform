import { RequestTimeoutError } from "@/lib/fetch-timeout";

/**
 * Phase 9.4 — a typed failure for anything that goes wrong talking to
 * Google (Drive/Docs REST, OAuth token endpoints).
 *
 * Why this exists: these calls used to throw plain `Error`s whose message
 * could include a slice of Google's raw response body, and the two API
 * routes that surface them (integrations/google/files and .../import)
 * echoed `err.message` straight to the browser — including for errors
 * that were not Google's at all (a Prisma failure inside the import path
 * reached the client verbatim). `publicMessage` is the ONLY text a route
 * may show a user; `message` (which may carry a status code and a short
 * provider excerpt) is for job records and server-side logs.
 */
export class GoogleApiError extends Error {
  readonly status: number | undefined;
  readonly publicMessage: string;

  constructor(message: string, options: { status?: number; publicMessage: string }) {
    super(message);
    this.name = "GoogleApiError";
    this.status = options.status;
    this.publicMessage = options.publicMessage;
  }

  /** Transient by Google's own semantics: rate limited (429) or a server-side failure (5xx). */
  get isTransient(): boolean {
    return this.status === 429 || (typeof this.status === "number" && this.status >= 500);
  }
}

export class GoogleFileTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`This file is larger than your plan's ${Math.round(limitBytes / (1024 * 1024))}MB per-file limit.`);
    this.name = "GoogleFileTooLargeError";
  }
}

export const GOOGLE_TEMPORARILY_UNAVAILABLE = "Google Drive is temporarily unavailable. Please try again in a moment.";
export const GOOGLE_RECONNECT_REQUIRED = "Google Drive access has expired or was revoked. Reconnect Google Drive to continue.";

/**
 * Whether a failed Google call is worth retrying: only transient failures
 * — Google-side 429/5xx, our own request timeout, or a transport-level
 * network error. A revoked grant (400/401), a missing file (404), a
 * rate/permission refusal (403) and an oversized file are never retried:
 * they would fail identically, and hammering Google with them is exactly
 * the retry storm this list exists to prevent.
 */
export function isRetryableGoogleError(err: unknown): boolean {
  if (err instanceof GoogleApiError) return err.isTransient;
  if (err instanceof GoogleFileTooLargeError) return false;
  if (err instanceof RequestTimeoutError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /(?:fetch failed|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN)/i.test(message);
}
