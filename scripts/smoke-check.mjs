/**
 * Stage D — Deployment Smoke Check (`npm run smoke:check -- --web-url https://...`).
 *
 * Verifies post-deployment readiness cleanly without needing user credentials:
 *   1. Web liveness (`GET /api/health/live` -> 200 `{ status: "alive" }`)
 *   2. Web dependency readiness (`GET /api/health` -> 200 `{ status: "ok" | "degraded", database: "connected" }`)
 *   3. NextAuth providers route (`GET /api/auth/providers` -> 200 JSON)
 *   4. Critical HTTP security headers (`x-content-type-options`, `x-frame-options`, `content-security-policy`)
 *   5. Optional worker health endpoints (`/live`, `/health`) if `--worker-url` is passed
 */

function parseArgs(argv) {
  const out = {
    webUrl: "",
    workerUrl: "",
    retries: 5,
    delayMs: 2000,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--web-url" && argv[i + 1]) {
      out.webUrl = argv[++i].replace(/\/$/, "");
    } else if (arg === "--worker-url" && argv[i + 1]) {
      out.workerUrl = argv[++i].replace(/\/$/, "");
    } else if (arg === "--retries" && argv[i + 1]) {
      out.retries = Math.max(1, Number(argv[++i]) || 5);
    } else if (arg === "--delay-ms" && argv[i + 1]) {
      out.delayMs = Math.max(200, Number(argv[++i]) || 2000);
    }
  }
  return out;
}

async function fetchWithRetries(url, retries, delayMs, validateFn) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const result = await validateFn(res);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr ?? new Error(`Smoke check failed for ${url}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.webUrl) {
    console.error("Usage: node scripts/smoke-check.mjs --web-url <https://app-url> [--worker-url <http://worker:3001>]");
    process.exit(1);
  }

  console.log(`[smoke-check] Checking web liveness: ${args.webUrl}/api/health/live`);
  await fetchWithRetries(`${args.webUrl}/api/health/live`, args.retries, args.delayMs, async (res) => {
    if (!res.ok) throw new Error(`Expected 200, got ${res.status}`);
    const body = await res.json();
    if (body.status !== "alive") throw new Error(`Unexpected live status: ${JSON.stringify(body)}`);
  });

  console.log(`[smoke-check] Checking web readiness & headers: ${args.webUrl}/api/health`);
  await fetchWithRetries(`${args.webUrl}/api/health`, args.retries, args.delayMs, async (res) => {
    if (res.status !== 200) {
      throw new Error(`Expected 200 readiness, got ${res.status}`);
    }
    for (const h of ["x-content-type-options", "x-frame-options", "content-security-policy"]) {
      if (!res.headers.get(h)) {
        throw new Error(`Missing required security header '${h}'`);
      }
    }
    const body = await res.json();
    if (body.database !== "connected") {
      throw new Error(`Database not connected: ${JSON.stringify(body)}`);
    }
    if (body.config !== "ok") {
      throw new Error(`Runtime config reported ${body.config}`);
    }
    console.log("[smoke-check] Web health snapshot:", JSON.stringify({ status: body.status, queue: body.queue?.mode, workerMode: body.queue?.workerMode, storage: body.storage, ai: body.ai }));
  });

  console.log(`[smoke-check] Checking NextAuth providers endpoint: ${args.webUrl}/api/auth/providers`);
  await fetchWithRetries(`${args.webUrl}/api/auth/providers`, 2, 1000, async (res) => {
    if (!res.ok) throw new Error(`Expected 200 from /api/auth/providers, got ${res.status}`);
    await res.json();
  });

  if (args.workerUrl) {
    console.log(`[smoke-check] Checking worker liveness & health: ${args.workerUrl}`);
    await fetchWithRetries(`${args.workerUrl}/live`, args.retries, args.delayMs, async (res) => {
      if (!res.ok) throw new Error(`Worker /live returned ${res.status}`);
    });
    await fetchWithRetries(`${args.workerUrl}/health`, args.retries, args.delayMs, async (res) => {
      if (!res.ok) throw new Error(`Worker /health returned ${res.status}`);
      const body = await res.json();
      if (body.database !== "connected" || body.config !== "ok") {
        throw new Error(`Worker /health unhealthy: ${JSON.stringify(body)}`);
      }
    });
  }

  console.log("[smoke-check] ALL CHECKS PASSED.");
}

main().catch((err) => {
  console.error("[smoke-check] FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
