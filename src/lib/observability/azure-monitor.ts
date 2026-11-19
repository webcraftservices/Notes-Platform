/**
 * Azure Monitor / Application Insights Direct HTTP Telemetry Client (Stage C).
 *
 * Submits redacted structured logs and operational metrics directly to the
 * Azure Monitor Breeze ingestion API (`POST {IngestionEndpoint}/v2.1/track`)
 * without heavy telemetry SDK agent dependencies in Node/edge bundles.
 *
 * Configured via `APPLICATIONINSIGHTS_CONNECTION_STRING`
 * (`InstrumentationKey=...;IngestionEndpoint=https://...`).
 *
 * Contract:
 *   - Safe no-op when unconfigured (zero overhead, never calls `fetch`).
 *   - NEVER throws or rejects — delivery failure only logs a single safe line.
 *   - Automatically redacts credentials, secrets, URLs with embedded passwords,
 *     and bearer tokens from all telemetry properties and messages.
 */

import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { redactSensitiveText } from "@/lib/queue/logger";

const AZURE_MONITOR_TIMEOUT_MS = 3_000;
const DEFAULT_INGESTION_ENDPOINT = "https://dc.services.visualstudio.com";

export type AzureMonitorSeverity = "error" | "warn" | "info";

export interface ParsedAppInsightsConnection {
  instrumentationKey: string;
  ingestionEndpoint: string;
}

const SENSITIVE_KEY_RE =
  /(?:password|secret|token|apikey|api_key|authorization|cookie|connectionstring|privatekey|refresh_token|access_token)/i;

const SEVERITY_LEVEL_CODE: Record<AzureMonitorSeverity, number> = {
  info: 1,
  warn: 2,
  error: 3,
};

export function parseAppInsightsConnectionString(
  raw: string | undefined,
  fallbackInstrumentationKey?: string
): ParsedAppInsightsConnection | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    const iKey = fallbackInstrumentationKey?.trim();
    if (!iKey) return null;
    return {
      instrumentationKey: iKey,
      ingestionEndpoint: DEFAULT_INGESTION_ENDPOINT,
    };
  }

  const parts = new Map<string, string>();
  for (const segment of trimmed.split(";")) {
    const eqIndex = segment.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = segment.slice(0, eqIndex).trim().toLowerCase();
    const value = segment.slice(eqIndex + 1).trim();
    if (key && value) {
      parts.set(key, value);
    }
  }

  const iKey = parts.get("instrumentationkey");
  if (!iKey) return null;

  const endpointRaw = parts.get("ingestionendpoint") || DEFAULT_INGESTION_ENDPOINT;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpointRaw);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }

  return {
    instrumentationKey: iKey,
    ingestionEndpoint: parsedUrl.origin,
  };
}

export function sanitizeTelemetryProperties(
  input: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = "<redacted>";
      continue;
    }
    if (value === null) {
      out[key] = "null";
    } else if (typeof value === "string") {
      out[key] = redactSensitiveText(value).slice(0, 1024);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    } else {
      try {
        out[key] = redactSensitiveText(JSON.stringify(value)).slice(0, 1024);
      } catch {
        out[key] = "[unserializable]";
      }
    }
  }
  return out;
}

function getParsedConfig(
  env: NodeJS.ProcessEnv = process.env
): ParsedAppInsightsConnection | null {
  return parseAppInsightsConnectionString(
    env.APPLICATIONINSIGHTS_CONNECTION_STRING,
    env.APPLICATIONINSIGHTS_INSTRUMENTATION_KEY
  );
}

export function resolveAzureCloudRoleName(
  env: Record<string, string | undefined> = process.env
): string {
  const explicit =
    env.AZURE_CLOUD_ROLE_NAME?.trim() || env.ZENOTE_SERVICE_ROLE?.trim();
  if (explicit) return explicit;

  const ddService = env.DD_SERVICE?.trim();
  if (ddService && ddService !== "notes-platform") {
    return ddService;
  }

  if (env.ZENOTE_WORKER_BUNDLED === "true") {
    return "zenote-worker";
  }

  return "zenote-web";
}

function getCloudRoleTags(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const roleName = resolveAzureCloudRoleName(env);
  const version = env.DD_VERSION?.trim() || env.GIT_SHA?.trim();
  return {
    "ai.cloud.role": roleName,
    ...(version ? { "ai.application.ver": version } : {}),
  };
}

interface BreezeTrackResponseBody {
  itemsReceived?: unknown;
  itemsAccepted?: unknown;
  errors?: Array<{
    index?: unknown;
    statusCode?: unknown;
    message?: unknown;
  }>;
}

