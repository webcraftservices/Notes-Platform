import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkRedisHealth } from "@/lib/rate-limit";
import { getStorageService } from "@/lib/services/storage";
import { getAIService } from "@/lib/services/ai";
import { logServerError } from "@/lib/api-response";

/**
 * Phase 9.4 — this route must be evaluated on every request. Next 14
 * treats a `GET` route handler that touches no request object or dynamic
 * function as static, i.e. evaluated once at build time and served from
 * that snapshot; a readiness probe answering from a build-time snapshot is
 * worthless. Explicit rather than relying on incidental behavior.
 */
export const dynamic = "force-dynamic";

/**
 * Upper bound for each dependency check. A hung database or Redis must
 * make the probe answer "unreachable" promptly, not hang the probe itself
 * (which would look identical to a dead process to the orchestrator).
 */
const HEALTH_CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("health check timed out")), HEALTH_CHECK_TIMEOUT_MS);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Liveness + readiness endpoint (Phase 9.2, spec §E). Distinguishes the
 * one dependency this app cannot run without (the database — every
 * feature reads/writes it) from dependencies that have a safe fallback or
 * are simply optional:
 *
 *   - database: a real, cheap query (`SELECT 1`, unchanged from Phase 3).
 *     If this fails, the whole response is 503 — nothing in the app works
 *     without it.
 *   - redis: a real, cheap `PING` when configured (spec §E explicitly
 *     allows active checks that aren't expensive/unsafe) — but NOT
 *     configured is reported as "not_configured", not a failure, since
 *     rate-limit.ts's documented in-memory fallback means the app is
 *     still fully functional without it (just not distributed).
 *   - storage / ai: configuration-only. Actually exercising either would
 *     mean a real S3 call or a real (billable, quota-consuming) AI
 *     provider call, which spec §E explicitly prohibits here. Local
 *     storage mode and an unconfigured AI provider are both legitimate,
 *     working states for this app (see their registries' own doc
 *     comments) — never reported as unhealthy on that basis alone.
 *
 * `status` is one of:
 *   - "error"    (HTTP 503) — the database is unreachable, or configuration
 *                that is mandatory in production is missing: the instance
 *                cannot serve requests correctly and should leave rotation.
 *   - "degraded" (HTTP 200) — the app works but something optional is
 *                impaired (Redis configured but unreachable, so rate
 *                limiting is per-instance only; storage misconfigured).
 *                Stays 200 so an orchestrator doesn't recycle a healthy
 *                instance over a non-critical dependency, but monitors can
 *                alert on the body.
 *   - "ok"
 *
 * Process liveness (no dependencies at all) is /api/health/live — a
 * database blip must never make a liveness probe restart the process.
 *
 * Never exposes credentials, connection strings, env var values, or stack
 * traces — every dependency's status is one of a small set of safe,
 * fixed strings.
 */
export async function GET() {
  const [database, redis, storage, ai] = await Promise.all([
    checkDatabase(),
    checkRedisHealth(),
    Promise.resolve(checkStorageConfig()),
    Promise.resolve(checkAIConfig()),
  ]);

  const config = checkRequiredConfig();

  const status: "ok" | "degraded" | "error" =
    database.status !== "connected" || config === "misconfigured"
      ? "error"
      : (redis.configured && !redis.reachable) || storage === "misconfigured"
        ? "degraded"
        : "ok";

  return NextResponse.json(
    {
      status,
      database: database.status,
      redis: redis.configured ? (redis.reachable ? "connected" : "unreachable") : "not_configured",
      storage: storage,
      ai: ai,
      config,
    },
    { status: status === "error" ? 503 : 200 }
  );
}

/**
 * Configuration the app cannot run correctly without in production. Only
 * a fixed "ok"/"misconfigured" result is ever reported — never which
 * variable is missing (the endpoint is unauthenticated) and never a value.
 * Outside production NextAuth tolerates a missing secret, so this never
 * fails local development. (DATABASE_URL is covered by the database check.)
 */
function checkRequiredConfig(): "ok" | "misconfigured" {
  if (process.env.NODE_ENV !== "production") return "ok";
  return process.env.NEXTAUTH_SECRET ? "ok" : "misconfigured";
}

async function checkDatabase(): Promise<{ status: "connected" | "unreachable" }> {
  try {
    await withTimeout(db.$queryRaw`SELECT 1`);
    return { status: "connected" };
  } catch (err) {
    logServerError({ route: "health", op: "database" }, err);
    return { status: "unreachable" };
  }
}

/** Config-only — see module doc comment. Never opens a real connection. */
function checkStorageConfig(): "local" | "s3" | "misconfigured" {
  try {
    // getStorageService() only constructs a client (S3Client construction
    // does no network I/O) or resolves the local on-disk backend — see
    // services/storage.ts's own doc comment. Never a real storage call.
    getStorageService();
    const provider =
      process.env.STORAGE_PROVIDER ??
      (process.env.STORAGE_ENDPOINT || process.env.STORAGE_BUCKET ? "s3" : "local");
    return provider === "s3" ? "s3" : "local";
  } catch {
    return "misconfigured";
  }
}

/** Config-only — see module doc comment. Never makes a real AI request. */
function checkAIConfig(): "configured" | "not_configured" {
  try {
    // getAIService() validates env vars and constructs the provider client
    // (throws ServiceNotConfiguredError if unset) but never calls the
    // provider — see services/ai.ts / services/ai-gemini.ts.
    getAIService();
    return "configured";
  } catch {
    return "not_configured";
  }
}
