import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Datadog observability client", () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.DD_API_KEY;
    delete process.env.DD_SITE;
    delete process.env.DD_SERVICE;
    delete process.env.DD_ENV;
    delete process.env.DD_VERSION;
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  describe("without DD_API_KEY configured", () => {
    it("sendDatadogLog is a safe no-op — never calls fetch", async () => {
      const { sendDatadogLog } = await import("@/lib/observability/datadog");

      await sendDatadogLog({ level: "error", message: "boom" });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sendDatadogMetric is a safe no-op — never calls fetch", async () => {
      const { sendDatadogMetric } = await import("@/lib/observability/datadog");

      await sendDatadogMetric("ai.chat.failures", 1);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("with DD_API_KEY configured", () => {
    beforeEach(() => {
      process.env.DD_API_KEY = "test-dd-key";
    });

    it("sendDatadogLog POSTs to the v2 logs intake with the API key header and safe fields", async () => {
      const { sendDatadogLog } = await import("@/lib/observability/datadog");

      await sendDatadogLog({ level: "error", message: "ai/messages: boom", route: "ai/messages", requestId: "req-1" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://http-intake.logs.datadoghq.com/api/v2/logs");
      expect(init.method).toBe("POST");
      expect(init.headers["DD-API-KEY"]).toBe("test-dd-key");
      expect(init.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(init.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toMatchObject({
        message: "ai/messages: boom",
        status: "error",
        route: "ai/messages",
        requestId: "req-1",
        ddsource: "nodejs",
        service: "notes-platform",
      });
    });

    it("sendDatadogMetric POSTs to the v2 series intake with correct type codes and tags", async () => {
      const { sendDatadogMetric } = await import("@/lib/observability/datadog");

      await sendDatadogMetric("ai.chat.latency_ms", 842, { type: "gauge", tags: ["provider:gemini", "outcome:success"] });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.datadoghq.com/api/v2/series");
      expect(init.headers["DD-API-KEY"]).toBe("test-dd-key");

      const body = JSON.parse(init.body);
      const series = body.series[0];
      expect(series.metric).toBe("ai.chat.latency_ms");
      expect(series.type).toBe(3); // gauge
      expect(series.points[0].value).toBe(842);
      expect(typeof series.points[0].timestamp).toBe("number");
      expect(series.tags).toEqual(expect.arrayContaining(["provider:gemini", "outcome:success", "service:notes-platform"]));
    });

    it("defaults metric type to count (type code 1) when not specified", async () => {
      const { sendDatadogMetric } = await import("@/lib/observability/datadog");

      await sendDatadogMetric("ai.chat.failures", 1);

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body);
      expect(body.series[0].type).toBe(1);
    });

    it("respects DD_SITE for a non-default Datadog region", async () => {
      process.env.DD_SITE = "datadoghq.eu";
      const { sendDatadogLog } = await import("@/lib/observability/datadog");

      await sendDatadogLog({ level: "warn", message: "x" });

      const [url] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://http-intake.logs.datadoghq.eu/api/v2/logs");
    });

    it("includes DD_SERVICE/DD_ENV/DD_VERSION as tags when set", async () => {
      process.env.DD_SERVICE = "custom-service";
      process.env.DD_ENV = "staging";
      process.env.DD_VERSION = "1.2.3";
      const { sendDatadogMetric } = await import("@/lib/observability/datadog");

      await sendDatadogMetric("test.metric", 1);

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body);
      expect(body.series[0].tags).toEqual(
        expect.arrayContaining(["service:custom-service", "env:staging", "version:1.2.3"])
      );
    });

    it("never throws or rejects when the Datadog request itself fails", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { sendDatadogLog, sendDatadogMetric } = await import("@/lib/observability/datadog");

      await expect(sendDatadogLog({ level: "error", message: "x" })).resolves.toBeUndefined();
      await expect(sendDatadogMetric("x", 1)).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("never throws when Datadog responds with a non-2xx status", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 403 });
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { sendDatadogLog } = await import("@/lib/observability/datadog");

      await expect(sendDatadogLog({ level: "error", message: "x" })).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[observability]"),
        expect.objectContaining({ status: 403 })
      );

      consoleSpy.mockRestore();
    });

    it("never includes the API key value anywhere in the request body", async () => {
      const { sendDatadogLog } = await import("@/lib/observability/datadog");

      await sendDatadogLog({ level: "error", message: "x" });

      const [, init] = fetchMock.mock.calls[0]!;
      expect(init.body).not.toContain("test-dd-key");
    });
  });
});
