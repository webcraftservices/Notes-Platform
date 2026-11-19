import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseAppInsightsConnectionString,
  resolveAzureCloudRoleName,
  sanitizeTelemetryProperties,
  sendAzureMonitorLog,
  sendAzureMonitorMetric,
} from "@/lib/observability/azure-monitor";
import { emitOperationalLog, emitOperationalMetric } from "@/lib/observability/telemetry";

describe("Stage C — Azure Monitor & Unified Operational Telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses APPLICATIONINSIGHTS_CONNECTION_STRING and redacts sensitive fields", () => {
    const parsed = parseAppInsightsConnectionString(
      "InstrumentationKey=11111111-1111-1111-1111-111111111111;IngestionEndpoint=https://eastus-8.in.applicationinsights.azure.com/;LiveEndpoint=https://eastus.livediagnostics.monitor.azure.com/"
    );
    expect(parsed).toEqual({
      instrumentationKey: "11111111-1111-1111-1111-111111111111",
      ingestionEndpoint: "https://eastus-8.in.applicationinsights.azure.com",
    });

    const sanitized = sanitizeTelemetryProperties({
      route: "billing/checkout",
      dbUrl: "postgresql://admin:supersecret@db.internal:5432/app",
      apiKey: "sk-should-be-redacted",
      authHeader: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    });
    expect(sanitized.route).toBe("billing/checkout");
    expect(sanitized.dbUrl).toBe("postgresql://<redacted>@db.internal:5432/app");
    expect(sanitized.apiKey).toBe("<redacted>");
    expect(sanitized.authHeader).not.toContain("eyJhbGci");
  });

  it("is a complete no-op when APPLICATIONINSIGHTS_CONNECTION_STRING is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await sendAzureMonitorLog({ level: "error", message: "test" });
    await sendAzureMonitorMetric("worker.job.failed", 1);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs Breeze v2.1/track envelopes for logs and metrics and never throws on intake errors", async () => {
    vi.stubEnv(
      "APPLICATIONINSIGHTS_CONNECTION_STRING",
      "InstrumentationKey=ikey-123;IngestionEndpoint=https://centralus.in.applicationinsights.azure.com/"
    );
    vi.stubEnv("DD_API_KEY", "dd-test-key");

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await emitOperationalLog({
      level: "error",
      message: "Failure connecting to postgres://u:pw@host:5432/db",
      route: "materials/process",
      token: "must-redact",
    });

    await emitOperationalMetric("worker.job.completed", 1, {
      type: "count",
      tags: ["job_type:DOCUMENT_EXTRACTION"],
    });

    // Both Datadog and Azure Monitor received POST requests
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("in.applicationinsights.azure.com/v2.1/track"))).toBe(true);
    expect(urls.some((u) => u.includes("datadoghq.com"))).toBe(true);

    const azureCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("v2.1/track")
    )!;
    const payload = String((azureCall[1] as RequestInit).body);
    expect(payload).not.toContain("u:pw");
    expect(payload).not.toContain("must-redact");

    // Never rejects if Azure Monitor intake returns 500 or rejects
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(
      sendAzureMonitorMetric("worker.job.failed", 1)
    ).resolves.toBeUndefined();
  });

  it("never misclassifies web as worker via WORKER_HEALTH_PORT and inspects HTTP 206 partial Breeze responses safely (AUD-07)", async () => {
    expect(
      resolveAzureCloudRoleName({
        WORKER_HEALTH_PORT: "3001",
        DD_SERVICE: "notes-platform",
      })
    ).toBe("zenote-web");

    expect(
      resolveAzureCloudRoleName({
        AZURE_CLOUD_ROLE_NAME: "zenote-production-worker",
        WORKER_HEALTH_PORT: "3001",
      })
    ).toBe("zenote-production-worker");

    expect(
      resolveAzureCloudRoleName({
        ZENOTE_WORKER_BUNDLED: "true",
      })
    ).toBe("zenote-worker");

    vi.stubEnv(
      "APPLICATIONINSIGHTS_CONNECTION_STRING",
      "InstrumentationKey=ikey-206;IngestionEndpoint=https://eastus.in.applicationinsights.azure.com/"
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 206,
      text: async () =>
        JSON.stringify({
          itemsReceived: 1,
          itemsAccepted: 0,
          errors: [
            {
              index: 0,
              statusCode: 400,
              message: "Invalid field token=secret-value-leak",
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendAzureMonitorLog({ level: "error", message: "health degraded" });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [msg, meta] = consoleErrorSpy.mock.calls[0]!;
    expect(String(msg)).toContain("partially rejected");
    expect(meta).toMatchObject({
      status: 206,
      itemsReceived: 1,
      itemsAccepted: 0,
    });
    expect(JSON.stringify(meta)).not.toContain("secret-value-leak");
  });

  it("aligns Azure Monitor alert rules and dashboard KQL with genuinely emitted Breeze fields and runtime failure tokens (NEW-04)", async () => {
    vi.stubEnv(
      "APPLICATIONINSIGHTS_CONNECTION_STRING",
      "InstrumentationKey=ikey-kql;IngestionEndpoint=https://eastus.in.applicationinsights.azure.com/"
    );
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await sendAzureMonitorMetric("worker.job.duration_ms", 123, {
      properties: { type: "EMBEDDING" },
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    const metricPoint = body[0].data.baseData.metrics[0];
    expect(metricPoint).toMatchObject({
      name: "worker.job.duration_ms",
      kind: 0,
      value: 123,
      count: 1,
    });
    // Breeze payload only emits `value` + `count: 1` (maps to `Sum` in AppMetrics, never unpopulated `max`)
    expect(metricPoint.max).toBeUndefined();

    const root = process.cwd();
    const alertsBicep = fs.readFileSync(
      path.join(root, "infra/monitoring/azure-monitor-alerts.bicep"),
      "utf8"
    );
    const dashboardRaw = fs.readFileSync(
      path.join(root, "infra/monitoring/dashboard-spec.json"),
      "utf8"
    );

    expect(dashboardRaw).not.toContain("max(Max)");
    expect(dashboardRaw).toContain("max(Sum)");

    for (const token of [
      "[api:health]",
      "worker_health_unhealthy",
      "fatal_startup_error",
      "runtime_config_validation_failed",
      "key_vault_hydration_failed",
    ]) {
      expect(alertsBicep).toContain(token);
      expect(dashboardRaw).toContain(token);
    }
  });
});
