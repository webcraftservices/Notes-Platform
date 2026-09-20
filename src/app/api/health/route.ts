import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkRedisHealth } from "@/lib/rate-limit";
import { getStorageService } from "@/lib/services/storage";
import { getAIService } from "@/lib/services/ai";
import { logServerError } from "@/lib/api-response";

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

  const status = database.status === "connected" ? "ok" : "error";

  return NextResponse.json(
    {
      status,
      database: database.status,
      redis: redis.configured ? (redis.reachable ? "connected" : "unreachable") : "not_configured",
      storage: storage,
      ai: ai,
    },
    { status: status === "ok" ? 200 : 503 }
  );
}

async function checkDatabase(): Promise<{ status: "connected" | "unreachable" }> {
  try {
    await db.$queryRaw`SELECT 1`;
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
