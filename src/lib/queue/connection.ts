/**
 * Phase 15 & Stage A — BullMQ TCP Redis Connection Resolution, Role Separation & TLS Hardening.
 *
 * BullMQ requires a standard TCP/TLS Redis connection (`ioredis`) rather than
 * an HTTP REST client (`@upstash/redis`). This module resolves the TCP URL from:
 *   1. `BULLMQ_REDIS_URL` (`redis://` or `rediss://`)
 *   2. `REDIS_URL` (`redis://` or `rediss://`)
 *   3. Automatic derivation from `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
 *      (`rediss://default:<token>@<upstash-host>:6379`) unless disabled via
 *      `BULLMQ_DISABLE_UPSTASH_TCP=true`.
 *
 * Security & Process Separation:
 *   - TLS (`rediss://`) enforces certificate verification (`rejectUnauthorized: true`)
 *     by default. Only set `BULLMQ_REDIS_TLS_REJECT_UNAUTHORIZED="false"` explicitly for
 *     local self-signed TLS proxies.
 *   - Producer enablement (`isBullMqEnabled`) is decoupled from embedded worker execution
 *     (`isEmbeddedWorkerEnabled` / `isDedicatedWorkerMode`), allowing `zenote-web` to set
 *     `BULLMQ_DEDICATED_WORKER="true"` (enqueue-only) while `zenote-worker` consumes jobs.
 *   - Never logs or exposes credentials, tokens, or full connection strings.
 */

import IORedis, { type RedisOptions } from "ioredis";

export interface ResolvedRedisConfig {
  url: string;
  source: "BULLMQ_REDIS_URL" | "REDIS_URL" | "UPSTASH_DERIVED";
  host: string;
  port: number;
  tls: boolean;
}

export interface RedactedRedisConfig {
  source: ResolvedRedisConfig["source"];
  host: string;
  port: number;
  tls: boolean;
}

export function redactRedisConfig(config: ResolvedRedisConfig | null): RedactedRedisConfig | null {
  if (!config) return null;
  return {
    source: config.source,
    host: config.host,
    port: config.port,
    tls: config.tls,
  };
}

/**
 * Resolves the TCP Redis connection configuration for BullMQ without exposing secrets.
 */
export function resolveBullMqRedisConfig(
  env: NodeJS.ProcessEnv = process.env
): ResolvedRedisConfig | null {
  const explicitBullUrl = env.BULLMQ_REDIS_URL?.trim();
  if (explicitBullUrl) {
    const parsed = parseSafeRedisEndpoint(explicitBullUrl);
    if (parsed) {
      return { url: explicitBullUrl, source: "BULLMQ_REDIS_URL", ...parsed };
    }
  }

  const explicitRedisUrl = env.REDIS_URL?.trim();
  if (explicitRedisUrl) {
    const parsed = parseSafeRedisEndpoint(explicitRedisUrl);
    if (parsed) {
      return { url: explicitRedisUrl, source: "REDIS_URL", ...parsed };
    }
  }

  if (env.BULLMQ_DISABLE_UPSTASH_TCP === "true") {
    return null;
  }

  const upstashRestUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashRestToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (upstashRestUrl && upstashRestToken) {
    try {
      const parsedRest = new URL(upstashRestUrl);
      if (parsedRest.hostname) {
        const port = Number(env.UPSTASH_REDIS_TCP_PORT || 6379);
        const derivedUrl = `rediss://default:${encodeURIComponent(upstashRestToken)}@${parsedRest.hostname}:${port}`;
        return {
          url: derivedUrl,
          source: "UPSTASH_DERIVED",
          host: parsedRest.hostname,
          port,
          tls: true,
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

function parseSafeRedisEndpoint(
  rawUrl: string
): { host: string; port: number; tls: boolean } | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      return null;
    }
    const tls = parsed.protocol === "rediss:";
    const port = parsed.port ? Number(parsed.port) : 6379;
    if (!parsed.hostname || !Number.isFinite(port)) return null;
    return { host: parsed.hostname, port, tls };
  } catch {
    return null;
  }
}

/**
 * Determines whether BullMQ queue dispatch is active in the current runtime.
 * In unit test runs (`NODE_ENV === "test"` / `VITEST`), BullMQ TCP dispatch is
 * opt-in via `ENABLE_LIVE_BULLMQ_TESTS === "true"` so hermetic unit tests never
 * open external TCP connections.
 */
export function isBullMqEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BULLMQ_ENABLED === "false") return false;
  const isTestEnv = env.NODE_ENV === "test" || Boolean(env.VITEST);
  if (isTestEnv && env.ENABLE_LIVE_BULLMQ_TESTS !== "true") {
    return false;
  }
  return resolveBullMqRedisConfig(env) !== null;
}