async function inspectBreezeTrackResponse(
  res: Response,
  kind: "log" | "metric",
  metricName?: string
): Promise<void> {
  if (res.ok && res.status !== 206) {
    return;
  }

  let parsedBody: BreezeTrackResponseBody | null = null;
  if (typeof res.text === "function") {
    try {
      const rawText = await res.text();
      if (rawText) {
        parsedBody = JSON.parse(rawText) as BreezeTrackResponseBody;
      }
    } catch {
      parsedBody = null;
    }
  }

  const itemsReceived =
    typeof parsedBody?.itemsReceived === "number" ? parsedBody.itemsReceived : undefined;
  const itemsAccepted =
    typeof parsedBody?.itemsAccepted === "number" ? parsedBody.itemsAccepted : undefined;
  const rawErrors = Array.isArray(parsedBody?.errors) ? parsedBody.errors : [];

  if (
    res.status === 206 &&
    itemsReceived !== undefined &&
    itemsAccepted !== undefined &&
    itemsAccepted >= itemsReceived &&
    rawErrors.length === 0
  ) {
    return;
  }

  const safeErrors = rawErrors.slice(0, 3).map((item) => ({
    index: typeof item?.index === "number" ? item.index : undefined,
    statusCode: typeof item?.statusCode === "number" ? item.statusCode : undefined,
    message:
      typeof item?.message === "string"
        ? redactSensitiveText(item.message).slice(0, 256)
        : undefined,
  }));

  console.error(
    res.status === 206
      ? `[observability] Azure Monitor track API partially rejected ${kind} payload`
      : `[observability] Azure Monitor track API rejected ${kind} payload`,
    {
      status: res.status,
      ...(metricName ? { metric: metricName } : {}),
      ...(itemsReceived !== undefined ? { itemsReceived } : {}),
      ...(itemsAccepted !== undefined ? { itemsAccepted } : {}),
      ...(safeErrors.length > 0 ? { errors: safeErrors } : {}),
    }
  );
}

export async function sendAzureMonitorLog(entry: {
  level: AzureMonitorSeverity;
  message: string;
  [key: string]: unknown;
}): Promise<void> {
  const config = getParsedConfig();
  if (!config) return;

  try {
    const { level, message, ...rest } = entry;
    const envelope = [
      {
        name: "Microsoft.ApplicationInsights.Message",
        time: new Date().toISOString(),
        iKey: config.instrumentationKey,
        tags: getCloudRoleTags(),
        data: {
          baseType: "MessageData",
          baseData: {
            ver: 2,
            message: redactSensitiveText(message).slice(0, 4096),
            severityLevel: SEVERITY_LEVEL_CODE[level],
            properties: sanitizeTelemetryProperties({
              env: process.env.DD_ENV || process.env.NODE_ENV || "development",
              ...rest,
            }),
          },
        },
      },
    ];

    const res = await fetchWithTimeout(
      `${config.ingestionEndpoint}/v2.1/track`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      },
      { timeoutMs: AZURE_MONITOR_TIMEOUT_MS, label: "Azure Monitor log track" }
    );
    await inspectBreezeTrackResponse(res, "log");
  } catch (err) {
    console.error("[observability] failed to deliver log to Azure Monitor", {
      error: redactSensitiveText(err instanceof Error ? err.message : String(err)),
    });
  }
}

export async function sendAzureMonitorMetric(
  name: string,
  value: number,
  options?: { properties?: Record<string, unknown> }
): Promise<void> {
  const config = getParsedConfig();
  if (!config) return;

  try {
    const envelope = [
      {
        name: "Microsoft.ApplicationInsights.Metric",
        time: new Date().toISOString(),
        iKey: config.instrumentationKey,
        tags: getCloudRoleTags(),
        data: {
          baseType: "MetricData",
          baseData: {
            ver: 2,
            metrics: [
              {
                name,
                kind: 0,
                value,
                count: 1,
              },
            ],
            properties: sanitizeTelemetryProperties({
              env: process.env.DD_ENV || process.env.NODE_ENV || "development",
              ...(options?.properties ?? {}),
            }),
          },
        },
      },
    ];

    const res = await fetchWithTimeout(
      `${config.ingestionEndpoint}/v2.1/track`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      },
      { timeoutMs: AZURE_MONITOR_TIMEOUT_MS, label: "Azure Monitor metric track" }
    );
    await inspectBreezeTrackResponse(res, "metric", name);
  } catch (err) {
    console.error("[observability] failed to deliver metric to Azure Monitor", {
      metric: name,
      error: redactSensitiveText(err instanceof Error ? err.message : String(err)),
    });
  }
}
