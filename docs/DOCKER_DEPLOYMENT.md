# Zenote — Docker & Azure Container Apps Deployment Guide (Stage A & Phase 2 Remediation)

> **Scope:** Container build architecture (`Dockerfile`, `.dockerignore`), isolated local orchestration (`docker-compose.yml`), compiled worker runtime (`dist/workers/index.cjs`), and Azure Container Apps deployment topology (`zenote-web` + `zenote-worker`).  
> **Host Verification Note:** All Node 22 runtime artifacts (`next build` standalone output + `esbuild` worker bundle `dist/workers/index.cjs`), health endpoints, Redis TLS/retry logic, and Web/Worker separation paths are verified locally. Actual `docker build` and `docker compose up` execution could not run on the local development machine because Docker Engine and WSL2 are not installed on the Windows host (`LIM-21`).

---

## 1. Container Architecture Overview

Zenote uses a single multi-stage [`Dockerfile`](../Dockerfile) pinned to **`node:22.22.2-bookworm-slim`** (matching `engines.node >= 22.22.2`, `jsdom`, glibc, and OpenSSL 3.0 required by Prisma and Sharp):

```
base (node:22.22.2-bookworm-slim + openssl + ca-certificates)
  ├── deps       (full npm ci + patch-package + prisma generate)
  ├── prod-deps  (npm ci --omit=dev --ignore-scripts + copied .prisma/@prisma/pptx2html)
  ├── migrator   (non-root 1001, ./node_modules/.bin/prisma migrate deploy)
  └── builder    (npm run build [standalone] + npm run build:worker [dist/workers/index.cjs])
        ├── web     (non-root nextjs:1001, PORT 3000, dedicated worker flags, node server.js)
        └── worker  (non-root worker:1001, WORKER_HEALTH_PORT 3001, node dist/workers/index.cjs)
```

### Key Stage A Design Guarantees
1. **Strict Build Context Exclusion (`.dockerignore`):** `.env`, `.env.*`, `node_modules`, `.next`, `dist`, `.storage`, `.git`, tests, and docs are excluded from Docker build contexts. The `builder` stage also runs `rm -rf .next/standalone/.env* .next/standalone/.storage` as defense-in-depth, and the `web` stage pre-creates `.next/cache/images` owned by `nextjs:nodejs` (`uid=1001`) so `sharp` / `/_next/image` optimization works under a non-root user.
2. **Self-Contained `pdfjs-dist` & `pptx2html` Assets:** `next.config.js` configures `output: "standalone"`, `serverComponentsExternalPackages: ["bullmq", "ioredis", "pdfjs-dist"]`, and `outputFileTracingIncludes` (`pdfjs-dist/package.json` and `pdfjs-dist/standard_fonts/**/*`) so standalone extraction never lacks font metrics or external package manifests. Meanwhile, `prod-deps` copies `.prisma`, `@prisma/client`, and patched `pptx2html` into the `worker` image.
3. **No `tsx` / `devDependencies` in Production Containers:** `npm run build:worker` (`scripts/build-worker.mjs`) compiles `src/workers/index.ts` via `esbuild` into CommonJS `dist/workers/index.cjs` (`node22`, external runtime `node_modules`), resolving all `@/*` path aliases at build time.
4. **Hard Web / Worker Separation:** `web` defaults to `BULLMQ_DEDICATED_WORKER=true`, `BULLMQ_EMBEDDED_WORKER=false`, `BULLMQ_EMBEDDED_MAINTENANCE=false`. Web routes enqueue jobs to Redis + PostgreSQL without running heavy extraction/transcription/maintenance loops inside request-serving pods.

---

## 2. Building Images Manually

Run from repository root in an environment with Docker Engine / BuildKit:

```bash
# 1. Database migration job image
docker build --target migrator -t zenote-migrator:latest .

# 2. Next.js web container (pass public NEXT_PUBLIC_* & STORAGE_ENDPOINT for CSP)
docker build --target web \
  --build-arg NEXT_PUBLIC_SITE_URL="https://app.zenote.example" \
  --build-arg STORAGE_ENDPOINT="https://<account>.r2.cloudflarestorage.com" \
  --t zenote-web:latest .

# 3. Dedicated BullMQ worker container
docker build --target worker -t zenote-worker:latest .
```

