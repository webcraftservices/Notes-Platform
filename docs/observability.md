# Observability (Datadog) — Phase 9.2

Datadog is the observability platform for this app (chosen for the GitHub
Student Developer Pack's Datadog Pro offer — see the Phase 9.2 task
prompt). This doc covers what's implemented, what was deliberately left
out this phase and why, how to activate it, and what to set up on the
Datadog side once you do.

## What's implemented

- **Structured logs** — `logServerError()` (`src/lib/api-response.ts`)
  logs locally via `console.error` (unchanged from Phase 9.1) AND forwards
  the same safe context to Datadog Logs. Wired into: the AI messages
  route's unexpected/provider-unavailable failures, the health endpoint's
  database-failure path, and the new client-error reporting endpoint
  below.
- **AI observability** — the AI messages route
  (`src/app/api/ai/conversations/[conversationId]/messages/route.ts`)
  emits two metrics around the one AI-provider call it makes:
  `ai.chat.requests` (count, tagged `provider`, `model`, `kind`
  chat/tutor, `outcome` success/failure, and `failure_category`
  unavailable/unexpected on failure) and `ai.chat.latency_ms` (gauge, on
  success). Never the prompt, the reply, or retrieved chunks.
  Phase 9.4 adds two more count metrics, same no-content rule:
  `ai.generation.requests` (flashcard/quiz routes — tagged `kind`,
  `outcome:failure`, `failure_category`; failures only) and
  `processing_job.failures` (tagged `job_type`; emitted whenever a background
  job is recorded as FAILED).
- **Request/correlation ID** — `getOrCreateRequestId()`
  (`src/lib/observability/request-id.ts`). Reuses an incoming
  `x-request-id` or `x-vercel-id` header if present, otherwise generates
  an opaque UUID. Threaded through the AI messages route's 503/500
  responses (both the log and the JSON body, as `requestId`) and the
  client-error endpoint, so a user-visible failure can be correlated with
  a specific server log / Datadog event. Not retrofitted into every other
  route this phase — see "Deliberately not done" below.
- **Global client-error reporting** — `app/error.tsx` (the root error
  boundary) previously only ran `console.error` in the browser, which
  nothing durable ever saw. It now also POSTs a small, capped report
  (message/digest/stack, all length-limited) to the new
  `POST /api/client-errors`, which rate-limits by IP (same convention as
  `/api/auth/register`), validates the body, and logs it through the same
  `logServerError()` path — no new/separate reporting mechanism.
- **Health / readiness** — `GET /api/health`
  (`src/app/api/health/route.ts`) now reports:
  - `database`: a real `SELECT 1` (unchanged from Phase 3) — the only
    dependency that fails the overall 200→503 status, since nothing in
    the app works without it.
  - `redis`: `connected` / `unreachable` (a real, cheap `PING` — see
    `checkRedisHealth()` in `lib/rate-limit.ts`) or `not_configured`.
    Unconfigured/unreachable Redis does **not** flip overall status to
    503 — rate limiting has a documented, working in-memory fallback.
    (Phase 9.4: a configured-but-unreachable Redis, or misconfigured storage,
    now reports top-level `status: "degraded"` — still HTTP 200 — so a monitor
    on the body can alert; `status` is `ok` / `degraded` / `error`.)
  - `storage`: `local` / `s3` / `misconfigured` — configuration only, no
    real S3 call.
  - `ai`: `configured` / `not_configured` — configuration only, no real
    AI request.
  - `config` (Phase 9.4): `ok` / `misconfigured` — in production, whether
    mandatory configuration (`NEXTAUTH_SECRET`) is present; never names the
    variable. `misconfigured` → 503. DB and Redis checks are bounded to 3s.
  - `GET /api/health/live` (Phase 9.4) is a dependency-free **liveness**
    probe (always 200 while the process serves requests) — point orchestrator
    restarts at it and readiness/load-balancing at `/api/health`.

## Datadog components actually used

| Component | Used? | How |
|---|---|---|
| Logs | ✅ | Direct HTTP POST to Datadog's Logs intake v2 API |
| Metrics | ✅ | Direct HTTP POST to Datadog's Metrics intake v2 API |
| APM / tracing | ❌ | Evaluated, not implemented — see below |
| RUM / browser | ❌ | Evaluated, not implemented — see below |

No `dd-trace` package, no Datadog Agent, no DogStatsD/UDP client. See
`src/lib/observability/datadog.ts`'s doc comment for the full reasoning;
short version below.

## Why direct HTTP intake instead of `dd-trace`/the Agent

