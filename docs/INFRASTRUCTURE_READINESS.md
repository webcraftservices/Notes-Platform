# Zenote — Infrastructure & Credential Readiness Audit (Phase 15.5)

> **Audit Scope:** Pre-Phase 16 source-level, configuration, service, hosting, cost, and operational readiness audit *(Addendum reconciled Nov 15, 2026 through Stages A–D)*  
> **Audit Date:** November 13, 2026 *(Updated Nov 15, 2026 with Stage A–D implementation notes)*  
> **Repository Baseline:** Phases 1–15 + Stages A–D implemented (`13` Prisma migrations verified on isolated `zenote_phase13_test` PostgreSQL 18.6 + `pgvector 0.8.6`; Phase 15 Independent Final Closure Audit status: `CONDITIONAL PASS`)  
> **Safety Posture:** Strictly read-only credential audit. Zero secrets modified or printed; zero external accounts created; shared `/neondb` untouched.

> **Post-Audit Stage A–D Implementation Addendum (November 15, 2026):** Several code-level gaps identified during the November 13 Phase 15.5 audit have now been closed in code while external secret/cloud provisioning remains an external prerequisite: multi-stage [`Dockerfile`](../Dockerfile) + `docker-compose.yml` + GitHub Actions CI/CD (`.github/workflows/`), dynamic `STORAGE_ENDPOINT` CSP `connect-src` in `next.config.js`, Redis TLS/backoff/cooldown hardening (`LIM-20(2)`), Azure Managed Identity + Key Vault + Google WIF / Vertex AI auth modes (`src/lib/cloud/`), Redis Pub/Sub SSE scaling (`SSE_REDIS_PUBSUB_ENABLED`), Stripe checkout/portal same-origin redirect validation (`LIM-20(4)(c)` closed in `src/lib/billing/redirect-origin.ts`), Azure Container Apps Bicep + Alerts (`infra/azure/`, `infra/monitoring/`), and [`docs/DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md). Phase 14 Google hermetic coverage also reconciles `14` Phase 14 suites (`109` tests) plus the pre-existing `google-errors.test.ts` (`17` tests) = `15` total Google suites (`126` tests).

---

## 1. Executive Summary

- **Overall Infrastructure Readiness Verdict:** **`CONDITIONALLY READY`**
- **Core Architectural Finding:** Zenote's application codebase across all 15 phases is **technically complete and fail-closed**, with clean interface boundaries for PostgreSQL/pgvector, Redis/BullMQ, S3/R2 object storage, Google OAuth + Drive/Docs/Slides, Gemini AI, OpenAI Embeddings, AssemblyAI/Whisper STT, Stripe Billing, and Datadog observability.
- **What Is Ready / Verified Today:**
  - **Relational + Vector Schema (`13/13` migrations):** Verified against an isolated PostgreSQL 18.6 (`pgvector 0.8.6`) test database (`zenote_phase13_test`) in Phase 15.
  - **Upstash Redis TCP (BullMQ):** Automatically derived from existing `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (`prime-bluejay-312074.upstash.io:6379`) and verified with a live queue/worker round-trip in Phase 15 (`src/lib/__tests__/phase15-live-integration.test.ts` Test 4).
  - **Formatted Locally (Unverified Live):** Cloudflare R2 (`notes-platform-prod`), Google Drive OAuth client (`GOOGLE_DRIVE_CLIENT_ID`/`SECRET`), AssemblyAI (`ASSEMBLYAI_API_KEY`), Datadog (`DD_API_KEY` on `us5.datadoghq.com`), `NEXTAUTH_SECRET`, and Web3Forms (`NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY`) have properly formatted non-placeholder values in `.env.local`, but have not been smoke-tested against live external APIs in Phase 15.5.
- **Critical Blockers Before Staging / Production (`Why CONDITIONALLY READY`):**
  1. **Placeholder Credentials + Misconfigured AI Provider in `.env.local`:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_AI_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` contain placeholder strings, AND `AI_PROVIDER` is currently set to `"anthropic"` (which has **no implementation** in `src/lib/services/ai.ts` — only `"gemini"` is implemented). Consequently, Google Sign-In, Gemini AI notes/tutor, and OpenAI 1536-dim RAG embeddings (`LIM-12`) are inactive until real keys and `AI_PROVIDER="gemini"` are supplied.
  2. **Environment Coupling Hazard:** `.env` and `.env.local` both point `DATABASE_URL` directly at Neon `/neondb` (which does **not** yet have Phases 13–15 migrations applied, while `zenote_phase13_test` is isolated), alongside `STORAGE_BUCKET="notes-platform-prod"`, `DD_ENV="production"`, and `NEXTAUTH_URL="http://127.0.0.1:3000"`. Staging and production environments must be cleanly separated before Phase 16.
  3. **Unprovisioned External Hosting Resources *(Repo Artifacts Added Later in Stages A–D; Live Cloud Provisioning Still Pending)*:** At the Nov 13 Phase 15.5 audit baseline, no container or CI/CD files existed. Stages A–D subsequently added the multi-stage `Dockerfile` (`migrator`, `web`, `worker`), `docker-compose.yml`, Azure Container Apps Bicep (`infra/azure/main.bicep`), and GitHub Actions CI/CD (`.github/workflows/`); live Linux Docker execution (`LIM-21`), cloud tenant provisioning, and public HTTPS ingress remain pending external prerequisites.
  4. **Unconfigured Billing & Deferred Monetization (`LIM-19`):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID_{STUDENT,PRO,TEAM,INSTITUTION}` are completely unset (safely failing closed with HTTP `503`). Test-mode keys can validate checkout flows in staging, while **final live Stripe Price IDs must wait until Phase 17** finalizes Zenote's business pricing model.
  5. **Google OAuth Verification & Restricted Scopes (`LIM-17`):** `GOOGLE_DRIVE_SCOPES` (`src/lib/services/google-oauth.ts`) requests `drive.readonly` and `documents`. In Google Cloud "Testing" mode, external user refresh tokens expire after **7 days** (causing `invalid_grant` / `RECONNECT_REQUIRED`) and users are capped at **100 test users**; public production launch requires Google verification and an annual **CASA Tier 2** security assessment unless scopes are narrowed.
  6. **Missing Transactional Email Capability:** No email provider (`Resend`, `Postmark`, `SES`, `SMTP_*`) exists anywhere in the repository (`passwordHash` reset emails, email verification links, and group invitation emails are not wired yet).
  7. **Code/Config Traps Discovered During Nov 13 Audit *(Reconciled Through Stages A–D)*:**
     - `next.config.js` originally hardcoded `https://f03d7c364f5dd204ce76f719835c5c28.r2.cloudflarestorage.com` in `Content-Security-Policy` `connect-src`. **Closed in Stage A:** `next.config.js` now dynamically injects the origin derived from build-time `STORAGE_ENDPOINT` (retaining the existing R2 origin only as fallback when unset, plus optional `CSP_EXTRA_CONNECT_SRC`).
     - Legacy documentation (`PROJECT_STATE.md §8` prior to Stage A–D reconciliation) listed deprecated `STORAGE_DRIVER` and `S3_*` names; canonical application source (`src/lib/services/storage.ts`, `.env.example`, `GET /api/health`) and reconciled docs exclusively use **`STORAGE_PROVIDER`**, **`STORAGE_ENDPOINT`**, **`STORAGE_REGION`**, **`STORAGE_BUCKET`**, **`STORAGE_ACCESS_KEY_ID`**, and **`STORAGE_SECRET_ACCESS_KEY`**.

---

## 2. Existing Infrastructure Inventory

All facts below were verified by source inspection (`src/`, `prisma/`, `package.json`, `next.config.js`, `.env.example`) and safe key-name/format checks against `.env` and `.env.local` (without reading or exposing secret values):

| Component | Current Asset / Configuration | Scope / Environment | Verified Facts & Caveats |
|---|---|---|---|
| **Primary Managed PostgreSQL** | Neon PostgreSQL (`ep-crimson-shadow-azxdifls-pooler.c-3.ap-southeast-1.aws.neon.tech`, DB: `neondb`, `sslmode=require`) | Shared Dev DB in `.env` & `.env.local` | Phase 12 schema + `pgvector` verified here historically; Phases 13–15 migrations were deliberately NOT run here (`LIM-12` notes `51` active Materials, `2` active Notes with `0` vectors due to placeholder `OPENAI_API_KEY`). Uses pooled `-pooler` endpoint without a separate `DIRECT_URL`. |
| **Isolated Test PostgreSQL** | `zenote_phase13_test` (`PostgreSQL 18.6`, `pgvector 0.8.6`) | Ephemeral CLI-only (`ISOLATED_TEST_DATABASE_URL`) | Holds all `13/13` migrations (`20260823142337_initial_schema` through `20261113210000_phase15_durable_jobs_and_billing`). Contains `0` `ConnectedAccount` rows. Not persisted in `.env*`. |
| **Redis (HTTP REST & TCP/TLS)** | Upstash Redis (`prime-bluejay-312074.upstash.io`) | Shared Dev Redis in `.env.local` | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` set. BullMQ automatically derives TLS TCP `rediss://default:<token>@prime-bluejay-312074.upstash.io:6379` (`src/lib/queue/connection.ts`), verified live in Phase 15 (`phase15-live-integration.test.ts` Test 4). HTTP REST `rateLimit` (`src/lib/rate-limit.ts`) has not been live-tested in Phase 15.5. |
| **Object Storage (S3-Compatible)** | Cloudflare R2 (`f03d7c364f5dd204ce76f719835c5c28.r2.cloudflarestorage.com`, bucket `notes-platform-prod`, region `auto`) | Prod-named bucket in `.env.local` | `STORAGE_PROVIDER="s3"`, 32-char hex access key + 64-char hex secret key present. Presigned PUT/GET URLs are returned directly to browsers (`storage-s3.ts`). Stage A updated `next.config.js` CSP `connect-src` to derive dynamically from build-time `STORAGE_ENDPOINT` + optional `CSP_EXTRA_CONNECT_SRC`. Live upload/head/CORS untested. |
| **Google OAuth — Sign-In** | NextAuth `GoogleProvider` (`src/lib/auth.ts`) | `.env.local` | `GOOGLE_CLIENT_ID` (len=30) and `GOOGLE_CLIENT_SECRET` (len=34) are **placeholder strings** (fail `*.apps.googleusercontent.com` check). Google login disabled/non-functional until replaced. |
| **Google OAuth — Drive/Docs/Slides** | Dedicated OAuth client (`src/lib/services/google-oauth.ts`) | `.env.local` | `GOOGLE_DRIVE_CLIENT_ID` (len=72, `*.apps.googleusercontent.com`) and `GOOGLE_DRIVE_CLIENT_SECRET` (`GOCSPX-*`, len=35) are validly formatted. `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_WEBHOOK_SECRET`, and `GOOGLE_DRIVE_WEBHOOK_URL` are **unset** (encryption & webhook HMAC fall back to `NEXTAUTH_SECRET`). Untested live; `ConnectedAccount count = 0` (`LIM-17`). |
| **AI Generation (LLM)** | `@google/genai` `gemini-2.5-flash-lite` (`src/lib/services/ai-gemini.ts`) | `.env.local` | `.env.local` sets `AI_PROVIDER="anthropic"` with placeholder keys for `ANTHROPIC_API_KEY` (len=31) and `GOOGLE_AI_API_KEY` (len=31, does not start with `AIza`). `src/lib/services/ai.ts` only implements `"gemini"`; `"anthropic"` and `"openai"` throw `ServiceNotConfiguredError`. |
| **Embeddings (`vector(1536)`)** | `openai` `text-embedding-3-small` (`src/lib/services/embedding-openai.ts`) | `.env.local` | `EMBEDDING_PROVIDER="openai"`, but `OPENAI_API_KEY` (len=28, does not start with `sk-`) is a **placeholder string**. Historical dev embedding jobs failed `401`. Required for Phase 12 semantic search & Whisper fallback. |
| **Speech-to-Text** | AssemblyAI Universal-2 (`src/lib/services/speech-assemblyai.ts`) | `.env.local` | `SPEECH_PROVIDER="assemblyai"` with a 32-char hex `ASSEMBLYAI_API_KEY`. Supports speaker diarization and multi-hour audio without Whisper's 25 MB limit. Live API untested in Phase 15.5. |
| **Billing (Stripe)** | Custom zero-SDK Stripe REST + HMAC client (`src/lib/billing/stripe.ts`) | Unconfigured | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID_{STUDENT,PRO,TEAM,INSTITUTION}` are **completely unset**. API returns `stripeConfigured: false` and `503 STRIPE_NOT_CONFIGURED` safely (`LIM-19`). |
| **Observability (Datadog)** | Direct HTTP intake to Logs v2 & Metrics v2 (`src/lib/observability/datadog.ts`) | `.env.local` (`us5.datadoghq.com`) | 32-char hex `DD_API_KEY`, `DD_SITE="us5.datadoghq.com"`, `DD_ENV="production"`, `DD_SERVICE="notes-platform"`, `DD_VERSION` (len=5) are present. Live intake untested (`docs/observability.md`). No `dd-trace` APM or RUM. |
| **Public Contact Form** | Web3Forms (`src/lib/contact-form.ts`) | `.env` & `.env.local` | `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY` (36-char UUID) set in both `.env` and `.env.local`. Allowed by `next.config.js` CSP (`https://api.web3forms.com`). Live submission untested. |
| **App Runtime & Hosting** | Local Windows dev (`next dev -H 127.0.0.1`, Node `22.23.2`) + Stages A–D Docker / ACA IaC (`Dockerfile`, `infra/azure/main.bicep`, `.github/workflows/`) | Repo IaC & Local Dev | Multi-stage `Dockerfile` (`migrator`, `web`, `worker`), `docker-compose.yml`, ACA Bicep (`infra/azure/main.bicep`), and GitHub Actions CI/CD (`.github/workflows/`) are authored in-repo; live Linux Docker verification (`LIM-21`) and Azure/cloud provisioning remain external prerequisites. Local `NEXTAUTH_URL="http://127.0.0.1:3000"`. |

---

## 3. Complete Environment Variable Inventory (13 Categories)

Every `process.env` and `prisma/schema.prisma` `env()` reference across `src/`, `prisma/`, and `next.config.js` is inventoried below.

> **Important Variable Naming Discrepancy (`PROJECT_STATE.md` vs Source):**  
> `PROJECT_STATE.md §8` lists legacy names `STORAGE_DRIVER` and `S3_*`. **Do not use those names.** Actual application code (`src/lib/services/storage.ts`, `src/app/api/health/route.ts`, `.env.example`) exclusively reads **`STORAGE_PROVIDER`**, **`STORAGE_ENDPOINT`**, **`STORAGE_REGION`**, **`STORAGE_BUCKET`**, **`STORAGE_ACCESS_KEY_ID`**, **`STORAGE_SECRET_ACCESS_KEY`**, and **`STORAGE_LOCAL_DIR`**.

| Category | Variable Name | Required? | Default / Fallback | Source Reference(s) | Client-Exposed? | Purpose & Scope |
|---|---|---|---|---|---|---|
| **1. Core App & Runtime** | `NODE_ENV` | Auto-set by Node/Next (`"production"` in prod) | `"development"` in `.env.local` | `next.config.js:19`, `db.ts:8,11`, `instrumentation.ts:15`, `health/route.ts:117`, `datadog.ts:76`, `connection.ts:100` | No (inlined by Next build where checked) | Controls Prisma logging, CSP `'unsafe-eval'`, required-config health enforcement, instrumentation boot, and test guardrails |
| | `NEXTAUTH_URL` | **Required (Prod/Staging)** | Falls back to `req.origin` in OAuth routes (`google-setup.md`), `"https://zenote.app"` in SEO (`site-config.ts`) | `google/connect/route.ts:10`, `google/callback/route.ts:9,14`, `google-drive-sync.ts:103`, `site-config.ts:27` | Server (NextAuth internals) | Canonical origin for NextAuth cookies (`https://` enables `Secure` cookies), OAuth redirect URIs, and Drive webhook URL fallback |
| | `SITE_URL` | Optional | Falls back to `NEXTAUTH_URL` then `"https://zenote.app"` | `src/lib/site-config.ts:22` | Server / Build | Non-public override for canonical site URL if different from `NEXTAUTH_URL` |
| | `VITEST` | Auto-set by Vitest | `undefined` | `src/lib/queue/connection.ts:100` | No | Suppresses live BullMQ Redis TCP connections during test runs unless `ENABLE_LIVE_BULLMQ_TESTS="true"` |
| | `NEXT_RUNTIME` | Auto-set by Next.js | `"nodejs"` \| `"edge"` | `src/instrumentation.ts:13` | No | Ensures instrumentation worker/recovery startup only runs in Node.js server runtime |
| | `NEXT_PHASE` | Auto-set by Next.js CLI | `undefined` | `src/instrumentation.ts:14` | No | Prevents startup recovery/worker from launching during `next build` (`phase-production-build`) |
| **2. Database / PostgreSQL** | `DATABASE_URL` | **Mandatory (Boot)** | None (hard failure on query/boot) | `prisma/schema.prisma:24`, `health/route.ts` | No (Secret) | Primary PostgreSQL 15+ (`pgvector` required) connection string for app & migrations |
| **3. Auth & Security** | `NEXTAUTH_SECRET` | **Mandatory (Prod)** | In dev only, NextAuth permits unset (`health/route.ts:117`) | `auth.ts:107`, `health/route.ts:118`, `google-oauth-state.ts:19`, `crypto.ts:22`, `google-drive-sync.ts:53` | No (Secret) | JWT signing/encryption, OAuth state HMAC, fallback key for `GOOGLE_TOKEN_ENCRYPTION_KEY` & `GOOGLE_WEBHOOK_SECRET` |
| **4. Google OAuth / Sign-In** | `GOOGLE_CLIENT_ID` | Required for Google Login | `""` (empty causes invalid Google login redirect); also fallback for `GOOGLE_DRIVE_CLIENT_ID` | `src/lib/auth.ts:30`, `src/lib/services/google-oauth.ts:52` | No (Server) | NextAuth `GoogleProvider` OAuth 2.0 Web Client ID for sign-in |
| | `GOOGLE_CLIENT_SECRET` | Required for Google Login | `""`; also fallback for `GOOGLE_DRIVE_CLIENT_SECRET` | `src/lib/auth.ts:31`, `src/lib/services/google-oauth.ts:53` | No (Secret) | NextAuth `GoogleProvider` OAuth 2.0 Client Secret |
| **5. Google Drive / Docs / Slides Sync** | `GOOGLE_DRIVE_CLIENT_ID` | Required for Drive/Docs/Slides | Falls back to `GOOGLE_CLIENT_ID` (`google-oauth.ts:52`) | `src/lib/services/google-oauth.ts:52` | No (Server) | Dedicated Google Cloud OAuth 2.0 Client ID for Connected Accounts (`GOOGLE_DRIVE_SCOPES`) |
| | `GOOGLE_DRIVE_CLIENT_SECRET` | Required for Drive/Docs/Slides | Falls back to `GOOGLE_CLIENT_SECRET` | `src/lib/services/google-oauth.ts:53` | No (Secret) | Dedicated Google Cloud OAuth 2.0 Client Secret for Connected Accounts |
| | `GOOGLE_TOKEN_ENCRYPTION_KEY` | **Recommended (Prod)** | Falls back to `NEXTAUTH_SECRET` (`crypto.ts:22`) | `src/lib/crypto.ts:22`, `src/lib/google-drive-sync.ts:52` | No (Secret) | Independent secret (stretched via `scryptSync` into AES-256-GCM key) to encrypt `ConnectedAccount` tokens at rest |
| | `GOOGLE_DRIVE_WEBHOOK_URL` | Required for live Drive push in serverless/proxied setups | Falls back to `${NEXTAUTH_URL}/api/integrations/google/webhook` | `src/lib/google-drive-sync.ts:102` | No | Public `https://` endpoint passed to Google Drive `changes.watch` (`address`) |
| | `GOOGLE_WEBHOOK_SECRET` | **Recommended (Prod)** | Falls back to `GOOGLE_TOKEN_ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, or hardcoded dev fallback | `src/lib/google-drive-sync.ts:51` | No (Secret) | HMAC-SHA256 key used to sign/hash `X-Goog-Channel-Token` into `ConnectedAccount.watchTokenHash` |
| **6. Redis / Rate Limiting / BullMQ** | `UPSTASH_REDIS_REST_URL` | Required for distributed rate limit & auto-derived Upstash TCP | In-memory rate limit fallback (`rate-limit.ts`) | `src/lib/rate-limit.ts:78`, `src/lib/queue/connection.ts:51` | No | HTTPS REST endpoint for `@upstash/redis`; hostname also reused for BullMQ TLS TCP derivation |
| | `UPSTASH_REDIS_REST_TOKEN` | Required with `UPSTASH_REDIS_REST_URL` | None | `src/lib/rate-limit.ts:79`, `src/lib/queue/connection.ts:52` | No (Secret) | Auth token for Upstash REST API and TLS TCP password (`rediss://default:<token>@...`) |
| | `UPSTASH_REDIS_TCP_PORT` | Optional | `6379` | `src/lib/queue/connection.ts:57` | No | Port override when deriving Upstash TLS TCP connection URL |
| | `BULLMQ_REDIS_URL` | Optional (Priority 1 TCP) | Falls back to `REDIS_URL`, then Upstash derivation | `src/lib/queue/connection.ts:31` | No (Secret) | Explicit `redis://` or `rediss://` URL for BullMQ (`ioredis`) overriding Upstash derivation |
| | `REDIS_URL` | Optional (Priority 2 TCP) | Falls back to Upstash derivation | `src/lib/queue/connection.ts:39` | No (Secret) | Generic standard Redis TCP URL for BullMQ (`ioredis`) |
| | `BULLMQ_ENABLED` | Optional | Enabled if Redis config resolves (outside tests) | `src/lib/queue/connection.ts:99` | No | Set `"false"` to force pure in-process execution even when Redis vars exist |
| | `BULLMQ_DISABLE_UPSTASH_TCP` | Optional | `false` | `src/lib/queue/connection.ts:47` | No | Set `"true"` to keep Upstash HTTP REST rate limiting while disabling BullMQ TCP derivation |
| | `BULLMQ_QUEUE_NAME` | Optional | `"zenote-processing-jobs"` | `src/lib/queue/dispatcher.ts:22` | No | BullMQ queue namespace (useful to isolate staging vs prod if sharing Redis, though separate instances are recommended) |
| | `BULLMQ_DEDICATED_WORKER` | **Important for Split Hosting** | `false` (runs in-process too) | `src/lib/queue/dispatcher.ts:186` | No | Set `"true"` on the Web server when `npm run worker` runs separately so web routes enqueue without also executing heavy jobs locally |
| | `BULLMQ_WORKER_CONCURRENCY` | Optional | `3` | `src/lib/queue/worker.ts:63` | No | Concurrent BullMQ jobs handled by each worker process |
| **7. Storage (R2 / S3 / Local)** | `STORAGE_PROVIDER` | Recommended explicit | `"s3"` if `STORAGE_ENDPOINT` or `STORAGE_BUCKET` set; else `"local"` | `src/lib/services/storage.ts:35`, `health/route.ts:139` | No | Selects `"s3"` (Cloudflare R2 / AWS S3) or `"local"` |
| | `STORAGE_ENDPOINT` | Required for non-AWS S3 (R2/B2/MinIO) | `undefined` (standard AWS S3 endpoint) | `src/lib/services/storage.ts:36,54`, `health/route.ts:140` | Reflected indirectly in `next.config.js` CSP | S3-compatible HTTPS endpoint (`https://<account>.r2.cloudflarestorage.com`) |
| | `STORAGE_REGION` | Optional | `"auto"` (standard for Cloudflare R2) | `src/lib/services/storage.ts:44` | No | Region string passed to AWS SDK `S3Client` |
| | `STORAGE_BUCKET` | **Mandatory if `"s3"`** | None (throws if unset in S3 mode) | `src/lib/services/storage.ts:36,41`, `health/route.ts:140` | No | Target private bucket name |
| | `STORAGE_ACCESS_KEY_ID` | **Mandatory if `"s3"`** | None (throws if unset in S3 mode) | `src/lib/services/storage.ts:42` | No (Secret) | S3 / R2 API Token Access Key ID |
| | `STORAGE_SECRET_ACCESS_KEY` | **Mandatory if `"s3"`** | None (throws if unset in S3 mode) | `src/lib/services/storage.ts:43` | No (Secret) | S3 / R2 API Token Secret Access Key |
| | `STORAGE_LOCAL_DIR` | Optional (local mode only) | `./.storage` | `src/lib/services/storage.ts:65-66` | No | Local filesystem root for dev file uploads |
| **8. AI & Embeddings** | `AI_PROVIDER` | Required for AI features | Throws `ServiceNotConfiguredError` if unset or not `"gemini"` | `src/lib/services/ai.ts:30` | No | Must be `"gemini"` today (`"anthropic"` & `"openai"` throw unimplemented) |
| | `GOOGLE_AI_API_KEY` | Required when `AI_PROVIDER="gemini"` | None | `src/lib/services/ai-gemini.ts:584` | No (Secret) | Google Gemini API key (`gemini-2.5-flash-lite`) for Notes, Chat, Tutor, Flashcards, Quizzes |
| | `EMBEDDING_PROVIDER` | Required for semantic RAG/search | Throws `ServiceNotConfiguredError` if unset or not `"openai"` | `src/lib/services/embedding.ts:41` | No | Must be `"openai"` today (`"google"` unimplemented due to fixed `vector(1536)`) |
| | `OPENAI_API_KEY` | Required for embeddings (or Whisper) | None | `embedding-openai.ts:147`, `speech-openai.ts:87` | No (Secret) | OpenAI key for `text-embedding-3-small` (`1536d`) and optional `whisper-1` |
| | `ANTHROPIC_API_KEY` | Future / Reserved | Unimplemented in `ai.ts` | `.env.example:46`, `src/lib/services/ai.ts:24` | No (Secret) | Reserved for future `ai-anthropic.ts`; currently non-functional |
| **9. Speech-to-Text / Audio** | `SPEECH_PROVIDER` | Required for audio transcription | Throws `ServiceNotConfiguredError` | `src/lib/services/speech.ts:17`, `src/lib/transcription.ts:80,86` | No | Selects `"assemblyai"` (recommended, diarization, no 25 MB limit) or `"openai"` |
| | `ASSEMBLYAI_API_KEY` | Required when `SPEECH_PROVIDER="assemblyai"` | None | `src/lib/services/speech-assemblyai.ts:170` | No (Secret) | AssemblyAI Universal-2 transcription + speaker diarization API key |
| **10. Stripe Billing** | `STRIPE_SECRET_KEY` | Required to enable billing | Disabled / HTTP `503` if unset | `src/lib/billing/stripe.ts:111,285,352` | No (Secret) | Stripe API secret key (`sk_test_...` staging, `sk_live_...` production) |
| | `STRIPE_WEBHOOK_SECRET` | Required for webhook sync | Throws `StripeNotConfiguredError` on webhook POST | `src/lib/billing/stripe.ts:214` | No (Secret) | Stripe signing secret (`whsec_...`) for `POST /api/billing/webhook` |
| | `STRIPE_PRICE_ID_STUDENT` | Required for Student checkout | `null` (`checkoutAvailable: false`) | `src/lib/billing/stripe.ts:121-125` | No | Stripe Price ID (`price_...`) mapped to `PlanTier.STUDENT` |
| | `STRIPE_PRICE_ID_PRO` | Required for Pro checkout | `null` | `src/lib/billing/stripe.ts:121-125` | No | Stripe Price ID (`price_...`) mapped to `PlanTier.PRO` |
| | `STRIPE_PRICE_ID_TEAM` | Required for Team checkout | `null` | `src/lib/billing/stripe.ts:121-125` | No | Stripe Price ID (`price_...`) mapped to `PlanTier.TEAM` |
| | `STRIPE_PRICE_ID_INSTITUTION` | Required for Institution checkout | `null` | `src/lib/billing/stripe.ts:121-125` | No | Stripe Price ID (`price_...`) mapped to `PlanTier.INSTITUTION` |
| **11. Observability / Datadog** | `DD_API_KEY` | Optional (no-op if unset) | Logging/metrics skipped | `src/lib/observability/datadog.ts:65,105,146` | No (Secret) | Datadog Organization API Key (HTTP Logs v2 & Metrics v2) |
| | `DD_SITE` | Optional | `"datadoghq.com"` (US1) | `src/lib/observability/datadog.ts:70` | No | Datadog site host (e.g. `"us5.datadoghq.com"`) |
| | `DD_SERVICE` | Optional | `"notes-platform"` | `src/lib/observability/datadog.ts:75,111` | No | Datadog `service:` tag (recommend updating to `"zenote"` for prod) |
| | `DD_ENV` | Optional | Falls back to `NODE_ENV` (`"development"`) | `src/lib/observability/datadog.ts:76` | No | Datadog `env:` tag (`"staging"` vs `"production"`) |
| | `DD_VERSION` | Optional | Omitted if unset | `src/lib/observability/datadog.ts:78` | No | Release tag / Git SHA for incident correlation |
| **12. Frontend Public & Onboarding** | `NEXT_PUBLIC_SITE_URL` | Recommended (Prod) | Falls back to `SITE_URL`, `NEXTAUTH_URL`, `"https://zenote.app"` | `src/lib/site-config.ts:17` | **Yes (`NEXT_PUBLIC_`)** | Canonical domain for SEO metadata, OpenGraph, JSON-LD, `sitemap.xml` |
| | `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY` | Optional | Contact form disables submission | `contact-section.tsx:24`, `contact-form.ts:68,71` | **Yes (`NEXT_PUBLIC_`)** | Public Web3Forms access UUID (intentionally client-side per Web3Forms design) |
| | `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Optional | Omitted | `src/app/layout.tsx:90,92` | **Yes (`NEXT_PUBLIC_`)** | HTML meta tag verification code for Google Search Console |
| | `NEXT_PUBLIC_ZENOTE_DOWNLOAD_URL` | Optional | Button/link hidden (`null`) | `src/components/onboarding/intro-hero.tsx:11` | **Yes (`NEXT_PUBLIC_`)** | Optional download CTA URL (e.g. future desktop/mobile installer) |
| **13. Operational Tuning & Test Flags** | `DOCUMENT_EXTRACTION_CONCURRENCY` | Optional | `1` | `document-extraction-scheduler.ts:94` | No | Per-process extraction semaphore limit |
| | `DOCUMENT_EXTRACTION_MAX_QUEUE_DEPTH` | Optional | `30` | `document-extraction-scheduler.ts:99` | No | Max in-memory queued extractions before `429`/rejection |
| | `DOCUMENT_EXTRACTION_MAX_QUEUE_WAIT_MS` | Optional | `300000` (5 min) | `document-extraction-scheduler.ts:104` | No | Max queue wait before timeout error |
| | `DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS` | Optional | `120000` (min `5000`) | `document-extraction.ts:91` | No | Active PDF/DOCX/PPTX extraction timeout per job |
| | `ISOLATED_TEST_DATABASE_URL` | Test-only (Live PG suites) | `undefined` (live DB tests skip) | `search-postgres-integration.test.ts`, `study-postgres-integration.test.ts`, `phase15-live-integration.test.ts` | No | Mandatory guard URL ensuring live PG tests only run against dedicated isolated test DB (`zenote_phase13_test`), never `/neondb` |
| | `ENABLE_LIVE_BULLMQ_TESTS` | Test-only | `"false"` (skipped in Vitest) | `src/lib/queue/connection.ts:101`, `phase15-live-integration.test.ts:39` | No | Opt-in flag to run live Upstash TCP BullMQ integration tests |
| | `ALLOW_SEARCH_PG_INTEGRATION_TEST` | Test-only (Safety gate) | `undefined` | `search-postgres-integration.test.ts` | No | Explicit opt-in flag when non-local test DB verification is permitted |
| | `APP_ENV` / `VERCEL_ENV` | Runtime/Test safety check | `undefined` | `search-postgres-integration.test.ts` | No | Prevents destructive integration tests from ever executing in `"production"` |

**Client Exposure Audit (`NEXT_PUBLIC_*`):** Confirmed **zero** server secrets (`DATABASE_URL`, `NEXTAUTH_SECRET`, `STRIPE_SECRET_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `ASSEMBLYAI_API_KEY`, `GOOGLE_*_SECRET`, `STORAGE_SECRET_ACCESS_KEY`, `DD_API_KEY`, `UPSTASH_REDIS_REST_TOKEN`) use the `NEXT_PUBLIC_` prefix or reach client bundles. Only 4 benign public/SEO/form variables use `NEXT_PUBLIC_*`.