> **Important:** Because `next.config.js` embeds the storage origin in `Content-Security-Policy` `connect-src` at build time, pass `--build-arg STORAGE_ENDPOINT=...` whenever building `web` for a non-default Cloudflare R2 or AWS S3 endpoint.

---

## 3. Isolated Local Stack (`docker-compose.yml`)

`docker-compose.yml` launches an **isolated** 5-service local stack (`postgres`, `redis`, `migrate`, `web`, `worker`) that **never** touches Neon `/neondb`, live Upstash Redis, or live Cloudflare R2:

```bash
# Start full local stack (PostgreSQL pg17+pgvector on :5433, Redis 7 on :6380, web on :3000)
docker compose up --build

# Check container health & logs
docker compose ps
docker compose logs -f web worker

# Clean teardown (remove ephemeral local DB/Redis/storage volumes too with -v)
docker compose down -v
```

> **Storage Note for Cloud vs Compose:** `docker-compose.yml` uses a named Docker volume `zenote_local_storage` strictly because both local `web` and `worker` share single-host Docker storage during offline dev (`STORAGE_PROVIDER=local`). **In Azure Container Apps / cloud deployments, always use `STORAGE_PROVIDER=s3` (Cloudflare R2 / AWS S3)** — do not rely on local disk across separate `zenote-web` and `zenote-worker` replicas.

---

## 4. Health Probes & Graceful Shutdown

### 4.1 `zenote-web` (`PORT=3000`)
- **Liveness Probe:** `GET /api/health/live` -> `200 {"status":"alive"}` (no DB/Redis dependency so transient outages do not trigger crash loops).
- **Readiness Probe:** `GET /api/health` -> checks PostgreSQL (`SELECT 1`), Redis HTTP REST `PING`, BullMQ queue telemetry (`workerMode: "dedicated" | "embedded"`), storage config, AI config, and required prod secrets (`200` for `ok` / `degraded`, `503` for `error`).

