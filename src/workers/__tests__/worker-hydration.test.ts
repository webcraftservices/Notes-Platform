import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("AUD-03 — Standalone Worker Key Vault Hydration Ordering & Fail-Closed Boot", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.WORKER_HEALTH_PORT;
    delete process.env.FAIL_ON_INVALID_CONFIG;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("hydrates Azure Key Vault BEFORE importing db or starting BullMQ worker (AUD-03)", async () => {
    const events: string[] = [];
    let dbImportedAfterHydration = false;

    vi.doMock("@/lib/cloud/key-vault", () => ({
      hydrateEnvFromAzureKeyVault: vi.fn(async () => {
        events.push("kv_hydrate_start");
        process.env.DATABASE_URL = "postgresql://hydrated:pw@db.example/zenote?sslmode=require";
        process.env.WORKER_ID = "hydrated-worker-99";
        events.push("kv_hydrate_done");
        return {
          attempted: true,
          loadedKeys: ["DATABASE_URL", "WORKER_ID"],
          skippedKeys: [],
        };
      }),
    }));

    vi.doMock("@/lib/db", () => {
      dbImportedAfterHydration = events.includes("kv_hydrate_done");
      events.push(`db_imported:${process.env.DATABASE_URL ?? ""}`);
      return {
        db: {
          $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
          $disconnect: vi.fn().mockResolvedValue(undefined),
        },
      };
    });

    vi.doMock("@/lib/queue/worker", () => {
      events.push(`worker_imported:${process.env.WORKER_ID ?? ""}`);
      return {
        checkQueueHealth: vi.fn(),
        getWorkerInstanceId: () => process.env.WORKER_ID ?? "fallback",
        isWorkerDraining: () => false,
        isWorkerRedisReady: () => true,
        startMaintenanceSchedulers: vi.fn(),
        startProcessingWorker: vi.fn(async () => {
          events.push("worker_started");
          return null;
        }),
        stopProcessingWorker: vi.fn().mockResolvedValue(undefined),
      };
    });

    vi.doMock("@/lib/queue/logger", () => ({
      logRuntimeEvent: vi.fn(),
    }));

    const { runStandaloneWorker } = await import("@/workers/index");

    // Prior to runStandaloneWorker(), neither @/lib/db nor @/lib/queue/worker has executed
    expect(events).toEqual([]);

    await runStandaloneWorker();

    expect(dbImportedAfterHydration).toBe(true);
    expect(events[0]).toBe("kv_hydrate_start");
    expect(events[1]).toBe("kv_hydrate_done");
    expect(events).toContain("db_imported:postgresql://hydrated:pw@db.example/zenote?sslmode=require");
    expect(events).toContain("worker_imported:hydrated-worker-99");
    expect(events).toContain("worker_started");
  });

  it("fails closed without initializing Prisma db or worker when Key Vault hydration rejects (AUD-03)", async () => {
    const dbInitSpy = vi.fn();
    const workerStartSpy = vi.fn();

    vi.doMock("@/lib/cloud/key-vault", () => ({
      hydrateEnvFromAzureKeyVault: vi.fn().mockRejectedValue(new Error("KV access denied")),
    }));
    vi.doMock("@/lib/db", () => {
      dbInitSpy();
      return {
        db: {
          $queryRaw: vi.fn(),
          $disconnect: vi.fn(),
        },
      };
    });
    vi.doMock("@/lib/queue/worker", () => ({
      checkQueueHealth: vi.fn(),
      getWorkerInstanceId: () => "fallback",
      isWorkerDraining: () => false,
      isWorkerRedisReady: () => false,
      startMaintenanceSchedulers: vi.fn(),
      startProcessingWorker: workerStartSpy,
      stopProcessingWorker: vi.fn(),
    }));
    vi.doMock("@/lib/queue/logger", () => ({
      logRuntimeEvent: vi.fn(),
    }));

    const { runStandaloneWorker } = await import("@/workers/index");
    await expect(runStandaloneWorker()).rejects.toThrow("KV access denied");
    expect(dbInitSpy).not.toHaveBeenCalled();
    expect(workerStartSpy).not.toHaveBeenCalled();
  });
});
