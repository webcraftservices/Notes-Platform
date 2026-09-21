/**
 * Minimal Datadog client (Phase 9.2, spec Step 3 / §A / §F).
 *
 * Submits structured logs and a small set of counters/gauges directly to
 * Datadog's HTTP intake APIs via `fetch` — no `dd-trace` agent process, no
 * DogStatsD/UDP client. This is a deliberate choice, not a placeholder:
 *
 *   - The deployment target for this app isn't pinned in the repo (no
 *     Dockerfile/vercel.json/CI workflow), and both `dd-trace` APM and
 *     DogStatsD-based metrics libraries assume a Datadog Agent (or a
 *     platform-specific Lambda extension) is reachable alongside the
 *     process. That can't be assumed here.
 *   - Direct HTTP submission works identically on a traditional Node
 *     server, a container, or a serverless platform, and needs nothing
 *     running beside the app.
 *   - It matches this codebase's existing convention of calling external
 *     HTTP APIs directly rather than adding a provider SDK (see
 *     services/google-drive.ts, services/speech-openai.ts).
 *
 * See docs/observability.md for why full Datadog APM/tracing was
 * evaluated and NOT implemented this phase, and what a later upgrade to
 * `dd-trace` would look like once a concrete deployment target exists.
 *
 * Every export here is a safe no-op when `DD_API_KEY` is unset — local
 * development and any environment without Datadog configured behaves
 * exactly as it did before this phase — and NEVER throws or rejects:
 * a Datadog outage or misconfiguration must never affect the caller's
 * own request/response. Callers should not `await` these on a request's
 * hot path; fire-and-forget is the intended usage (the returned promise
 * exists mainly so tests can await it).
 */

import { fetchWithTimeout } from "@/lib/fetch-timeout";

/**
 * Phase 9.4 — bound every intake call. Callers fire these without awaiting
 * them, so without a timeout a Datadog outage that accepts connections but
 * never answers would leave one hung request (socket + buffered payload)
 * behind for every log/metric emitted, growing for as long as the outage
 * lasts. Failure is already swallowed and only noted locally.
 */
const DATADOG_INTAKE_TIMEOUT_MS = 3000;

export type DatadogLogLevel = "error" | "warn" | "info";

export interface DatadogLogEntry {
  level: DatadogLogLevel;
  message: string;
  /**
   * Additional safe, structured fields (route, op, requestId, provider,
   * durationMs, ...). Callers are responsible for never putting secrets,
   * tokens, prompts, document/transcript contents, or other sensitive
   * values here — see logServerError's doc comment in api-response.ts,
   * which is the one place in the app that calls this today.
   */
  [key: string]: unknown;
}

export type DatadogMetricType = "count" | "gauge";

/** Datadog Metrics API v2 `type` field: 0=unspecified, 1=count, 2=rate, 3=gauge. */
const METRIC_TYPE_CODE: Record<DatadogMetricType, number> = { count: 1, gauge: 3 };

function isConfigured(): boolean {
  return !!process.env.DD_API_KEY;
}

/** e.g. "datadoghq.com" (default/US1), "us5.datadoghq.com", "datadoghq.eu", ... */
function ddSite(): string {
  return process.env.DD_SITE || "datadoghq.com";
}

function baseTags(): string[] {
  const tags = [
    `service:${process.env.DD_SERVICE || "notes-platform"}`,
    `env:${process.env.DD_ENV || process.env.NODE_ENV || "development"}`,
  ];
  if (process.env.DD_VERSION) tags.push(`version:${process.env.DD_VERSION}`);
  return tags;
}

function logIntakeUrl(): string {
  return `https://http-intake.logs.${ddSite()}/api/v2/logs`;
}

function metricsIntakeUrl(): string {
  return `https://api.${ddSite()}/api/v2/series`;
}

/**
 * Sends one structured log event to Datadog Logs intake (v2). Resolves
 * (never rejects) once the attempt — success or failure — is done; a
 * delivery failure is only noted locally via `console.error`, once, so it
 * doesn't cascade into the caller's own error handling.
 */
export async function sendDatadogLog(entry: DatadogLogEntry): Promise<void> {
  if (!isConfigured()) return;

  try {
    const { level, message, ...rest } = entry;
    const res = await fetchWithTimeout(
      logIntakeUrl(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "DD-API-KEY": process.env.DD_API_KEY! },
        body: JSON.stringify([
          {
            message,
            status: level,
            ddsource: "nodejs",
            service: process.env.DD_SERVICE || "notes-platform",
            ddtags: baseTags().join(","),
            ...rest,
          },
        ]),
      },
      { timeoutMs: DATADOG_INTAKE_TIMEOUT_MS, label: "Datadog log intake" }
    );
    if (!res.ok) {
      console.error("[observability] Datadog log intake rejected the request", { status: res.status });
    }
  } catch (err) {
    console.error("[observability] failed to deliver log to Datadog", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Submits one metric point to Datadog's Metrics API v2. Same
 * never-throws/never-rejects contract as `sendDatadogLog` above.
 */
export async function sendDatadogMetric(
  name: string,
  value: number,
  options?: { type?: DatadogMetricType; tags?: string[] }
): Promise<void> {
  if (!isConfigured()) return;

  try {
    const type = options?.type ?? "count";
    const res = await fetchWithTimeout(
      metricsIntakeUrl(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "DD-API-KEY": process.env.DD_API_KEY! },
        body: JSON.stringify({
          series: [
            {
              metric: name,
              type: METRIC_TYPE_CODE[type],
              points: [{ timestamp: Math.floor(Date.now() / 1000), value }],
              tags: [...baseTags(), ...(options?.tags ?? [])],
            },
          ],
        }),
      },
      { timeoutMs: DATADOG_INTAKE_TIMEOUT_MS, label: "Datadog metrics intake" }
    );
    if (!res.ok) {
      console.error("[observability] Datadog metrics intake rejected the request", { metric: name, status: res.status });
    }
  } catch (err) {
    console.error("[observability] failed to deliver metric to Datadog", {
      metric: name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
