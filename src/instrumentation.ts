/**
 * Next.js startup hook (Phase 11.3.3D.1, Phase 15 & Stage A).
 *
 * Runs once upon Node.js server initialization.
 *
 * Stage A web/worker separation:
 *   - When `BULLMQ_DEDICATED_WORKER === "true"` or `BULLMQ_EMBEDDED_WORKER === "false"`,
 *     the Next.js web process acts strictly as a BullMQ producer (`queue.add()`) and does NOT
 *     start an embedded BullMQ consumer or duplicate background maintenance schedulers
 *     (which are owned exclusively by the dedicated `zenote-worker` service).
 *   - In single-process/dev mode (neither flag set), preserves legacy embedded recovery and
 *     worker startup so local single-process `npm run dev` continues to work seamlessly.
 *
 * Excluded during production static builds (NEXT_PHASE === 'phase-production-build')
 * and automated test runs (NODE_ENV === 'test').
 */
export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.NODE_ENV !== "test"
  ) {
    try {
      const { hydrateEnvFromAzureKeyVault } = await import("@/lib/cloud/key-vault");
      await hydrateEnvFromAzureKeyVault();
    } catch (err) {
      const { logRuntimeEvent } = await import("@/lib/queue/logger");
      logRuntimeEvent(
        "error",
        {
          service: "zenote-web",
          event: "key_vault_hydration_failed",
          source: "instrumentation",
          message: "[instrumentation] Azure Key Vault startup hydration failed",
        },
        err
      );
      if (process.env.FAIL_ON_INVALID_CONFIG === "true") {
        throw err;
      }
      return;
    }

    try {
      const { validateRuntimeConfiguration } = await import("@/lib/config/production-validation");
      const validation = validateRuntimeConfiguration({ role: "web" });
      if (!validation.ok) {
        const { logRuntimeEvent } = await import("@/lib/queue/logger");
        logRuntimeEvent("error", {
          service: "zenote-web",
          event: "runtime_config_validation_failed",
          source: "instrumentation",
          message: "[instrumentation] Runtime configuration validation errors",
          errorCount: validation.errors.length,
          errors: validation.errors,
        });
        if (process.env.FAIL_ON_INVALID_CONFIG === "true") {
          throw new Error("Zenote web configuration validation failed in strict mode.");
        }
      }
    } catch (err) {
      if (process.env.FAIL_ON_INVALID_CONFIG === "true") {
        throw err;
      }
    }

    const {
      isDedicatedWorkerMode,
      isEmbeddedMaintenanceEnabled,
      isEmbeddedWorkerEnabled,
    } = await import("@/lib/queue/connection");

    const dedicatedWorker = isDedicatedWorkerMode();
    const runEmbeddedWorker = isEmbeddedWorkerEnabled();
    const runEmbeddedMaintenance = isEmbeddedMaintenanceEnabled();

    if (!dedicatedWorker && runEmbeddedWorker) {
      try {
        const { recoverPersistedDocumentExtractionJobs } = await import("@/lib/document-extraction");
        void recoverPersistedDocumentExtractionJobs(10, { source: "independent" });
      } catch (err) {
        console.error("[instrumentation] error registering document extraction recovery", err);
      }
    }

    if (runEmbeddedWorker || runEmbeddedMaintenance) {
      try {
        const { startProcessingWorker, startMaintenanceSchedulers } = await import(
          "@/lib/queue/worker"
        );
        const worker = runEmbeddedWorker
          ? await startProcessingWorker({
              enableScheduledMaintenance: runEmbeddedMaintenance,
            })
          : null;
        if (!worker && runEmbeddedMaintenance) {
          startMaintenanceSchedulers({ runImmediateReconciliation: true });
        }
      } catch (err) {
        console.error("[instrumentation] error starting background worker/schedulers", err);
      }
    }
  }
}
