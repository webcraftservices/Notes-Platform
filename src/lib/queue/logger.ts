/**
 * Safe structured JSON/text runtime logger for queue dispatchers, background
 * workers, and container lifecycle events.
 *
 * Strictly redacts connection URLs, tokens, credentials, and raw stacks from
 * public/structured output so secrets never reach container stdout/stderr.
 */

export type RuntimeLogLevel = "info" | "warn" | "error";

export interface RuntimeLogContext {
  service: "zenote-web" | "zenote-worker" | "zenote-queue";
  event: string;
  jobId?: string | null;
  queueJobId?: string | null;
  type?: string | null;
  workerId?: string | null;
  correlationId?: string | null;
  durationMs?: number;
  errorCategory?: string;
  [key: string]: unknown;
}

const URL_CREDENTIALS_RE = /(rediss?|postgres(?:ql)?|https?):\/\/([^/\s:@]+):([^@\s/]+)@/gi;
const BEARER_TOKEN_RE = /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi;
const KV_SECRET_RE =
  /\b(password|passwd|secret|token|apikey|api_key|access_token|refresh_token|client_secret|sharedaccesskey|sig)\s*=\s*([^\s&;,"']+)/gi;

export function redactSensitiveText(input: string): string {
  return input
    .replace(URL_CREDENTIALS_RE, "$1://<redacted>@")
    .replace(BEARER_TOKEN_RE, "$1<redacted>")
    .replace(KV_SECRET_RE, "$1=<redacted>");
}

export function classifyRuntimeError(err: unknown): string {
  if (!err || typeof err !== "object") return "unknown";
  const record = err as { code?: unknown; name?: unknown; status?: unknown };
  if (typeof record.code === "string" && record.code.trim()) {
    return record.code.trim();
  }
  if (typeof record.status === "number") {
    return `http_${record.status}`;
  }
  if (typeof record.name === "string" && record.name !== "Error") {
    return record.name;
  }
  return "runtime_error";
}

export function logRuntimeEvent(
  level: RuntimeLogLevel,
  context: RuntimeLogContext,
  err?: unknown
): void {
  const isJson =
    process.env.LOG_FORMAT === "json" || process.env.NODE_ENV === "production";

  const errorMessage =
    err instanceof Error
      ? redactSensitiveText(err.message)
      : typeof err === "string"
        ? redactSensitiveText(err)
        : undefined;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ...context,
  };

  if (err !== undefined) {
    entry.errorCategory = context.errorCategory ?? classifyRuntimeError(err);
    if (errorMessage) {
      entry.error = errorMessage;
    }
  }

  if (typeof entry.message === "string") {
    entry.message = redactSensitiveText(entry.message);
  }

  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (isJson) {
    sink(JSON.stringify(entry));
  } else {
    const tag = `[${context.service}:${context.event}]`;
    const meta = { ...entry };
    delete meta.ts;
    delete meta.level;
    delete meta.service;
    delete meta.event;
    if (Object.keys(meta).length > 0) {
      sink(tag, meta);
    } else {
      sink(tag);
    }
  }
}

