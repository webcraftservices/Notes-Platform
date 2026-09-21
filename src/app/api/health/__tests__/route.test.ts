import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ db }));

const rateLimitModule = vi.hoisted(() => ({ checkRedisHealth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => rateLimitModule);

const storageModule = vi.hoisted(() => ({ getStorageService: vi.fn() }));
vi.mock("@/lib/services/storage", () => storageModule);

const aiModule = vi.hoisted(() => ({ getAIService: vi.fn() }));
vi.mock("@/lib/services/ai", () => aiModule);

const observability = vi.hoisted(() => ({
  sendDatadogMetric: vi.fn().mockResolvedValue(undefined),
  sendDatadogLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/observability/datadog", () => observability);

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    observability.sendDatadogMetric.mockResolvedValue(undefined);
    observability.sendDatadogLog.mockResolvedValue(undefined);
    db.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    rateLimitModule.checkRedisHealth.mockResolvedValue({ configured: false });
    storageModule.getStorageService.mockReturnValue({});
    aiModule.getAIService.mockReturnValue({ providerName: "gemini", modelName: "m", chat: vi.fn() });
    delete process.env.STORAGE_PROVIDER;
    delete process.env.STORAGE_ENDPOINT;
    delete process.env.STORAGE_BUCKET;
  });

  it("returns 200 and status ok when the database is reachable", async () => {
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("ok");
    expect(json.database).toBe("connected");
  });

  it("returns 503 and status error when the database is unreachable — never leaking the raw error", async () => {
    db.$queryRaw.mockRejectedValue(new Error("connection refused to postgres://user:pass@internal-host:5432/db"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.status).toBe("error");
    expect(json.database).toBe("unreachable");
    expect(JSON.stringify(json)).not.toMatch(/postgres:\/\//);
    expect(JSON.stringify(json)).not.toMatch(/user:pass/);

    consoleSpy.mockRestore();
  });

  it("reports redis as not_configured (not a failure) when Redis env vars are unset", async () => {
    rateLimitModule.checkRedisHealth.mockResolvedValue({ configured: false });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200); // Redis being unconfigured must never drag down overall status.
    expect(json.redis).toBe("not_configured");
  });

  it("reports redis as connected when configured and reachable", async () => {
    rateLimitModule.checkRedisHealth.mockResolvedValue({ configured: true, reachable: true });

    const res = await GET();
    const json = await res.json();

    expect(json.redis).toBe("connected");
  });

  it("reports redis as unreachable when configured but the ping fails, without failing overall status", async () => {
    rateLimitModule.checkRedisHealth.mockResolvedValue({
      configured: true,
      reachable: false,
      error: "ECONNREFUSED",
    });

    const res = await GET();
    const json = await res.json();

    // Redis has a documented, working in-memory fallback (spec §E/§9.1) —
    // its own unreachability is informational, not a readiness failure.
    expect(res.status).toBe(200);
    expect(json.redis).toBe("unreachable");
  });

  it("reports storage as local by default with no STORAGE_PROVIDER set", async () => {
    const res = await GET();
    const json = await res.json();

    expect(json.storage).toBe("local");
  });

  it("reports storage as s3 when STORAGE_PROVIDER=s3 and construction succeeds", async () => {
    process.env.STORAGE_PROVIDER = "s3";

    const res = await GET();
    const json = await res.json();

    expect(json.storage).toBe("s3");
  });

  it("reports storage as misconfigured when the storage registry throws, without leaking the error", async () => {
    process.env.STORAGE_PROVIDER = "s3";
    storageModule.getStorageService.mockImplementation(() => {
      throw new Error("STORAGE_PROVIDER=s3 but STORAGE_BUCKET / STORAGE_ACCESS_KEY_ID are not set");
    });

    const res = await GET();
    const json = await res.json();

    expect(json.storage).toBe("misconfigured");
    expect(JSON.stringify(json)).not.toMatch(/STORAGE_ACCESS_KEY_ID/);
  });

  it("reports ai as configured when getAIService() resolves", async () => {
    const res = await GET();
    const json = await res.json();

    expect(json.ai).toBe("configured");
  });

  it("reports ai as not_configured when getAIService() throws, without leaking the error message", async () => {
    aiModule.getAIService.mockImplementation(() => {
      throw new Error("AIService is not configured. Set GOOGLE_AI_API_KEY.");
    });

    const res = await GET();
    const json = await res.json();

    expect(json.ai).toBe("not_configured");
  });

  it("never makes a real AI call or storage call to determine health", async () => {
    await GET();

    // getAIService()/getStorageService() are called (config resolution),
    // but nothing that would be a real request (e.g. .chat()) is invoked.
    expect(aiModule.getAIService).toHaveBeenCalled();
    const service = aiModule.getAIService.mock.results[0]?.value;
    expect(service?.chat).not.toHaveBeenCalled();
  });

  it("never exposes environment variable values, connection strings, or credentials in the response", async () => {
    process.env.STORAGE_PROVIDER = "s3";
    db.$queryRaw.mockRejectedValue(new Error("password authentication failed for user \"admin\""));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();
    const json = await res.json();
    const text = JSON.stringify(json);

    expect(text).not.toMatch(/password/i);
    expect(text).not.toMatch(/admin/);
  });
});

describe("GET /api/health — Phase 9.4 readiness semantics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    observability.sendDatadogMetric.mockResolvedValue(undefined);
    observability.sendDatadogLog.mockResolvedValue(undefined);
    db.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    rateLimitModule.checkRedisHealth.mockResolvedValue({ configured: false });
    storageModule.getStorageService.mockReturnValue({});
    aiModule.getAIService.mockReturnValue({ providerName: "gemini", modelName: "m", chat: vi.fn() });
    delete process.env.STORAGE_PROVIDER;
  });

  it("answers 503 promptly when the database HANGS, instead of hanging the probe itself", async () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      db.$queryRaw.mockReturnValue(new Promise(() => {})); // connection accepted, query never answers

      const pending = GET();
      await vi.advanceTimersByTimeAsync(3500);
      const res = await pending;

      expect(res.status).toBe(503);
      expect((await res.json()).database).toBe("unreachable");
    } finally {
      consoleSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("reports status 'degraded' (still HTTP 200) when Redis is configured but unreachable, so monitors can alert without pulling the instance", async () => {
    rateLimitModule.checkRedisHealth.mockResolvedValue({ configured: true, reachable: false });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("degraded");
    expect(json.redis).toBe("unreachable");
  });

  it("reports 'degraded' when storage is misconfigured", async () => {
    storageModule.getStorageService.mockImplementation(() => {
      throw new Error("bucket credentials missing");
    });
    process.env.STORAGE_PROVIDER = "s3";

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("degraded");
  });

  it("reports 503 in production when mandatory configuration is missing — without naming the variable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    try {
      const res = await GET();
      const json = await res.json();

      expect(res.status).toBe(503);
      expect(json.status).toBe("error");
      expect(json.config).toBe("misconfigured");
      expect(JSON.stringify(json)).not.toMatch(/NEXTAUTH/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is ok in production once mandatory configuration is present", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_SECRET", "placeholder-not-a-real-secret");
    try {
      const res = await GET();
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe("ok");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is explicitly dynamic, so Next never serves a build-time snapshot as the readiness result", async () => {
    const mod = await import("@/app/api/health/route");
    expect(mod.dynamic).toBe("force-dynamic");
  });
});

describe("GET /api/health/live", () => {
  it("answers 200 without touching the database, Redis, storage or AI — a dependency outage can never fail liveness", async () => {
    vi.resetAllMocks();
    const { GET: live, dynamic } = await import("@/app/api/health/live/route");

    const res = await live();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "alive" });
    expect(dynamic).toBe("force-dynamic");
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(rateLimitModule.checkRedisHealth).not.toHaveBeenCalled();
    expect(storageModule.getStorageService).not.toHaveBeenCalled();
    expect(aiModule.getAIService).not.toHaveBeenCalled();
  });
});
