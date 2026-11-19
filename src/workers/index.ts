/**
 * Phase 15, Stage A & Audit Remediation (`AUD-03`) — Standalone Background Worker
 * Entrypoint (`node dist/workers/index.cjs`).
 *
 * Startup ordering invariant:
 *   - `hydrateEnvFromAzureKeyVault()` MUST complete (and fail closed on error)
 *     BEFORE `@/lib/db` (`PrismaClient`), Redis connection config, or BullMQ
 *     worker modules are dynamically imported so hydrated secrets (`DATABASE_URL`,
 *     Redis, AI, OAuth, Storage) take effect cleanly at initialization time.
 */

import http from "node:http";
import os from "node:os";
import { hydrateEnvFromAzureKeyVault } from "@/lib/cloud/key-vault";
import { logRuntimeEvent } from "@/lib/queue/logger";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;
const HEALTH_DB_TIMEOUT_MS = 3_000;

function resolveFallbackWorkerId(): string {
  return process.env.WORKER_ID?.trim() || `${os.hostname()}-${process.pid}`;
}

async function checkWorkerDatabaseReachable(
  dbClient: { $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> }
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      dbClient.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DB health check timed out")), HEALTH_DB_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function startWorkerHealthServer(port: number): Promise<http.Server> {
  const [{ db }, { validateRuntimeConfiguration }, { isBullMqEnabled }, workerMod] =
    await Promise.all([
      import("@/lib/db"),
      import("@/lib/config/production-validation"),
      import("@/lib/queue/connection"),
      import("@/lib/queue/worker"),
    ]);

  const UNHEALTHY_LOG_COOLDOWN_MS = 60_000;
  let lastUnhealthyLogAt = 0;
  let lastUnhealthySignature = "";

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      res.setHeader("Content-Type", "application/json; charset=utf-8");

      if (path === "/live" || path === "/healthz") {
        const draining = workerMod.isWorkerDraining();
        res.statusCode = draining ? 503 : 200;
        res.end(
          JSON.stringify({
            status: draining ? "draining" : "alive",
            service: "zenote-worker",
            workerId: workerMod.getWorkerInstanceId(),
          })
        );
        return;
      }

      if (path === "/health" || path === "/ready" || path === "/") {
        const draining = workerMod.isWorkerDraining();
        const [dbOk, queue] = await Promise.all([
          checkWorkerDatabaseReachable(db),
          workerMod.checkQueueHealth().catch(() => null),
        ]);
        const bullMqExpected = isBullMqEnabled();
        const redisOk =
          !bullMqExpected || (workerMod.isWorkerRedisReady() && queue?.mode === "bullmq");
        const configValidation = validateRuntimeConfiguration({ role: "worker" });
        const healthy = !draining && dbOk && redisOk && configValidation.ok;
        const databaseStatus = dbOk ? "connected" : "unreachable";
        const redisStatus = bullMqExpected
          ? redisOk
            ? "connected"
            : "unreachable"
          : "not_configured";
        const configStatus = configValidation.ok ? "ok" : "misconfigured";

        if (!healthy) {
          const signature = `${draining}:${databaseStatus}:${redisStatus}:${configStatus}`;
          const now = Date.now();
          if (
            signature !== lastUnhealthySignature ||
            now - lastUnhealthyLogAt >= UNHEALTHY_LOG_COOLDOWN_MS
          ) {
            lastUnhealthyLogAt = now;
            lastUnhealthySignature = signature;
            logRuntimeEvent("error", {
              service: "zenote-worker",
              event: "worker_health_unhealthy",
              workerId: workerMod.getWorkerInstanceId(),
              draining,
              database: databaseStatus,
              redis: redisStatus,
              config: configStatus,
            });
          }
        } else {
          lastUnhealthyLogAt = 0;
          lastUnhealthySignature = "";
        }

        res.statusCode = healthy ? 200 : 503;
        res.end(
          JSON.stringify({
            status: draining ? "draining" : healthy ? "ok" : "error",
            service: "zenote-worker",
            workerId: workerMod.getWorkerInstanceId(),
            database: databaseStatus,
            config: configStatus,
            queue: queue
              ? {
                  mode: queue.mode,
                  workerActive: queue.workerActive,
                  lastHeartbeatAt: queue.lastHeartbeatAt,
                  ...(queue.counts ? { counts: queue.counts } : {}),
                }
              : { mode: "unknown", workerActive: false },
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found" }));
    });

    server.keepAliveTimeout = 2_000;
    server.on("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

async function main(): Promise<void> {
  let kvHydration;
  try {
    kvHydration = await hydrateEnvFromAzureKeyVault();
  } catch (err) {
    logRuntimeEvent(
      "error",
      {
        service: "zenote-worker",
        event: "key_vault_hydration_failed",
        workerId: resolveFallbackWorkerId(),
      },
      err
    );
    throw err;
  }

  // Import runtime/DB/BullMQ modules ONLY after Azure Key Vault hydration completes.
  const [
    { db },
    { validateRuntimeConfiguration },
    { redactRedisConfig, resolveBullMqRedisConfig },
    workerMod,
  ] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/config/production-validation"),
    import("@/lib/queue/connection"),
    import("@/lib/queue/worker"),
  ]);

  const workerId = workerMod.getWorkerInstanceId();

  if (kvHydration.attempted) {
    logRuntimeEvent("info", {
      service: "zenote-worker",
      event: "key_vault_hydration_complete",
      workerId,
      loadedCount: kvHydration.loadedKeys.length,
      skippedCount: kvHydration.skippedKeys.length,
    });
  }

  const configValidation = validateRuntimeConfiguration({ role: "worker" });
  if (!configValidation.ok) {
    logRuntimeEvent("error", {
      service: "zenote-worker",
      event: "runtime_config_validation_failed",
      workerId,
      errorCount: configValidation.errors.length,
      errors: configValidation.errors,
    });
    if (process.env.FAIL_ON_INVALID_CONFIG === "true") {
      process.exit(1);
    }
  } else if (configValidation.warnings.length > 0) {
    logRuntimeEvent("warn", {
      service: "zenote-worker",
      event: "runtime_config_validation_warnings",
      workerId,
      warnings: configValidation.warnings,
    });
  }

  const redactedRedis = redactRedisConfig(resolveBullMqRedisConfig());

  logRuntimeEvent("info", {
    service: "zenote-worker",
    event: "worker_starting",
    workerId,
    nodeVersion: process.version,
    redis: redactedRedis,
  });

  const healthPortRaw = process.env.WORKER_HEALTH_PORT?.trim();
  const healthPort = healthPortRaw ? Number(healthPortRaw) : NaN;
  let healthServer: http.Server | null = null;
  if (Number.isInteger(healthPort) && healthPort > 0 && healthPort <= 65535) {
    healthServer = await startWorkerHealthServer(healthPort);
    logRuntimeEvent("info", {
      service: "zenote-worker",
      event: "health_server_listening",
      workerId,
      port: healthPort,
    });
  }

  const worker = await workerMod.startProcessingWorker({
    enableScheduledMaintenance: true,
  });

  if (worker) {
    logRuntimeEvent("info", {
      service: "zenote-worker",
      event: "worker_ready",
      workerId,
      mode: "bullmq",
    });
  } else {
    logRuntimeEvent("warn", {
      service: "zenote-worker",
      event: "worker_ready_no_redis",
      workerId,
      mode: "in_process_maintenance_only",
    });
    workerMod.startMaintenanceSchedulers();
  }

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;

    const timeoutMs = Math.max(
      1_000,
      Number(process.env.WORKER_SHUTDOWN_TIMEOUT_MS || DEFAULT_SHUTDOWN_TIMEOUT_MS)
    );
    const watchdog = setTimeout(() => {
      logRuntimeEvent("error", {
        service: "zenote-worker",
        event: "shutdown_timeout_forced_exit",
        workerId,
        signal,
        timeoutMs,
      });
      process.exit(1);
    }, timeoutMs);
    watchdog.unref?.();

    logRuntimeEvent("info", {
      service: "zenote-worker",
      event: "shutdown_started",
      workerId,
      signal,
    });

    await workerMod.stopProcessingWorker();

    if (healthServer) {
      await new Promise<void>((resolve) => {
        const hs = healthServer!;
        hs.close(() => resolve());
        hs.closeIdleConnections?.();
      }).catch(() => undefined);
    }

    await db.$disconnect().catch(() => undefined);
    clearTimeout(watchdog);

    logRuntimeEvent("info", {
      service: "zenote-worker",
      event: "shutdown_complete",
      workerId,
      signal,
    });
    process.exit(exitCode);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.on("SIGINT", () => void shutdown("SIGINT", 0));
  process.on("unhandledRejection", (reason) => {
    logRuntimeEvent(
      "error",
      {
        service: "zenote-worker",
        event: "unhandled_rejection",
        workerId,
      },
      reason
    );
  });
  process.on("uncaughtException", (err) => {
    logRuntimeEvent(
      "error",
      {
        service: "zenote-worker",
        event: "uncaught_exception",
        workerId,
      },
      err
    );
    void shutdown("uncaughtException", 1);
  });
}

if (require.main === module) {
  void main().catch((err) => {
    logRuntimeEvent(
      "error",
      {
        service: "zenote-worker",
        event: "fatal_startup_error",
        workerId: resolveFallbackWorkerId(),
      },
      err
    );
    process.exit(1);
  });
}

export { main as runStandaloneWorker };