---

## 4. Credential Status Matrix

Classification criteria strictly enforced:
- **`VERIFIED`**: Proven against a real external service during Phase 15/15.5 verification.
- **`PRESENT — UNVERIFIED`**: Real-looking formatted value exists in `.env` / `.env.local`, but live network call has not been executed in this audit (or environment/domain setup is incomplete).
- **`MISSING`**: Absent, empty, or contains a placeholder string / misconfigured provider value.
- **`UNKNOWN`**: Unable to confirm external console status (quotas, billing, verification status) from local repo inspection alone.
- **`NOT YET REQUIRED`**: Intentionally deferred until staging/production/Phase 17 launch.

| Service / Capability | Variables Checked | Status | Evidence & Notes |
|---|---|---|---|
| **Isolated Test PostgreSQL (`zenote_phase13_test`)** | `ISOLATED_TEST_DATABASE_URL` (ephemeral CLI) | **`VERIFIED`** | Proven in Phase 15 (`13/13` migrations + `19/19` live PostgreSQL integration tests passed). |
| **Upstash Redis TCP (BullMQ)** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` -> `:6379` | **`VERIFIED`** | Live BullMQ enqueue + worker round-trip passed against `prime-bluejay-312074.upstash.io:6379` in `phase15-live-integration.test.ts` Test 4. |
| **Upstash Redis REST (Rate Limit)** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | **`PRESENT — UNVERIFIED`** | Credentials exist and TCP sibling works, but HTTPS `@upstash/redis` `PING` via `/api/health` was not live-executed in Phase 15.5. |
| **Neon Primary DB (`/neondb`)** | `DATABASE_URL` | **`PRESENT — UNVERIFIED`** (Schema **Stale** vs Phase 13–15) | Valid `sslmode=require` pooler string for `ep-crimson-shadow-azxdifls-pooler...neon.tech/neondb`. Deliberately untouched in Phases 13–15 (`neondb` lacks Phases 13–15 migrations). Needs separate Staging/Prod DBs + `DIRECT_URL`. |
| **NextAuth Session Core** | `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | **`PRESENT — UNVERIFIED`** (Dev URL) | `NEXTAUTH_SECRET` is a 44-char non-placeholder secret; `NEXTAUTH_URL` is `http://127.0.0.1:3000` (must change to HTTPS domain for staging/prod). |
| **Cloudflare R2 Storage** | `STORAGE_PROVIDER="s3"`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET="notes-platform-prod"`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_REGION="auto"` | **`PRESENT — UNVERIFIED`** | Properly formatted 32-hex ID + 64-hex secret for Cloudflare R2 (`f03d7c364f5dd204ce76f719835c5c28.r2.cloudflarestorage.com`). Live `PutObject`/`HeadObject` and bucket CORS origins unverified. |
| **AssemblyAI Speech-to-Text** | `SPEECH_PROVIDER="assemblyai"`, `ASSEMBLYAI_API_KEY` | **`PRESENT — UNVERIFIED`** | Valid 32-hex key present; live transcription call & remaining credit balance untested/unknown (`$50` starter vs paid card: **`UNKNOWN`**). |
| **Google Drive / Docs / Slides OAuth Client** | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` | **`PRESENT — UNVERIFIED`** (Live flow **`BLOCKED`** per `LIM-17`) | Valid `*.apps.googleusercontent.com` ID (len=72) and `GOCSPX-*` secret (len=35). Google Cloud enabled APIs, Testing vs Production publishing status, and authorized redirect URIs are **`UNKNOWN`** from local files; `ConnectedAccount count = 0`. |
| **Google Sign-In OAuth (`NextAuth`)** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **`MISSING`** | `.env.local` contains placeholder strings (do not match `*.apps.googleusercontent.com`). |
| **Google Gemini AI (`gemini-2.5-flash-lite`)** | `AI_PROVIDER`, `GOOGLE_AI_API_KEY` | **`MISSING`** | `.env.local` has `AI_PROVIDER="anthropic"` (unimplemented) AND placeholder `GOOGLE_AI_API_KEY` (does not start with `AIza`). |
| **OpenAI Embeddings (`text-embedding-3-small`) / Whisper** | `EMBEDDING_PROVIDER="openai"`, `OPENAI_API_KEY` | **`MISSING`** | `.env.local` has placeholder `OPENAI_API_KEY` (does not start with `sk-`). Confirming `LIM-12`, live vector indexing cannot run until replaced. |
| **Anthropic (`ANTHROPIC_API_KEY`)** | `ANTHROPIC_API_KEY` | **`NOT YET REQUIRED`** | Placeholder in `.env.local`; no `ai-anthropic.ts` implementation exists in the codebase. |
| **Google Token Encryption & Webhook Secret** | `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_WEBHOOK_SECRET` | **`MISSING`** (Safe fallback active, **Recommended for Prod**) | Unset in `.env.local` (falls back to `NEXTAUTH_SECRET`). Production should set independent secrets so session secret rotation doesn't invalidate stored Drive tokens or webhook hashes. |
| **Google Drive Public Webhook URL** | `GOOGLE_DRIVE_WEBHOOK_URL` | **`MISSING`** (Requires Staging/Prod HTTPS) | Unset; required alongside a public `https://` origin for live Drive `changes.watch` push notifications (`LIM-17`). |
| **Datadog HTTP Intake** | `DD_API_KEY`, `DD_SITE`, `DD_ENV`, `DD_SERVICE`, `DD_VERSION` | **`PRESENT — UNVERIFIED`** | 32-hex `DD_API_KEY` + `us5.datadoghq.com` present (`DD_ENV="production"` even locally!). Live intake acceptance & active plan/Student Pack expiry: **`UNKNOWN`**. |
| **Web3Forms Contact Form** | `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY` | **`PRESENT — UNVERIFIED`** | 36-char UUID present in `.env` and `.env.local`; live submission untested. |
| **Stripe Billing & Plan Prices** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_{STUDENT,PRO,TEAM,INSTITUTION}` | **`MISSING`** (Live Price IDs **`NOT YET REQUIRED`** until Phase 17) | Completely unset (`LIM-19`). Provision Stripe **Test Mode** (`sk_test_...`) in Phase 16 staging only to verify flows; defer Live prices until Phase 17 pricing finalization. |
| **Production Domain & TLS Ingress** | `NEXT_PUBLIC_SITE_URL`, `NEXTAUTH_URL` (`https://...`) | **`MISSING`** | Domain confirmation & hosting DNS/TLS setup pending Phase 16+. |
| **Transactional Email Service** | *(None in codebase)* | **`NOT YET REQUIRED`** (Architectural Gap) | No SMTP/Resend/Postmark code exists today. Needed before user-facing password reset, email verification, or emailed group invites. |