/**
 * True when an independent `zenote-worker` container/process handles job execution
 * and background schedulers, so the web process only enqueues jobs (`queue.add()`).
 */
export function isDedicatedWorkerMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BULLMQ_DEDICATED_WORKER === "true";
}

/**
 * Determines whether the Next.js web runtime should start an embedded BullMQ consumer.
 * Always `false` when `BULLMQ_EMBEDDED_WORKER === "false"` or `BULLMQ_DEDICATED_WORKER === "true"`.
 */
export function isEmbeddedWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BULLMQ_EMBEDDED_WORKER === "false") return false;
  if (isDedicatedWorkerMode(env)) return false;
  if (env.BULLMQ_EMBEDDED_WORKER === "true") return true;
  return true;
}

/**
 * Determines whether the Next.js web runtime should run background maintenance timers
 * (reconciliation, watch-channel renewal, job pruning). Disabled whenever a dedicated
 * worker runs or `BULLMQ_EMBEDDED_MAINTENANCE === "false"`.
 */
export function isEmbeddedMaintenanceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BULLMQ_EMBEDDED_MAINTENANCE === "false") return false;
  if (env.BULLMQ_EMBEDDED_WORKER === "false") return false;
  if (isDedicatedWorkerMode(env)) return false;
  return true;
}

/**
 * Builds `ioredis` TLS options with strict certificate verification enabled by default.
 */
export function buildBullMqTlsOptions(
  resolved: ResolvedRedisConfig,
  env: NodeJS.ProcessEnv = process.env
): RedisOptions["tls"] | undefined {
  if (!resolved.tls) return undefined;
  const rejectUnauthorized = env.BULLMQ_REDIS_TLS_REJECT_UNAUTHORIZED !== "false";
  const servername = env.BULLMQ_REDIS_TLS_SERVERNAME?.trim();
  return {
    rejectUnauthorized,
    ...(servername ? { servername } : { servername: resolved.host }),
  };
}

export interface CreateRedisConnectionOptions {
  /** Override max reconnect attempts before returning `null` (default: infinite resilient retry). */
  maxReconnectAttempts?: number;
}

/**
 * Creates a BullMQ-compatible `IORedis` connection instance.
 * BullMQ requires `maxRetriesPerRequest: null`.
 * Long-lived producer/worker clients keep reconnecting with capped exponential backoff + jitter
 * unless `maxReconnectAttempts` is specified.
 */
export function createBullMqRedisConnection(
  overrides: Partial<RedisOptions> = {},
  env: NodeJS.ProcessEnv = process.env,
  options: CreateRedisConnectionOptions = {}
): IORedis {
  const resolved = resolveBullMqRedisConfig(env);
  if (!resolved) {
    throw new Error("BullMQ Redis TCP configuration is not available.");
  }

  const tlsOptions = buildBullMqTlsOptions(resolved, env);

  return new IORedis(resolved.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 8_000,
    ...(tlsOptions ? { tls: tlsOptions } : {}),
    retryStrategy(times) {
      if (
        typeof options.maxReconnectAttempts === "number" &&
        times > options.maxReconnectAttempts
      ) {
        return null;
      }
      const baseMs = Math.min(500 * Math.pow(2, Math.min(times - 1, 5)), 15_000);
      const jitterMs = Math.floor(Math.random() * 250);
      return baseMs + jitterMs;
    },
    ...overrides,
  });
}
