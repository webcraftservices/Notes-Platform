import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Worker Graceful Shutdown & Prisma Lifecycle Resilience", () => {
  const originalEnv = process.env;
  let exitSpy: any;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.WORKER_HEALTH_PORT;
    delete process.env.FAIL_ON_INVALID_CONFIG;
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    process.env = originalEnv;
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("completes graceful shutdown cleanly when db.$disconnect resolves (code 0)", async () => {
    const disconnectSpy = vi.fn().mockResolvedValue(undefined);
    const stopWorkerSpy = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/cloud/key-vault", () => ({
      hydrateEnvFromAzureKeyVault: vi.fn().mockResolvedValue({ attempted: false }),
    }));

    vi.doMock("@/lib/db", () => ({
      db: {
        $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
        $disconnect: disconnectSpy,
      },
    }));

    vi.doMock("@/lib/queue/worker", () => ({
      checkQueueHealth: vi.fn(),
      getWorkerInstanceId: () => "test-worker",
      isWorkerDraining: () => false,
      isWorkerRedisReady: () => false,
      startMaintenanceSchedulers: vi.fn(),
      startProcessingWorker: vi.fn().mockResolvedValue(null),
      stopProcessingWorker: stopWorkerSpy,
    }));

    const logSpy = vi.fn();
    vi.doMock("@/lib/queue/logger", () => ({
      logRuntimeEvent: logSpy,
    }));

    const { runStandaloneWorker } = await import("@/workers/index");
    const { shutdown } = await runStandaloneWorker();

    await shutdown("SIGTERM", 0);

    expect(stopWorkerSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      "info",
      expect.objectContaining({ event: "shutdown_complete" })
    );
  });

  it("handles shutdown safely when db.$disconnect is undefined or not a function (code 0)", async () => {
    const stopWorkerSpy = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/lib/cloud/key-vault", () => ({
      hydrateEnvFromAzureKeyVault: vi.fn().mockResolvedValue({ attempted: false }),
    }));

    // Mock db without $disconnect (partial mock scenario)
    vi.doMock("@/lib/db", () => ({
      db: {
        $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
      },
    }));

    vi.doMock("@/lib/queue/worker", () => ({
      checkQueueHealth: vi.fn(),
      getWorkerInstanceId: () => "test-worker",
      isWorkerDraining: () => false,
      isWorkerRedisReady: () => false,
      startMaintenanceSchedulers: vi.fn(),
      startProcessingWorker: vi.fn().mockResolvedValue(null),
      stopProcessingWorker: stopWorkerSpy,
    }));

    const logSpy = vi.fn();
    vi.doMock("@/lib/queue/logger", () => ({
      logRuntimeEvent: logSpy,
    }));

    const { runStandaloneWorker } = await import("@/workers/index");
    const { shutdown } = await runStandaloneWorker();

    await shutdown("SIGTERM", 0);

    expect(stopWorkerSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      "info",
      expect.objectContaining({ event: "shutdown_complete" })
    );
  });

  it("propagates exit code 1 and logs error when db.$disconnect rejects", async () => {
    const disconnectError = new Error("DB connection terminated abruptly");
    const disconnectSpy = vi.fn().mockRejectedValue(disconnectError);

    vi.doMock("@/lib/cloud/key-vault", () => ({
      hydrateEnvFromAzureKeyVault: vi.fn().mockResolvedValue({ attempted: false }),
    }));

    vi.doMock("@/lib/db", () => ({
      db: {
        $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
        $disconnect: disconnectSpy,
      },
    }));

    vi.doMock("@/lib/queue/worker", () => ({
      checkQueueHealth: vi.fn(),
      getWorkerInstanceId: () => "test-worker",
      isWorkerDraining: () => false,
      isWorkerRedisReady: () => false,
      startMaintenanceSchedulers: vi.fn(),
      startProcessingWorker: vi.fn().mockResolvedValue(null),
      stopProcessingWorker: vi.fn().mockResolvedValue(undefined),
    }));

    const logSpy = vi.fn();
    vi.doMock("@/lib/queue/logger", () => ({
      logRuntimeEvent: logSpy,
    }));

    const { runStandaloneWorker } = await import("@/workers/index");
    const { shutdown } = await runStandaloneWorker();

    await shutdown("SIGTERM", 0);

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ event: "shutdown_db_disconnect_error" }),
      disconnectError
    );
  });

  it("propagates exit code 1 and logs error when stopProcessingWorker rejects", async () => {
    const stopError = new Error("BullMQ drain failed");
    const stopWorkerSpy = vi.fn().mockRejectedValue(stopError);

    vi.doMock("@/lib/cloud/key-vault", () => ({
      hydrateEnvFromAzureKeyVault: vi.fn().mockResolvedValue({ attempted: false }),
    }));

    vi.doMock("@/lib/db", () => ({
      db: {
        $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
        $disconnect: vi.fn().mockResolvedValue(undefined),
      },
    }));

    vi.doMock("@/lib/queue/worker", () => ({
      checkQueueHealth: vi.fn(),
      getWorkerInstanceId: () => "test-worker",
      isWorkerDraining: () => false,
      isWorkerRedisReady: () => false,
      startMaintenanceSchedulers: vi.fn(),
      startProcessingWorker: vi.fn().mockResolvedValue(null),
      stopProcessingWorker: stopWorkerSpy,
    }));

    const logSpy = vi.fn();
    vi.doMock("@/lib/queue/logger", () => ({
      logRuntimeEvent: logSpy,
    }));

    const { runStandaloneWorker } = await import("@/workers/index");
    const { shutdown } = await runStandaloneWorker();

    await shutdown("SIGTERM", 0);

    expect(stopWorkerSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ event: "shutdown_worker_stop_error" }),
      stopError
    );
  });
});
