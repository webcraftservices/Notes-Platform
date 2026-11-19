import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kvMocks = vi.hoisted(() => ({
  hydrateEnvFromAzureKeyVault: vi.fn().mockResolvedValue({
    attempted: false,
    loadedKeys: [],
    skippedKeys: [],
  }),
}));
vi.mock("@/lib/cloud/key-vault", () => kvMocks);

const docExtraction = vi.hoisted(() => ({
  recoverPersistedDocumentExtractionJobs: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/document-extraction", () => docExtraction);

const queueWorkerMocks = vi.hoisted(() => ({
  startProcessingWorker: vi.fn().mockResolvedValue(null),
  startMaintenanceSchedulers: vi.fn(),
}));
vi.mock("@/lib/queue/worker", () => queueWorkerMocks);

describe("Instrumentation startup hook (Phase 11.3.3D.1 & Stage A)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    kvMocks.hydrateEnvFromAzureKeyVault.mockResolvedValue({
      attempted: false,
      loadedKeys: [],
      skippedKeys: [],
    });
    process.env = { ...originalEnv };
    delete process.env.BULLMQ_DEDICATED_WORKER;
    delete process.env.BULLMQ_EMBEDDED_WORKER;
    delete process.env.BULLMQ_EMBEDDED_MAINTENANCE;
    delete process.env.FAIL_ON_INVALID_CONFIG;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("invokes recoverPersistedDocumentExtractionJobs when running in nodejs runtime outside build and test", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-server";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { register } = await import("@/instrumentation");
    await register();

    expect(docExtraction.recoverPersistedDocumentExtractionJobs).toHaveBeenCalledTimes(1);
    expect(queueWorkerMocks.startProcessingWorker).toHaveBeenCalledTimes(1);
    expect(queueWorkerMocks.startMaintenanceSchedulers).toHaveBeenCalledTimes(1);
  });

  it("skips embedded worker, maintenance schedulers, and startup recovery when BULLMQ_DEDICATED_WORKER=true", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-server";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.BULLMQ_DEDICATED_WORKER = "true";

    const { register } = await import("@/instrumentation");
    await register();

    expect(docExtraction.recoverPersistedDocumentExtractionJobs).not.toHaveBeenCalled();
    expect(queueWorkerMocks.startProcessingWorker).not.toHaveBeenCalled();
    expect(queueWorkerMocks.startMaintenanceSchedulers).not.toHaveBeenCalled();
  });

  it("skips embedded worker and maintenance when BULLMQ_EMBEDDED_WORKER=false", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-server";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.BULLMQ_EMBEDDED_WORKER = "false";

    const { register } = await import("@/instrumentation");
    await register();

    expect(docExtraction.recoverPersistedDocumentExtractionJobs).not.toHaveBeenCalled();
    expect(queueWorkerMocks.startProcessingWorker).not.toHaveBeenCalled();
    expect(queueWorkerMocks.startMaintenanceSchedulers).not.toHaveBeenCalled();
  });

  it("does not invoke recovery during production build phase", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-build";

    const { register } = await import("@/instrumentation");
    await register();

    expect(docExtraction.recoverPersistedDocumentExtractionJobs).not.toHaveBeenCalled();
  });

  it("does not invoke recovery in non-nodejs (e.g. edge) runtimes", async () => {
    process.env.NEXT_RUNTIME = "edge";
    process.env.NEXT_PHASE = "phase-production-server";

    const { register } = await import("@/instrumentation");
    await register();

    expect(docExtraction.recoverPersistedDocumentExtractionJobs).not.toHaveBeenCalled();
  });

  it("aborts startup recovery and worker registration when Key Vault hydration fails (AUD-03, NEW-04)", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-server";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    kvMocks.hydrateEnvFromAzureKeyVault.mockRejectedValueOnce(new Error("Vault unreachable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { register } = await import("@/instrumentation");
    await register();

    expect(docExtraction.recoverPersistedDocumentExtractionJobs).not.toHaveBeenCalled();
    expect(queueWorkerMocks.startProcessingWorker).not.toHaveBeenCalled();
    expect(queueWorkerMocks.startMaintenanceSchedulers).not.toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).toContain("key_vault_hydration_failed");

    process.env.FAIL_ON_INVALID_CONFIG = "true";
    kvMocks.hydrateEnvFromAzureKeyVault.mockRejectedValueOnce(new Error("Vault strict error"));
    await expect(register()).rejects.toThrow("Vault strict error");
    errorSpy.mockRestore();
  });

  it("emits runtime_config_validation_failed alert token when strict config validation fails (NEW-04)", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-server";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.CLOUD_PRODUCTION_STRICT = "true";
    process.env.BULLMQ_DEDICATED_WORKER = "true";
    process.env.BULLMQ_EMBEDDED_WORKER = "false";
    delete process.env.DATABASE_URL;
    delete process.env.NEXTAUTH_SECRET;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { register } = await import("@/instrumentation");
    await register();

    expect(JSON.stringify(errorSpy.mock.calls)).toContain("runtime_config_validation_failed");

    process.env.FAIL_ON_INVALID_CONFIG = "true";
    await expect(register()).rejects.toThrow(/validation failed/i);
    errorSpy.mockRestore();
  });
});