### 4.2 `zenote-worker` (`WORKER_HEALTH_PORT=3001`)
- **Liveness Probe:** `GET /live` (or `/healthz`) -> `200 {"status":"alive","service":"zenote-worker",...}`; immediately returns **`503 {"status":"draining",...}`** once `SIGTERM`/`SIGINT` begins graceful shutdown so orchestrators stop considering the replica healthy while draining active BullMQ jobs.
- **Readiness Probe:** `GET /health` (or `/ready`) -> verifies PostgreSQL connectivity (`SELECT 1`), Redis BullMQ readiness (when enabled), queue telemetry, and non-draining state (`200` when ready, `503` otherwise).
- **Graceful Shutdown Sequence:** Clears scheduler timers -> awaits `worker.close()` + `queueEvents.close()` + BullMQ/reconciler Redis disconnects -> closes health HTTP server (`keepAliveTimeout = 2000` + `closeIdleConnections?.()`) -> disconnects Prisma (`db.$disconnect()`) -> exits `0`. Guarded by `WORKER_SHUTDOWN_TIMEOUT_MS` (default `25000` ms, fitting safely inside Container Apps' 30s `SIGTERM` window).

---

## 5. Multi-Replica & Azure Container Apps Operational Notes

1. **Scheduler Lease Locking & CAS Idempotency (`src/lib/queue/worker.ts`, `src/lib/queue/reconciliation.ts`):**
   - When scaling `zenote-worker` beyond 1 replica, `reconcileStrandedProcessingJobs`, `runScheduledWatchChannelRenewal`, and `pruneCompletedProcessingJobs` acquire Redis `SET key token NX PX <ttlMs>` leases (`${PROCESSING_QUEUE_NAME}:scheduler-lock:<taskName>`) with periodic `EXTEND_LEASE_LUA` (`PEXPIRE`) heartbeats during execution and compare-and-delete `RELEASE_LEASE_LUA` release.
   - `watch-renewal` and `retention-cleanup` use `failPolicy: "closed_when_bullmq"` so non-atomic external API calls (`channels.watch`) skip safely instead of racing across uncoordinated replicas if Redis is temporarily unavailable, while startup waits up to 3s for Redis readiness (`waitForRedisReady`) before running reconciliation.
   - `reconcileStrandedProcessingJobs` enforces an optimistic PostgreSQL CAS (`where: { id, status, attempts }`) on both retry recovery and retry-exhaustion updates, and measures recovered `QUEUED` grace from `updatedAt` (`attempts > 0`) so back-to-back runs cannot double-increment attempts or immediately burn retry budget.
2. **Real-Time SSE Across Replicas (`src/app/api/processing-jobs/stream/route.ts`):**
   - Same-process updates push immediately via `emitProcessingJobEvent`.
   - Separate `zenote-worker` updates sync to SSE clients via non-overlapping (`dbPollInFlight` guarded) PostgreSQL polling (`DB_POLL_SYNC_INTERVAL_MS = 2500` ms) with immediate pre-aborted signal cleanup inside `GET /api/processing-jobs/stream` and `GET /api/processing-jobs/[jobId]/stream`.
   - **Stage B Redis Pub/Sub Fan-Out (`SSE_REDIS_PUBSUB_ENABLED="true"`):** `src/lib/queue/events.ts` supports opt-in Redis Pub/Sub broadcasting (`zenote:job-events` channel) with `eventId` deduplication and PostgreSQL polling fallback so horizontally scaled `zenote-web` replicas receive cross-process worker job updates without extra DB load. `closeJobEventPubSub()` is invoked cleanly during `stopProcessingWorker()` shutdown.
3. **Production Secret & Redis Resilience Guarantees:**
   - `getWebhookSigningSecret()` in `src/lib/google-drive-sync.ts` fails closed in `NODE_ENV=production` if `GOOGLE_WEBHOOK_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, and `NEXTAUTH_SECRET` are all unset.
   - `createBullMqRedisConnection()` validates TLS certificates strictly (`rejectUnauthorized: true`) by default for `rediss://` and uses infinite capped exponential backoff + jitter (unless `maxReconnectAttempts` is supplied) instead of terminating reconnects after 5 failures.
   - `dispatcher.ts` retries queue initialization after a `15_000` ms cooldown (`QUEUE_INIT_RETRY_COOLDOWN_MS`) rather than latching `sharedQueueInitFailed` permanently across temporary DNS/network outages.
4. **CI Verification & Azure CD Workflows:**
   - [`.github/workflows/stage-a-verification.yml`](../.github/workflows/stage-a-verification.yml): Automates static validation, Docker multi-stage image builds (`migrator`, `web`, `worker`), non-root `uid=1001` & secret/dev-asset checks, isolated `docker compose` stack boot + migration count (`>= 13`) & `LIM-09` `pg_index.indisvalid` verification, execution of all live PostgreSQL/Redis integration suites on the host runner against Compose published ports (`127.0.0.1:5433` for `postgres` and `127.0.0.1:6380` for `redis`: `group-deletion-postgres-integration.test.ts` [`LIM-01`], `search-postgres-integration.test.ts`, `study-postgres-integration.test.ts`, `phase15-live-integration.test.ts`, and `lim09-concurrent-indexes.test.ts`), unhandled async IIFE rejection exit guards, Redis/worker/web restart reconnect resilience, Linux `SIGTERM` graceful web & worker shutdown, and `if: failure()` Compose log diagnostics on GitHub Actions `ubuntu-latest` runners.
   - [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): Least-privilege PR/main CI pipeline running offline readiness checks (`npm run verify:readiness`), `prepare-concurrent-indexes.mjs --verify` (`LIM-09`), `typecheck`, `lint`, hermetic `vitest`, `next build`, and `build:worker`.
   - [`.github/workflows/cd-azure-container-apps.yml`](../.github/workflows/cd-azure-container-apps.yml): OIDC-federated (`id-token: write`) build/push to ACR, Stage-1 infra/migrator sync (`deployWorkloadApps=false`), `zenote-migrator` ACA Job execution gated strictly on `Succeeded`, Stage-2 `zenote-worker` / `zenote-web` rollout (`deployWorkloadApps=true`), and `npm run smoke:check`.
5. **Cloud Infrastructure & Stage B–D Integration:**
   - Declarative Azure Container Apps, RBAC Key Vault, Log Analytics, Application Insights, Managed Identity, and Alert Rules templates reside under [`infra/azure/main.bicep`](../infra/azure/main.bicep) and [`infra/monitoring/azure-monitor-alerts.bicep`](../infra/monitoring/azure-monitor-alerts.bicep), documented end-to-end in [`docs/DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md).