This repository has no Dockerfile, `vercel.json`, or CI/deploy workflow —
the deployment target isn't pinned anywhere in-repo. `dd-trace` (APM) and
DogStatsD-based metrics libraries both assume a Datadog Agent process (or
a platform-specific Lambda extension) is reachable alongside the app.
That can't be assumed here, and getting it wrong would mean logs/metrics
silently going nowhere with no error.

Direct HTTP submission (`fetch` to Datadog's intake APIs, gated entirely
on `DD_API_KEY`) works identically regardless of deployment target, needs
nothing running beside the app, and matches this codebase's existing
convention of calling external APIs directly rather than adding a
provider SDK (`services/google-drive.ts`, `services/speech-openai.ts`).

## Deliberately NOT done this phase

- **Full APM / distributed tracing.** Would need either a Datadog Agent
  sidecar or a Lambda-specific extension — a real deployment-architecture
  decision this phase shouldn't force. The `duration`/`outcome` fields
  already captured in AI metrics/logs give latency and failure visibility
  without it. **To add later:** once a concrete deployment target is
  chosen (a long-running container vs. a specific serverless platform),
  `dd-trace`'s Node APM integration is the natural next step, initialized
  via `instrumentation.ts` (stable in this app's Next.js 14.2.15, no
  experimental flag needed).
- **Datadog RUM / browser monitoring.** Would need a public Datadog
  Client Token and, if session-replay-style RUM (not just error capture)
  were enabled, real care about not recording form inputs containing
  document/AI-conversation content. The new `/api/client-errors` endpoint
  gets equivalent value (client-side crashes reaching Datadog) without
  any of that, using only server-side infrastructure this phase already
  built. Revisit if you want performance/session-level browser insight
  beyond crash reporting.
- **Retrofitting `logServerError`/request-ID into every route.** Only the
  routes named in the Phase 9.2 prompt as high-value boundaries (AI
  messages, health, the new client-error endpoint) were touched. ~30
  other routes still end their catch blocks the way Phase 9.1 left them.
  Extending coverage is mechanical but should be its own reviewed change,
  not folded into this one.
- **Custom business/usage metrics**, **an in-app dashboard**, and
  **automatic dashboard/monitor provisioning** — explicit non-goals per
  the Phase 9.2 prompt. See "Recommended Datadog monitors" below for what
  to configure on Datadog's side instead.

## Activating it

1. Get a Datadog API key: Organization Settings → API Keys (an **API**
   key, not an application key — nothing here needs one).
2. Set `DD_API_KEY` (and `DD_SITE` if your org isn't on US1 — check your
   Datadog URL) in your deployment's environment variables. See
   `.env.example` for all five variables and their defaults.
3. That's it — no code changes, no Agent to install. Every function in
   `lib/observability/datadog.ts` is a safe no-op until `DD_API_KEY` is
   set, so this can be turned on in production without touching local
   development.
4. Verify: trigger a real failure (e.g. temporarily unset an AI provider
   key and send a chat message) and confirm the corresponding log/metric
   appears in Datadog within a minute or two. This integration has
   **not** been tested against a live Datadog account in this
   environment (no network egress to any `datadoghq.*` domain here) — it
   was built and verified against Datadog's current documented Logs v2 /
   Metrics v2 API contracts, but a real smoke test against your account
   is worth doing before relying on it.

## Recommended initial Datadog monitors

Not provisioned by the app (per the Phase 9.2 prompt — dashboard/monitor
configuration belongs on Datadog's side). Suggested starting points once
real traffic exists to calibrate thresholds against:

- **AI provider failure rate** — `sum:ai.chat.requests{outcome:failure}`
  vs. `sum:ai.chat.requests{*}` over a rolling window. Alert on a sudden
  spike, not an absolute count (traffic is too new to know a good static
  threshold yet).
- **AI latency** — `avg:ai.chat.latency_ms{*}` (or p95, once distribution
  metrics are worth the switch) — alert on sustained elevation vs. this
  service's own recent baseline.
- **Health check failures** — a log-based monitor on
  `service:notes-platform status:error` from the health-check logs (the
  `checkDatabase()` failure path) — this is a "the app is down" signal,
  should page immediately.
- **Elevated client-error rate** — a log-based monitor on
  `service:notes-platform route:client-errors` volume — a spike usually
  means a bad deploy.
- **Redis unreachable** — currently only visible via `/api/health`'s
  `redis: "unreachable"` field, not yet a dedicated metric; a synthetic
  check hitting `/api/health` on an interval and alerting on
  `redis != "connected"` (when Redis is expected to be configured) covers
  this without new app code.

Don't hard-code specific numeric thresholds into any of the above until
you have a few weeks of real production traffic to calibrate against —
an early threshold picked from nothing is more likely to be noisy than
useful.
