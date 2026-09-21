/**
 * Phase 9.4 — one shared way to put an explicit upper bound on every
 * outbound `fetch` this app makes to a third party (Google, AssemblyAI,
 * OpenAI Whisper, Datadog). Node's global `fetch` has no overall timeout:
 * a provider that accepts the connection and then stalls would otherwise
 * hold the caller — an API route, or a background job — open until the
 * runtime's own (multi-minute) socket timeouts fire, or forever.
 *
 * `AbortSignal.timeout()` covers the whole exchange including reading the
 * response body, which is what we want: the caller is expected to consume
 * the body (`res.json()`, `res.arrayBuffer()`) before the budget expires.
 *
 * The thrown error deliberately contains only the caller-supplied label
 * and the budget — never the URL (which can embed file ids or tokens in
 * its query string) and never any request/response content.
 */
export class RequestTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`);
    this.name = "RequestTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit | undefined,
  options: { timeoutMs: number; label: string }
): Promise<Response> {
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new RequestTimeoutError(options.label, options.timeoutMs);
    }
    throw err;
  }
}