---

## 5. Provider-by-Provider Provisioning Instructions

1. **Neon PostgreSQL (Database & `pgvector`)**
   - **Dashboard:** `https://console.neon.tech` -> Project -> **Branches** & **Connection Details**.
   - **Action:** Keep `/neondb` separate or treat it as legacy dev; create dedicated branches/databases for `staging` and `production`. In **SQL Editor**, confirm `CREATE EXTENSION IF NOT EXISTS vector;` succeeds.
   - **Connection Strings:** Obtain **both** the Pooled connection string (with `-pooler`, used for `DATABASE_URL` at runtime) and Direct connection string (no `-pooler`, recommended for `prisma migrate deploy` to avoid PgBouncer prepared-statement or transaction-lock edge cases).
   - **Tier:** Free tier suffices for dev/staging (`100 CU-hours/mo`, `1 GB` storage/project, 5-min auto-suspend). Upgrade to **Launch** pay-as-you-go for production to eliminate cold-start wake latency and the 1 GB storage cap.

2. **Upstash Redis (Rate Limiting + BullMQ Queue)**
   - **Dashboard:** `https://console.upstash.com` -> Redis -> Select DB -> **Details**.
   - **Action:** Create a separate **staging** database (and later **production** database) in the same cloud region as your web + worker compute (lowest TCP latency for `ioredis` & REST rate limit). Enable **TLS** (default on Upstash).
   - **Copy:** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (Zenote automatically derives `rediss://default:<token>@<host>:6379`), OR set `BULLMQ_REDIS_URL` explicitly if using a non-Upstash Redis instance.
   - **Tier:** Free tier (`500,000 commands/mo`, `256 MB`, `10 GB` egress) handles dev & low-traffic staging thanks to Phase 15's conservative BullMQ timers (`stalledInterval: 60_000`, `drainDelay: 30`). Monitor command consumption before launch (`$10/mo` Fixed or `$0.20/100k` PAYG once worker traffic grows).

