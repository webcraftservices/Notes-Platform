/**
 * Unified Operational Telemetry Facade (Stage C).
 *
 * Fans out redacted operational logs and metrics to both configured sinks:
 *   - Datadog HTTP intake (`DD_API_KEY`)
 *   - Azure Monitor / Application Insights (`APPLICATIONINSIGHTS_CONNECTION_STRING`)
 *
 * Preserves existing direct `sendDatadogLog`/`sendDatadogMetric` module APIs
 * while enabling dual-sink emission for new operational instrumentation.
 */

import {
  sendDatadogLog,
  sendDatadogMetric,
  type DatadogLogLevel,
  type DatadogMetricType,
} from "@/lib/observability/datadog";
import {
  sanitizeTelemetryProperties,
  sendAzureMonitorLog,
  sendAzureMonitorMetric,
} from "@/lib/observability/azure-monitor";
import { redactSensitiveText } from "@/lib/queue/logger";

export async function emitOperationalLog(entry: {
  level: DatadogLogLevel;
  message: string;
  [key: string]: unknown;
}): Promise<void> {
  const { level, message, ...rest } = entry;
  const safeRest = sanitizeTelemetryProperties(rest);
  const safeMessage = redactSensitiveText(message);

  await Promise.allSettled([
    sendDatadogLog({ level, message: safeMessage, ...safeRest }),
    sendAzureMonitorLog({ level, message: safeMessage, ...safeRest }),
  ]);
}

export async function emitOperationalMetric(
  name: string,
  value: number,
  options?: {
    type?: DatadogMetricType;
    tags?: string[];
    properties?: Record<string, unknown>;
  }
): Promise<void> {
  const properties = {
    ...(options?.properties ?? {}),
    ...(options?.tags?.length ? { tags: options.tags.join(",") } : {}),
  };

  await Promise.allSettled([
    sendDatadogMetric(name, value, { type: options?.type, tags: options?.tags }),
    sendAzureMonitorMetric(name, value, { properties }),
  ]);
}
