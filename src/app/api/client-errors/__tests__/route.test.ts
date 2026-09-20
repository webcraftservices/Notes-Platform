import { beforeEach, describe, expect, it, vi } from "vitest";

const rateLimitModule = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => rateLimitModule);

const observability = vi.hoisted(() => ({
  sendDatadogMetric: vi.fn().mockResolvedValue(undefined),
  sendDatadogLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/observability/datadog", () => observability);

import { POST } from "@/app/api/client-errors/route";

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/client-errors", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    observability.sendDatadogMetric.mockResolvedValue(undefined);
    observability.sendDatadogLog.mockResolvedValue(undefined);
    rateLimitModule.rateLimit.mockResolvedValue({ success: true, remaining: 19 });
  });

  it("accepts a valid report and returns ok with a requestId", async () => {
    const res = await POST(makeRequest({ message: "Cannot read properties of undefined", digest: "abc123" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(typeof json.requestId).toBe("string");
  });

  it("logs the report (which forwards to Datadog via logServerError)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await POST(makeRequest({ message: "boom", digest: "xyz" }));

    expect(consoleSpy).toHaveBeenCalledWith(
      "[api:client-errors]",
      expect.objectContaining({ error: "boom", boundary: "global", digest: "xyz" })
    );
    expect(observability.sendDatadogLog).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("rejects a request with no message", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects an oversized message rather than accepting arbitrary-length input", async () => {
    const res = await POST(makeRequest({ message: "x".repeat(5000) }));
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON without throwing", async () => {
    const req = new Request("https://example.test/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("is rate limited by IP, mirroring /api/auth/register's convention", async () => {
    rateLimitModule.rateLimit.mockResolvedValue({ success: false, remaining: 0 });

    const res = await POST(makeRequest({ message: "boom" }, { "x-forwarded-for": "1.2.3.4" }));

    expect(res.status).toBe(429);
    expect(rateLimitModule.rateLimit).toHaveBeenCalledWith("client-errors:1.2.3.4", expect.any(Object));
  });

  it("requires no authentication (a crash can happen before any session exists)", async () => {
    // No session/auth mock exists in this test file at all — the route
    // must not import or call getSessionUser(); this simply proves it
    // works with nothing but the raw request.
    const res = await POST(makeRequest({ message: "crashed on sign-in page" }));
    expect(res.status).toBe(200);
  });
});