3. **Cloudflare R2 (Private Object Storage)**
   - **Dashboard:** Cloudflare Dashboard -> **R2 Object Storage** -> **Manage R2 API Tokens**.
   - **Action:** Verify `notes-platform-prod` exists and create a separate `zenote-staging` bucket so test uploads never mix with production files. Generate an **Object Read & Write** S3 API token scoped specifically to each bucket.
   - **CORS & CSP:** Configure bucket CORS (`PUT`, `GET`, `HEAD`, `POST`) in R2 Settings -> **CORS Policy** for both staging and production origins (see `docs/production-readiness.md`). `next.config.js` automatically derives CSP `connect-src` from `STORAGE_ENDPOINT` (plus optional `CSP_EXTRA_CONNECT_SRC`), falling back to the default Cloudflare R2 origin only when `STORAGE_ENDPOINT` is unset.
   - **Tier:** Free tier (`10 GB/mo` storage, `1M` Class A ops, `10M` Class B ops, `$0` egress) is ample for dev, staging, and early launch; payment method required to exceed 10 GB.

4. **Google Gemini API (`AI_PROVIDER="gemini"`)**
   - **Dashboard:** `https://aistudio.google.com/apikey` -> **Create API Key** (linked to a Google Cloud project).
   - **Action:** Generate key starting with `AIza...`, set `AI_PROVIDER="gemini"` and `GOOGLE_AI_API_KEY="..."` in `.env.local` (replacing `"anthropic"` and the placeholder key).
   - **Tier:** No credit card needed for Free Tier (`~5–15 RPM`, `500–1,500 RPD` depending on real-time tier quota — inspect live limits at `https://aistudio.google.com/rate-limit`). Note that Free Tier prompts may be used by Google to improve products; link a Cloud Billing account (**Tier 1 Paid**) before staging load tests or production student data to lift RPM limits and guarantee data privacy.

5. **OpenAI API (`EMBEDDING_PROVIDER="openai"`, optional Whisper)**
   - **Dashboard:** `https://platform.openai.com/api-keys` -> **Create new secret key** (`sk-...`) + `https://platform.openai.com/settings/organization/billing/overview`.
   - **Action:** Add a minimum prepaid credit balance (`$5–$10`) to activate API calls (OpenAI keys with `$0` credit fail with `429 insufficient_quota`). Keep `EMBEDDING_PROVIDER="openai"` (`text-embedding-3-small`, `1536` dimensions).
   - **Note:** OpenAI `whisper-1` is scheduled for deprecation/removal on **February 26, 2027** — keeping `SPEECH_PROVIDER="assemblyai"` avoids both that deprecation and Whisper's 25 MB limit.

6. **AssemblyAI (`SPEECH_PROVIDER="assemblyai"`)**
   - **Dashboard:** `https://www.assemblyai.com/app` -> API Key & Billing.
   - **Action:** Verify the existing 32-hex `ASSEMBLYAI_API_KEY` in the AssemblyAI console (`Account` -> `Billing` / `Usage`). New accounts start with `$50` in free credits (no card required); enable pay-as-you-go billing before production so multi-hour lecture jobs never fail mid-term.

7. **Google Cloud Platform (Sign-In + Drive/Docs/Slides)**
   - See dedicated **Section 6** below.

8. **Stripe Billing**
   - See dedicated **Section 7** below.

9. **Datadog (`us5.datadoghq.com`)**
   - **Dashboard:** `https://us5.datadoghq.com` -> **Organization Settings -> API Keys** (API key only; no Application Key needed).
   - **Action:** Confirm the existing organization/Student Pack status, update local `.env.local` `DD_ENV` from `"production"` to `"development"` (so local errors don't pollute prod alerts), and update `DD_SERVICE` once finalized (`"zenote"` or `"notes-platform"`). Verify one deliberate log arrives under Logs Explorer (`service:notes-platform`) in staging.

10. **Web3Forms**
    - **Dashboard:** `https://web3forms.com` -> Access key management / notification email verification.
    - **Action:** Confirm which maintainer inbox receives submissions for `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY`. Free tier covers standard contact forms without payment activation.

11. **Hosting Platform (Web App + Persistent Worker)**
    - Repo includes Azure Container Apps IaC ([`infra/azure/main.bicep`](../infra/azure/main.bicep)) and multi-stage [`Dockerfile`](../Dockerfile) (`migrator`, `web`, `worker`); see **Section 9** and [`docs/DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md) for Azure Container Apps, Railway, and Render deployment topologies.

---

## 6. Google Cloud Setup Checklist

Zenote intentionally separates NextAuth Login OAuth (`src/lib/auth.ts`) from Connected Accounts Drive/Docs/Slides OAuth (`src/lib/services/google-oauth.ts`). Complete every item below in [Google Cloud Console](https://console.cloud.google.com):

- [ ] **1. Enable Required APIs** (`APIs & Services -> Library`):
  - [ ] **Google Drive API**
  - [ ] **Google Docs API**
  - [ ] **Google Slides API**
  - [ ] *(Optional for Google Login profile)* **Google People API** / standard OIDC `userinfo`
- [ ] **2. Configure OAuth Consent Screen** (`Google Auth Platform -> Branding / Audience`):
  - [ ] Application name (`Zenote`), support email, developer contact email, authorized domains (e.g. staging domain + `zenote.app`), privacy policy URL, terms URL.
  - [ ] Register **Drive/Docs/Slides Scopes** (`GOOGLE_DRIVE_SCOPES` in `src/lib/services/google-oauth.ts:36-44`):
    - `https://www.googleapis.com/auth/drive.readonly` (**Restricted**)
    - `https://www.googleapis.com/auth/drive.file` (Non-sensitive)
    - `https://www.googleapis.com/auth/documents.readonly` (**Restricted**)
    - `https://www.googleapis.com/auth/documents` (**Restricted**)
    - `https://www.googleapis.com/auth/presentations.readonly` (**Sensitive/Restricted**)
    - `https://www.googleapis.com/auth/userinfo.email` & `openid`
- [ ] **3. Provision Separate / Verified OAuth Clients** (`Clients`):
  - [ ] Replace placeholder `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` (Sign-In client) OR reuse the real Drive OAuth client temporarily in dev/staging.
  - [ ] Confirm existing `GOOGLE_DRIVE_CLIENT_ID` belongs to the active GCP project and still works.
- [ ] **4. Register Exact Authorized Redirect URIs** for **each** environment (`local`, `staging`, `production`):
  - NextAuth Login callback:
    - Local: `http://127.0.0.1:3000/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` if used)
    - Staging: `https://<staging-domain>/api/auth/callback/google`
    - Prod: `https://<prod-domain>/api/auth/callback/google`
  - Connected Accounts callback:
    - Local: `http://127.0.0.1:3000/api/integrations/google/callback`
    - Staging: `https://<staging-domain>/api/integrations/google/callback`
    - Prod: `https://<prod-domain>/api/integrations/google/callback`
- [ ] **5. Testing Mode vs. Production & CASA Audit Decision (`CRITICAL`)**:
  - **Testing Mode Limitation:** Refresh tokens issued in "Testing" publishing status **expire after 7 days** (`invalid_grant` -> `RECONNECT_REQUIRED`), and max external test users = **100**. Add dedicated QA Google test accounts to **Test Users** in Staging.
  - **Production Launch Gate:** Publishing `drive.readonly` + `documents` to external production users triggers **Google Restricted Scope Verification** plus an annual third-party **CASA Tier 2 security assessment** (typically **4–8 weeks** and **\$500–\$4,500+ USD/year** depending on assessor/scope). *Architectural alternative to evaluate in Phase 16/17:* narrowing imports to **Google Picker + `drive.file`** avoids restricted-scope CASA audits entirely if read-all-Drive listing isn't required.
- [ ] **6. Configure Live Verification Fixtures (`LIM-17` Exit Criteria)**:
  - [ ] Provision one dedicated **non-personal** QA Google account.
  - [ ] Create disposable test Drive folder/files: 1 Google Doc, 1 Google Slides deck with speaker notes, 1 PDF.
  - [ ] Set `GOOGLE_DRIVE_WEBHOOK_URL="https://<staging-domain>/api/integrations/google/webhook"` and dedicated `GOOGLE_WEBHOOK_SECRET` in staging.

---

## 7. Stripe Preparation Checklist

> **Phase Gate Guardrail:** Do **not** create live production Stripe Products/Prices or charge live cards before **Phase 17** finalizes Zenote's pricing tiers. Current tiers in `src/lib/plans.ts` (`STUDENT` $9, `PRO` $19, `TEAM` $49, `INSTITUTION` $199) are provisional defaults.

1. **Test Mode Provisioning (Allowed for Phase 16 Staging Verification):**
   - Create a Stripe account (no live business activation needed just to use **Test Mode**).
   - Switch Dashboard toggle to **Test Mode** -> **Developers -> API keys** -> copy Secret Key (`sk_test_...`) as `STRIPE_SECRET_KEY`.
   - Under **Product Catalog (Test Mode)**, create 4 test products matching Zenote's provisional `PlanTier` enum (`STUDENT`, `PRO`, `TEAM`, `INSTITUTION`) and map their `price_...` IDs to `STRIPE_PRICE_ID_STUDENT`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_TEAM`, `STRIPE_PRICE_ID_INSTITUTION`.
   - Configure **Settings -> Billing -> Customer Portal** in Test Mode (otherwise `/api/billing/portal` throws `StripeApiError` when Stripe rejects unconfigured portal settings!).
2. **Webhook Endpoint Setup (`Developers -> Webhooks`):**
   - Endpoint URL: `https://<staging-or-prod-domain>/api/billing/webhook`
   - Select **exact 6 events** implemented in `src/lib/billing/stripe.ts:533-680`:
     1. `checkout.session.completed`
     2. `customer.subscription.created`
     3. `customer.subscription.updated`
     4. `customer.subscription.deleted`
     5. `invoice.payment_succeeded`
     6. `invoice.payment_failed`
   - Copy Signing Secret (`whsec_...`) -> `STRIPE_WEBHOOK_SECRET`. (For local CLI webhook testing, `stripe listen --forward-to http://127.0.0.1:3000/api/billing/webhook` provides a local `whsec_...`).
3. **Production Activation (Phase 17 / Pre-Launch):**
   - Complete Stripe KYC/business verification + tax settings (`Stripe Tax` optional).
   - Switch to **Live Mode**, create final approved prices, update `STRIPE_SECRET_KEY` (`sk_live_...`), live `whsec_...`, and live `STRIPE_PRICE_ID_*`.
   - Same-origin redirect validation on optional `successUrl`/`cancelUrl`/`returnUrl` in `checkout/route.ts` and `portal/route.ts` (`LIM-20(4)(c)`) is **Closed in Stage B** (`src/lib/billing/redirect-origin.ts`).

---

## 8. Database, Redis & Storage Readiness

### 8.1 PostgreSQL & `pgvector`
- **`pgvector` Requirement:** `20260823142337_initial_schema` executes `CREATE EXTENSION IF NOT EXISTS "vector";` and Phases 1/12 create `vector(1536)` + HNSW/GIN indexes. Target instances must run PostgreSQL 15+ with `pgvector` pre-installed (Neon, Supabase, and RDS Postgres >= 15 support this).
- **Pooled vs. Direct Connection (`prisma migrate deploy`):** Neon `-pooler` URLs run PgBouncer in transaction mode. While `pg_advisory_xact_lock` is transaction-scoped (safe with PgBouncer transaction pooling), schema migrations (`npx prisma migrate deploy`) should use a **direct (non-pooler) `DATABASE_URL` during release jobs** or declare `directUrl = env("DIRECT_URL")` in `prisma/schema.prisma` before scaling.
- **Zero-Downtime Index Advisory (`LIM-09`):** `20261110090000_phase12_search_indexing` creates HNSW & GIN indexes synchronously (`SHARE` lock). On empty/fresh staging/production DBs this finishes in milliseconds; only avoid re-running standard `CREATE INDEX` migrations on already multi-million-row tables.
- **Unmigrated Dev DB (`/neondb`):** Shared `/neondb` is currently at Phase 12 schema and missing Phase 13–15 migrations (`FlashcardReview` FSRS columns, `ConnectedAccount` watch columns, `ProcessingJob` retry columns, `BillingWebhookEvent`). Keep `/neondb` frozen/backup-only or explicitly create clean Staging/Production Neon branches from scratch using `prisma migrate deploy`.

### 8.2 Upstash Redis & BullMQ
- **Dual Protocol Usage:**
  - HTTP REST (`@upstash/redis`): `rateLimit()` on auth, client-errors, webhooks, AI routes; `/api/health` runs a `PING`. Zero persistent sockets; 1,000 ms timeout + 10 s outage cooldown to degrade cleanly to in-memory (`rate-limit.ts`).
  - TLS TCP `:6379` (`ioredis` via `rediss://`): BullMQ `Queue` (producer) and `Worker` (`npm run worker`).
- **Command Budget & Connection Resilience (`LIM-19` & `LIM-20(2)`):**
  - Upstash Free Tier allows **500,000 commands/month** (formerly 10k/day). Idle settings (`stalledInterval: 60_000`, `drainDelay: 30`) prevent idle exhaustion in staging.
  - **Hardened in Stage A (`LIM-20(2)`):** `createBullMqRedisConnection` enforces strict TLS certificate verification (`rejectUnauthorized: true`) and infinite capped exponential backoff + jitter (unless `maxReconnectAttempts` is specified), `dispatcher.ts` replaces the permanent `sharedQueueInitFailed` latch with a `15_000 ms` `QUEUE_INIT_RETRY_COOLDOWN_MS` recovery window, and `zenote-worker` exposes `/live` + `/health` endpoints (`WORKER_HEALTH_PORT=3001`) for container probes.

### 8.3 Cloudflare R2 & CSP Alignment
- **Presigned Direct-to-R2 Uploads:** Browser uploads `PUT` directly to R2 (`storage-s3.ts:107`), requiring **bucket CORS** (`PUT`, `GET`, `HEAD`, `POST`) matching your exact frontend origins (`https://<staging>`, `https://<prod>`).
- **Audio & PDF Byte-Range Seeking:** `/api/storage/read` streams `Range` headers via `getObjectRange()` efficiently without buffering full multi-hundred-MB files in Node RAM.
- **Dynamic `STORAGE_ENDPOINT` CSP Alignment *(Closed in Stage A)*:** `next.config.js` dynamically resolves the origin from build-time `STORAGE_ENDPOINT` (with optional `CSP_EXTRA_CONNECT_SRC`) into `Content-Security-Policy` `connect-src`, falling back to `https://f03d7c364f5dd204ce76f719835c5c28.r2.cloudflarestorage.com` when unset. Ensure `STORAGE_ENDPOINT` is supplied as a Docker `--build-arg` / build env during release builds (`Dockerfile`).
- **Backup Consistency:** R2 has no application-level sync back from DB restores. Enable Cloudflare R2 object versioning / lifecycle rules and align DB Point-in-Time Recovery (PITR) windows with bucket snapshots.

---

## 9. Hosting & Deployment Recommendation (App + Persistent Worker)

### Workload Reality Check from Codebase
1. **Next.js Web Process (`npm run start`):**
   - Dynamic App Router SSR + API routes (`next.config.js` externalizes `bullmq` and `ioredis`).
   - Holds **long-lived Server-Sent Events (SSE) streams** (`GET /api/processing-jobs/stream` and `[jobId]/stream`) that poll PostgreSQL every `2,500ms` with `15,000ms` keepalive pings until jobs reach terminal status.
   - Serverless platforms (Vercel Hobby = 10s–60s function cap, Pro = 300s default maxDuration) truncate long SSE streams and risk cutting off synchronous fallback extraction/chat calls.
2. **Standalone Persistent Worker (`npm run worker` -> `tsx src/workers/index.ts`):**
   - Runs continuous BullMQ `Worker` pulling `DOCUMENT_EXTRACTION`, `EMBEDDING`, `TRANSCRIPTION` (AssemblyAI polling up to 20 min), `AI_NOTE_GENERATION` (Gemini up to 180 s), and `GOOGLE_SYNC` (Drive Changes API pagination).
   - Runs **mandatory background interval timers**: stranded job reconciliation every **5 min**, Google Drive watch-channel renewal every **6 hours**, and 30-day job pruning every **24 hours**.
   - **Cannot run on purely serverless functions** (Vercel/Cloudflare Workers) without converting timers to external crons and refactoring long jobs.

### Hosting Comparison Matrix

| Option | Architecture | Monthly Base Cost (Verified Pricing) | BullMQ Worker Support | SSE & Long HTTP Support | Operational Complexity | Verdict |
|---|---|---|---|---|---|---|
| **Option A1: Railway (Dual Service)** | Web Container (`next start`) + Worker Container (`npm run worker`) in one Railway project | **$5/mo minimum** (usage-based CPU/RAMcredits; ~$10–$20/mo realistic for always-on web + worker) | Native long-lived container, shared env group, private networking | Native unlimited HTTP/SSE | Low (auto Docker/Nixpacks build from GitHub) | **TOP RECOMMENDED** for Phase 16 Staging & Initial Launch |
| **Option A2: Render (Web Service + Background Worker)** | Web Service (`Starter $7/mo`) + Background Worker (`Starter $7/mo`) | **~$14/mo fixed** (`$7` web + `$7` worker; Free web tier sleeps after 15m and lacks free workers) | First-class explicit Background Worker service type | Native unlimited HTTP/SSE | Very Low (`render.yaml` IaC, zero surprise bills) | **RECOMMENDED** if fixed predictable billing is preferred |
| **Option B: Vercel + Railway/Render Worker** | Web on Vercel (`Hobby $0` dev / `Pro $20/mo` prod) + Worker on Railway (`$5/mo`) or Render (`$7/mo`) | **$5–$7/mo** (with Hobby — non-commercial!) or **$25–$27/mo** (with Vercel Pro) | Worker hosted separately; set `BULLMQ_DEDICATED_WORKER="true"` on Vercel | SSE streams hit Vercel serverless timeout (60s–300s), falling back to client `3s` HTTP polling | Medium (2 dashboards, synced env vars across platforms) | **Viable Alternative** (uses Phase 15 polling fallback, wastes SSE zero-latency benefit) |
| **Option C: Fly.io / AWS ECS (Fargate)** | Dockerized Web + Worker microVMs or ECS tasks + ALB | ~$6–$15/mo (Fly.io) / ~$25–$45+/mo (AWS ECS + NAT/ALB) | Native containers | Native | Medium–High (Dockerfile + VPC + ALB/TLS management) | Defer unless enterprise compliance / custom scaling demands it |

### Critical Split-Process Flag & Health Probe Behavior (`LIM-20`)
When deploying separate Web and Worker services (Option A1, A2, or B):
1. Set **`BULLMQ_DEDICATED_WORKER="true"`** on the **Web** service so API routes enqueue into Upstash Redis via BullMQ **without** running heavy PDF/audio work inside the web container.
2. Leave `BULLMQ_DEDICATED_WORKER` unset (`false`) on the **Worker** service (`npm run worker`), and tune `BULLMQ_WORKER_CONCURRENCY` (default `3`, recommend `2` on 512 MB–1 GB starter RAM to stay safe during large PDF extraction).
3. Expect `GET /api/health` on the **Web** container to return `queue: { mode: "bullmq", workerActive: false, counts: {...} }` (`LIM-20` §2 — `workerActive` is process-local). Configure Railway/Render health checks to hit `/api/health` on HTTP status (`200` vs `503`), **not** `workerActive === true`.
4. Beware in-memory fallback hazards: `DocumentExtractionScheduler` concurrency semaphores (`src/lib/document-extraction-scheduler.ts`) and SSE `emitProcessingJobEvent` (`LIM-19`) are per-process — running a single Worker instance (scaled vertically to 1–2 GB RAM first) avoids split SSE polling delays and keeps `2,500ms` cross-process PostgreSQL SSE sync fast and deterministic.

---

## 10. Environment Separation Matrix

**Current Local Anti-Pattern Warning:** `.env.local` currently mixes local runtime (`NEXTAUTH_URL=http://127.0.0.1:3000`, `NODE_ENV=development`) with prod-named infrastructure (`DATABASE_URL=.../neondb`, `STORAGE_BUCKET=notes-platform-prod`, `DD_ENV=production`). Establish strict isolation across 4 environments before Phase 16:

| Resource / Variable | 1. Local Development | 2. Automated Integration Tests | 3. Staging (Phase 16) | 4. Production (Phase 17+) |
|---|---|---|---|---|
| **PostgreSQL (`DATABASE_URL`)** | Local Docker PG 16/18 + `pgvector` OR Neon `dev` branch | `ISOLATED_TEST_DATABASE_URL` (`zenote_phase13_test` local PG 18.6; **never `/neondb`**) | Dedicated Neon `staging` branch (+ `DIRECT_URL` / direct string for migrate) | Dedicated Neon `main`/`prod` project on **Launch** paid plan with PITR + `DIRECT_URL` |
| **Redis (`UPSTASH_*` / `BULLMQ_*`)** | Local Redis or `zenote-dev` Upstash DB (`BULLMQ_ENABLED="false"` optional) | Hermetic unit tests disabled (`VITEST` check); opt-in `ENABLE_LIVE_BULLMQ_TESTS="true"` on dev/test Upstash DB | Dedicated `zenote-staging` Upstash Redis DB | Dedicated `zenote-prod` Upstash Redis DB (same region as Railway/Render; PAYG/Fixed plan) |
| **Object Storage (`STORAGE_*`)** | `"local"` (`./.storage`) OR dev R2 bucket `zenote-dev` | `"local"` (temp mocked keys) | Dedicated R2 bucket `zenote-staging` (CORS = staging domain) | R2 bucket `zenote-prod` (`notes-platform-prod`, versioning enabled, CORS = `https://zenote.app`) |
| **Origin (`NEXTAUTH_URL`, `NEXT_PUBLIC_SITE_URL`)** | `http://127.0.0.1:3000` | N/A | `https://staging.<domain>` | `https://<confirmed-domain>` (e.g. `https://zenote.app`) |
| **Google OAuth (`GOOGLE_*`)** | Separate **Dev** OAuth client (Testing mode) | Mocked | **Staging** OAuth client (Testing mode + QA Test Account) | **Production** Verified OAuth client (or narrowed `drive.file` scopes) |
| **Drive Webhook (`GOOGLE_DRIVE_WEBHOOK_URL`)** | Unset (manual sync works; optional ngrok for ad-hoc test) | Mocked | `https://staging.<domain>/api/integrations/google/webhook` | `https://<prod-domain>/api/integrations/google/webhook` |
| **Secrets (`NEXTAUTH_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_WEBHOOK_SECRET`)** | Unique local random 32B values | Test secrets | Unique staging random 32B values | Independent high-entropy 32B+ values managed in PaaS secret vault |
| **AI & STT Keys (`GOOGLE_AI_API_KEY`, `OPENAI_API_KEY`, `ASSEMBLYAI_API_KEY`)** | Free/low-cap dev keys | Mocked | Dev/Staging API keys with hard monthly spend caps | Paid tier / billed keys with usage alerts & spend caps |
| **Stripe (`STRIPE_*`)** | Unset or Stripe CLI (`whsec_...`) + `sk_test_...` | Mocked + isolated PG persistence test | **Stripe Test Mode** (`sk_test_...`, test `price_...`, test `whsec_...`) | **Stripe Live Mode** (`sk_live_...`, Phase 17 final `price_...`, live `whsec_...`) |
| **Datadog (`DD_*`)** | Unset (`DD_API_KEY=""`) or `DD_ENV="development"` | Unset | `DD_ENV="staging"`, `DD_SERVICE="zenote"`, `DD_VERSION=<git_sha>` | `DD_ENV="production"`, `DD_SERVICE="zenote"`, `DD_VERSION=<git_sha>` |
| **Worker Mode (`BULLMQ_DEDICATED_WORKER`)** | Unset (in-process dev execution) | N/A | `"true"` on Web service; unset on Worker service | `"true"` on Web service; unset on Worker service |

---

## 11. Estimated Infrastructure Cost Breakdown

### A. Verified Published Provider Pricing (November 2026)

| Service / Provider | Verified Free Tier Allowance | Verified Paid Unit Pricing (Post-Free-Tier) |
|---|---|---|
| **Neon PostgreSQL** | `100 CU-hours/mo` (scale-to-zero after 5m, max 2 CU), `1 GB` storage/project, `5 GB` egress, 6h restore window | **Launch/Scale PAYG:** `\$0.106 / CU-hour`, `\$0.35 / GB-month` storage, no monthly minimum |
| **Upstash Redis** | `500,000 commands/month`, `256 MB` storage, `10 GB/mo` bandwidth | **PAYG:** `\$0.20 / 100k commands` \| **Fixed:** from `\$10/mo` |
| **Cloudflare R2** | `10 GB/mo` storage, `1M` Class A ops, `10M` Class B ops, **unlimited free egress** | `\$0.015 / GB-mo` storage, `\$4.50 / 1M` Class A, `\$0.36 / 1M` Class B, `\$0` egress |
| **Railway Hosting** | Trial only (expired post-trial) | Usage-based starting at **`\$5/mo` minimum** (includes `$5` usage credit; pay per vCPU-sec + GB RAM-sec) |
| **Render Hosting** | Web Free Tier sleeps (unusable for webhooks/SSE); **no free background worker** | **`\$7/mo` Starter Web** + **`\$7/mo` Starter Background Worker** (`\$14/mo` predictable minimum) |
| **Google Gemini (`gemini-2.5-flash-lite`)** | Free Tier (~`5–15 RPM`, `500–1,500 RPD`; no card required; prompts may be used by Google) | **`\$0.10 / 1M` input tokens**, **`\$0.40 / 1M` output tokens** |
| **OpenAI Embeddings (`text-embedding-3-small`)** | No ongoing free tier (requires prepaid credit) | **`\$0.02 / 1M` input tokens** (`\$0.01/1M` Batch API); `$0` output charge |
| **AssemblyAI (`Universal-2` + Diarization)** | **`\$50` one-time starter credit** (no card required, per-second billing) | **`~\$0.15/hr` base** + **`+\$0.02/hr` speaker diarization** = **`~\$0.17/hour` (~`$0.0028/min`)** |
| **Datadog (`Logs` + `Metrics`)** | GitHub Student Developer Pack (Pro tier promo if active); else trial | Logs: **`\$0.10/GB` ingested** + **`\$1.70/1M` events indexed** (15d annual); infra/custom metrics per plan |
| **Stripe Billing** | No monthly fee in Test or standard Live mode | **`2.9% + \$0.30`** per successful US card charge (`+0.5%–1.5%` int'l, `+1%–2%` FX, optional Stripe Billing % fee if enabled — standard Checkout fee is card rate + Billing tier if applicable) |
| **Google OAuth Restricted Scope Audit (`CASA Tier 2`)** | `$0` in Testing mode (<= 100 users, 7d refresh expiry) or non-restricted `drive.file` scope | **Four-figure annual lab fee** (e.g., `~\$540–\$4,500+/yr`) **ONLY if** publishing `drive.readonly` + `documents` to external production users |

### B. Illustrative Monthly Spend Scenarios *(Assumptions Clearly Separated)*

| Scenario | Traffic & Usage Assumptions | Fixed Compute/Infra | Variable AI / STT / Storage Usage | Estimated Monthly Total |
|---|---|---|---|---|
| **1. Local Dev & Pre-Phase 16 Testing** | Single developer; QA via isolated local PG; Gemini free tier; `$5` OpenAI prepaid test balance; AssemblyAI `$50` starter credit | `\$0` (Neon/Upstash/R2 Free Tiers) | `~\$0–\$1` (`\$5` one-time OpenAI deposit) | **~\$0–\$5/mo** *(one-time `$5` OpenAI minimum)* |
| **2. Phase 16 Staging + Private Beta (<= 50 Test Users)** | Always-on Web + Worker on Render (`2 × \$7`) or Railway (`~\$10–\$15`); Neon Free (`<= 1 GB`); Upstash Free (`<= 500k cmds`); R2 Free (`<= 10 GB`); Google Testing Mode | `\$10–\$14/mo` | `~\$1–\$5/mo` (small Gemini paid usage + embeddings; AssemblyAI covered by `$50` credit) | **~\$11–\$20/mo** |
| **3. Early Production Launch (100 MAU)** | Avg 4 hrs audio/user/mo (`400 hrs`), 500 PDFs/notes (`~50M` Gemini input / `5M` output tokens, `~20M` embed tokens), `25 GB` R2, Neon Launch (`~0.5–1 CU active`), Upstash Pro/Fixed | `\$14–\$25` hosting + `\$15–\$30` Neon + `\$10` Upstash | AssemblyAI `400h × \$0.17 = \$68` + Gemini `\$7` + OpenAI `\$0.40` + R2 `\$0.25` | **~\$115–\$145/mo** *(before Stripe fees & before optional CASA Tier-2 audit)* |
| **4. Growth Scale (1,000 MAU)** | Avg 3 hrs audio/user/mo (`3,000 hrs`), scaled 2–4 GB containers (`\$50–\$80`), Neon `~50 GB` + higher CU (`\$60–\$100`), Upstash Fixed (`\$10–\$30`), `250 GB` R2 (`\$3.60`) | `\$120–\$210/mo` | AssemblyAI `3,000h × \$0.17 = \$510` + Gemini `~\$60–\$80` + OpenAI `~\$4` + Datadog `~\$20–\$50` | **~\$715–\$860/mo** *(Audio STT dominates variable COGS — align Phase 17 tier limits carefully!)* |

> **Unit-Economics Takeaway for Phase 17:** A `PRO` user using their full `1,200`–`3,000` recording minutes/month (`src/lib/plans.ts` vs `stripe.ts` show `1,200` in display copy vs `3,000` in `PLAN_LIMITS`) costs **\$3.40–\$8.50/mo in AssemblyAI fees alone** (50 hrs × `$0.17` = `$8.50`), whereas `INSTITUTION` (`60,000` min = 1,000 hrs) would cost **\$170/mo in raw STT COGS** if fully utilized. Reconcile `PLAN_LIMITS` (`src/lib/plans.ts`) and `PLAN_DISPLAY_PRICING` (`src/lib/billing/stripe.ts`) in Phase 17!

---

## 12. Security & Secret Management Recommendations

1. **Decouple Cryptography Secrets Before Production:** Set dedicated 32-byte random hex secrets for **`GOOGLE_TOKEN_ENCRYPTION_KEY`** (independent of `NEXTAUTH_SECRET` so JWT key rotation doesn't brick every user's encrypted `ConnectedAccount` tokens per `docs/production-readiness.md`) and **`GOOGLE_WEBHOOK_SECRET`** (so Drive webhook channel HMAC verification doesn't fall back to `NEXTAUTH_SECRET` or the dev fallback).
2. **Never Track `.env*` & Use Platform Secret Managers:** Keep `.env` and `.env.local` gitignored cleanly. Inject staging/production secrets exclusively via Railway/Render/Vercel encrypted environment groups — never bake secrets into Docker images or build arguments (except intentionally public `NEXT_PUBLIC_*` build vars).
3. **Dynamic `STORAGE_ENDPOINT` CSP Origin (`Closed in Stage A`):** `next.config.js` derives `connect-src` from build-time `process.env.STORAGE_ENDPOINT` (plus `CSP_EXTRA_CONNECT_SRC`) rather than hardcoding a single account hash. Supply `STORAGE_ENDPOINT` at Docker build time (`Dockerfile` `--build-arg`).
4. **Same-Origin Stripe Checkout/Portal Redirects (`Closed in Stage B`, `LIM-20(4)(c)`):** `assertSameOriginRedirectUrl()` (`src/lib/billing/redirect-origin.ts`) validates caller-supplied `successUrl`/`cancelUrl`/`returnUrl` against canonical configured origin (`NEXTAUTH_URL` / `SITE_URL` / `NEXT_PUBLIC_SITE_URL`) and `ALLOWED_REDIRECT_ORIGINS`, blocking off-origin/protocol-relative redirects with HTTP `400 INVALID_REDIRECT_ORIGIN`.
5. **Fix Local `.env.local` Hygiene Early:** Change local `.env.local` `DD_ENV` from `"production"` to `"development"` (or blank out `DD_API_KEY` locally) so local test failures never trigger production Datadog alerts.
6. **Plan Transactional Email Service Before User-Facing Launch:** Add an email abstraction (e.g., Resend or Postmark over HTTPS API) for password resets, email verification, and study group invitation delivery once Phase 16+ user flows expand beyond in-app tokens.
7. **Quarterly Secret Rotation & Least-Privilege Scoping:** Scope Cloudflare R2 API tokens to exact single buckets (`zenote-staging` vs `notes-platform-prod`); restrict Stripe keys and Datadog API keys (no Application keys needed); avoid sharing OpenAI/Gemini/AssemblyAI keys between Staging and Production.

---

## 13. Outstanding Technical & Operational Limitations (`LIM-17`..`LIM-20`)

| ID | Summary of Verified Boundary | Operational / Staging Impact |
|---|---|---|
| **`LIM-17`** | **Live Google Drive/Docs/Slides & HTTPS Webhook Delivery Blocked Locally** | All 15 Google Vitest suites (`126/126`: 14 Phase 14 suites = 109 + `google-errors.test.ts` = 17) pass mocked, and DB schema works in `zenote_phase13_test`, but live Google API calls & webhook push delivery cannot run until a dedicated test Google OAuth grant + public `https://` `GOOGLE_DRIVE_WEBHOOK_URL` are provisioned in Staging. Also, Google Docs sync is event-driven block mapping rather than live CRDT. |
| **`LIM-18`** | **Closed in Phase 15** | Stranded `ProcessingJob` reconciliation (`reconcileStrandedProcessingJobs`), crash-safe pre-`batchUpdate` `EXPORTING` checkpoint in PostgreSQL (`google-note-sync.ts`), and 6h scheduled `runScheduledWatchChannelRenewal()` are implemented & verified (residual edge cases tracked in `LIM-20`). |
| **`LIM-19`** | **Stripe Keys Missing (`503` Fail-Closed), Upstash Free Tier Budget & Cross-Instance SSE Polling** | Checkout/Portal APIs safely fail closed with HTTP `503` until `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID_*` are set. Cross-process standalone worker progress reaches browsers via `2,500ms` DB checks on `jobId`/`materialId` SSE streams (no persisted SSE replay history). |
| **`LIM-20`** | **Phase 15 Operational Edge Cases *(Partially Hardened in Stages A & B)*** | Stage A closed `(1)(c)` reconciler stale-job replacement + CAS and `(2)` Redis backoff / init cooldown / worker health probes (`WORKER_HEALTH_PORT=3001`, `/live`, `/health`) + scheduler lease renewal; Stage B closed `(4)(c)` optional Stripe redirect URL same-origin validation (`src/lib/billing/redirect-origin.ts`). Remaining open boundary records: `(1)(a)-(b)` domain runner error catch (`FAILED` without BullMQ retry) & `RUNNING` recovery after `staleAfterMs`, `(3)` best-effort pre-`batchUpdate` checkpoint & runtime-failed existing Drive material manual retry, and `(4)(a)-(b)` 1-second webhook timestamp granularity / `PAST_DUE` dunning grace. |

---

## 14. Exact Steps Required Before Phase 16

Before beginning **Phase 16 (Deployment / Staging Readiness / Pre-Launch Verification)**, complete these strictly bounded prerequisites:

### Mandatory Blockers for Phase 16 Staging
1. **Provision Real AI & Embedding Keys in Dev/Staging:** Obtain a valid **Google AI Studio key (`AIza...`)** and **OpenAI API key (`sk-...` with >= `$5` credit)**; update `AI_PROVIDER` from `"anthropic"` to **`"gemini"`**. *(Closes live `LIM-12` semantic search/note gen blockers).*
2. **Create Separate Neon Branches (`staging` + `prod` future) & Direct Connection Strings:** Stop pointing shared app configs solely at legacy `/neondb`; verify `vector` extension + apply all `13` migrations (`npx prisma migrate deploy`) cleanly onto the fresh Staging branch.
3. **Create Separate Staging Upstash Redis DB & Staging Cloudflare R2 Bucket (`zenote-staging`):** Avoid sharing production buckets or dev Redis queues with staging verification runs.
4. **Provision Dedicated Google Sign-In + Drive OAuth Setup for Staging:** Obtain real `GOOGLE_CLIENT_ID`/`SECRET` (or explicitly unify with Drive client if desired), add `{STAGING_URL}/api/auth/callback/google` and `{STAGING_URL}/api/integrations/google/callback` to Google Cloud Console, add QA test user email(s), and enable **Drive, Docs, and Slides APIs**.
5. **Provision Stripe Test Mode Credentials:** Obtain `sk_test_...`, test `whsec_...`, and test `price_...` IDs for `STUDENT`/`PRO`/`TEAM`/`INSTITUTION`, and enable Stripe Test Mode Customer Portal so Phase 16 staging billing tests pass without touching real money or premature Phase 17 pricing.
6. **Confirm Target Hosting Accounts & Domain Decision:** Select **Railway** or **Render** for dual-service (`web` + `worker`) staging deployment and establish a staging/production domain plan.

### Required for Resolving `LIM-17` Live Google Verification
7. Connect 1 dedicated QA Google test account containing a disposable test Google Doc, Google Slides deck (with notes), and PDF once Staging has a public `https://` `GOOGLE_DRIVE_WEBHOOK_URL`.

### Explicitly Deferred to Phase 17 / Pre-Launch
8. Final Stripe **Live Mode** `Price` creation (after business model/plan limits reconciliation between `src/lib/plans.ts` & `src/lib/billing/stripe.ts`), DNS cutover to confirmed production domain, Datadog Production Monitors, and Google OAuth Publishing Status / **CASA Tier-2 vs `drive.file` scope decision**.

---

## 15. Recommended Execution Order

Follow this exact sequence to bring infrastructure from current state to clean Phase 16 staging:

1. **Step 1 — Fix Local `.env.local` & AI/Embedding Keys (15 min):** Generate `GOOGLE_AI_API_KEY` (AI Studio) and `OPENAI_API_KEY` (`$5` credit), set `AI_PROVIDER="gemini"`, set `DD_ENV="development"`, verify `ASSEMBLYAI_API_KEY` & Cloudflare R2 credentials exist in vendor dashboards.
2. **Step 2 — Verify Google Cloud Console Project (20 min):** Confirm `Drive`, `Docs`, and `Slides` APIs are enabled; verify OAuth client(s), fix `GOOGLE_CLIENT_ID`/`SECRET` placeholders, and add QA Google test account(s) to OAuth Testing users.
3. **Step 3 — Provision Clean Staging Stores (20 min):** Create Neon `staging` branch (with `vector` extension), Upstash `zenote-staging` Redis DB, and Cloudflare R2 `zenote-staging` bucket + bucket-scoped API token + staging CORS policy.
4. **Step 4 — Configure Stripe Test Mode (15 min):** Create Test Mode products/prices (`STUDENT`/`PRO`/`TEAM`/`INSTITUTION`), copy `sk_test_...`, and configure Test Mode Customer Portal.
5. **Step 5 — Select Host & Deploy Phase 16 Dual-Service Staging (Phase 16):** Deploy Web (`next start` with `BULLMQ_DEDICATED_WORKER="true"`) + Worker (`npm run worker`) on **Railway** or **Render**; run `prisma migrate deploy` against Neon `staging`; register staging HTTPS redirect URIs, Google Drive webhook URL, and Stripe Test Mode webhook secret (`whsec_...`).
6. **Step 6 — Execute Live Integration Smoke Suite (Phase 16 Verification):** Verify `/api/health` (`ok`), presigned R2 upload/playback, Gemini note gen, OpenAI `1536d` semantic backfill (`LIM-12`), AssemblyAI transcription, live Google Drive webhook + Slides + Docs sync (`LIM-17`), Stripe Test Mode checkout/webhook/portal (`LIM-19`), and Datadog log ingestion.
7. **Step 7 — Prepare Phase 17 Production Launch Gate:** Finalize domain, pricing (`PLAN_LIMITS` vs `PLAN_DISPLAY_PRICING`), Live Stripe keys, transactional email service decision, and Google Restricted Scope CASA vs `drive.file` decision.

---

## 16. Deliverable B — Actionable Maintainer Credential Checklist

| Service / Provider | Exact Env Variable Name(s) | Current Status | Where to Obtain It (Exact Dashboard Path) | Free Tier Sufficient? | Payment Required? | Public Domain Required? | Where Configured | Timing |
|---|---|---|---|---|---|---|---|---|
| **Neon PostgreSQL (Staging & Prod DB)** | `DATABASE_URL` *(+ recommend `DIRECT_URL`)* | `PRESENT — UNVERIFIED` *(Dev `/neondb` stale)* | `console.neon.tech` -> Project -> Branches -> **Connect** (`Pooled` + `Direct`) | Yes (Dev/Staging <= 1 GB); **No for Prod** (Launch PAYG) | No (Staging) / Yes (Prod Launch) | No | Hosting Platform Secrets + CI deploy step | **Before Phase 16** |
| **NextAuth Core** | `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | `PRESENT — UNVERIFIED` (`NEXTAUTH_URL` dev-only) | Generate via `openssl rand -base64 32`; URL from staging/prod host | N/A (Local secret) | No | Yes (for Staging/Prod HTTPS URL) | `.env.local` + Hosting Secrets (Web) | **Before Phase 16** |
| **Google Cloud — Login OAuth** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `MISSING` *(placeholders in `.env.local`)* | `console.cloud.google.com` -> **Google Auth Platform -> Clients** (Web App) | Yes (100 test users in Testing) | Only if CASA audit triggered later | Yes (HTTPS callback in Staging/Prod) | `.env.local` + Hosting Secrets + Google Console URIs | **Before Phase 16** |
| **Google Cloud — Drive / Docs / Slides OAuth** | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` | `PRESENT — UNVERIFIED` *(Live blocked per `LIM-17`)* | `console.cloud.google.com` -> **Google Auth Platform -> Clients** + Enable Drive/Docs/Slides APIs | Testing Mode free (7d refresh limit) | **Possible (`CASA Tier 2`) for Public Prod** unless scoped down | Yes (HTTPS callback for Staging/Prod) | `.env.local` + Hosting Secrets (Web + Worker) | **Verify Before Phase 16** / **CASA in Phase 17** |
| **Google Token & Webhook Security** | `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_WEBHOOK_SECRET`, `GOOGLE_DRIVE_WEBHOOK_URL` | `MISSING` *(safe dev fallbacks)* | Generate two `openssl rand -hex 32` keys; Webhook URL = `https://<domain>/api/integrations/google/webhook` | N/A | No | Yes (`GOOGLE_DRIVE_WEBHOOK_URL` must be HTTPS) | Hosting Secrets (Web + Worker) | **During Phase 16 Staging** |
| **Google Gemini API (`gemini-2.5-flash-lite`)** | `AI_PROVIDER="gemini"`, `GOOGLE_AI_API_KEY` | `MISSING` *(wrong provider + placeholder key)* | `aistudio.google.com/apikey` -> **Create API Key** | Yes (Dev/QA); **No for Prod** (Tier 1 billing removes prompt training & raises RPM) | No (Dev/QA) / Yes (Prod Cloud Billing) | No | `.env.local` + Hosting Secrets (Web + Worker) | **Before Phase 16** |
| **OpenAI API (`text-embedding-3-small`)** | `EMBEDDING_PROVIDER="openai"`, `OPENAI_API_KEY` | `MISSING` *(placeholder key in `.env.local`)* | `platform.openai.com/api-keys` + Billing (`Add credit`) | **No** (prepaid credit needed; `~\$0.02/1M` tokens is tiny) | **Yes (`\$5` min credit)** | No | `.env.local` + Hosting Secrets (Web + Worker) | **Before Phase 16** |
| **AssemblyAI (`Universal-2` STT)** | `SPEECH_PROVIDER="assemblyai"`, `ASSEMBLYAI_API_KEY` | `PRESENT — UNVERIFIED` | `assemblyai.com/app` -> Dashboard API Key + Billing | Yes (`\$50` starter credit for Dev/Staging) | **Yes before Prod** (`\$0.17/hr` w/ diarization) | No | `.env.local` + Hosting Secrets (Web + Worker) | **Verify Before Phase 16** |
| **Upstash Redis (Rate Limit + BullMQ)** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | `VERIFIED` *(Dev TCP)* / Need Staging DB | `console.upstash.com` -> Redis -> **REST API Details** | Yes (`500k cmds/mo` Staging); Upgrade to Fixed/PAYG at traffic growth | No (Staging) / Yes (Prod scale) | No | `.env.local` + Hosting Secrets (Web + Worker) | **Create Staging DB Before Phase 16** |
| **Worker Queue Controls** | `BULLMQ_DEDICATED_WORKER`, `BULLMQ_WORKER_CONCURRENCY`, `BULLMQ_QUEUE_NAME` | `NOT YET REQUIRED` *(Prod Hosting Vars)* | Hosting env vars (`"true"` on Web service; unset on Worker service) | N/A | No | No | Hosting Env (Web vs Worker separately) | **During Phase 16 Staging** |
| **Cloudflare R2 Object Storage** | `STORAGE_PROVIDER="s3"`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION="auto"`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | `PRESENT — UNVERIFIED` *(Need Staging bucket)* | Cloudflare Dashboard -> **R2** -> Bucket Settings (CORS) + **Manage R2 API Tokens** | Yes (`10 GB` + `0` egress free; Staging & tiny MVP) | Card on file may be required by R2 / to exceed 10 GB | CORS requires exact app origins (`http://` dev / `https://` prod) | `.env.local` + Hosting Secrets + R2 CORS + `next.config.js` CSP | **Create Staging Bucket Before Phase 16** |
| **Stripe Billing (Test Mode -> Live Mode)** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_{STUDENT,PRO,TEAM,INSTITUTION}` | `MISSING` *(Live **`NOT YET REQUIRED`** until Phase 17)* | `dashboard.stripe.com` -> API Keys + Webhooks (`/api/billing/webhook`) + Product Catalog + Customer Portal | Yes (Test Mode & standard PAYG card fees) | Business verification required for **Live Mode** only | Yes (`https://.../api/billing/webhook` for live events) | Hosting Secrets (Web) | **Test Mode Before/In Phase 16** / **Live Mode in Phase 17** |
| **Datadog Observability** | `DD_API_KEY`, `DD_SITE`, `DD_ENV`, `DD_SERVICE`, `DD_VERSION` | `PRESENT — UNVERIFIED` | `us5.datadoghq.com` -> **Org Settings -> API Keys** | Trial / GitHub Student Pack (if active); paid usage after | Yes post-trial/pack | No | Hosting Secrets (`DD_ENV=staging`/`production`; fix local to `development`) | **Verify in Phase 16 Staging** |
| **Web3Forms Contact Form** | `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY` | `PRESENT — UNVERIFIED` | `web3forms.com` -> Access Key / Recipient Email | Yes | No | No | `.env.local` + Hosting Build/Env (Web) | **Verify in Phase 16 Staging** |
| **Public Site Identity & SEO** | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | `MISSING` | Verified custom domain DNS + Google Search Console (`HTML tag`) | N/A | Domain registrar fee | **Yes** | Hosting Build/Env (Web) + DNS | **Phase 17 / Production Launch** |
| **Hosting Platform (Web + Worker)** | Platform API / Deploy Project | `MISSING` | `railway.app` or `render.com` -> New Project (GitHub repo, 2 services) | **No** for always-on Web + Worker | **Yes** (`\$5–\$14/mo` card required) | Platform-provided `https://` for Staging; custom domain for Prod | Host Dashboard + DNS | **Phase 16 Staging** |

