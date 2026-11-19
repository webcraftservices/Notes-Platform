# Zenote — Production & Container Environment Specification (Stages A–D)

> **Scope:** Authoritative environment reference for local development, Docker Compose (`docker-compose.yml`), and separated `zenote-web` + `zenote-worker` + `zenote-migrator` Azure Container Apps deployments (`infra/azure/main.bicep`).  
> **Architectural Note:** Stage B preserves all existing AI/embedding/speech/storage/OAuth API-key modes while adding opt-in Azure Managed Identity + Google Workload Identity Federation (`vertex_wif`), Azure Key Vault secret resolution, Azure Monitor Application Insights (`APPLICATIONINSIGHTS_CONNECTION_STRING`), optional Redis Pub/Sub SSE scaling (`SSE_REDIS_PUBSUB_ENABLED`), and strict fail-closed cloud validation (`CLOUD_PRODUCTION_STRICT`).

---

## 1. Canonical Naming & Variable Rules

1. **Object Storage Keys (`src/lib/services/storage.ts`, `src/app/api/health/route.ts`):**
   - Always use **`STORAGE_PROVIDER`**, **`STORAGE_ENDPOINT`**, **`STORAGE_REGION`**, **`STORAGE_BUCKET`**, **`STORAGE_ACCESS_KEY_ID`**, **`STORAGE_SECRET_ACCESS_KEY`**, and **`STORAGE_LOCAL_DIR`**.
   - Never use deprecated draft names (`STORAGE_DRIVER`, `S3_*`).
2. **Client-Side Build Inlining (`NEXT_PUBLIC_*`):**
   - Variables prefixed with `NEXT_PUBLIC_` are inlined into browser bundles during `next build` (`Dockerfile` `builder` stage). Supply them as Docker `--build-arg` values when building release images.
   - **Never** prefix any secret (`DATABASE_URL`, `NEXTAUTH_SECRET`, API keys, tokens) with `NEXT_PUBLIC_`.
3. **Production Storage CSP Injection (`next.config.js`):**
   - `STORAGE_ENDPOINT` is read at build time by `next.config.js` to populate Content Security Policy `connect-src` so browser presigned `PUT`/`GET` requests to Cloudflare R2 / S3 succeed. When unset during build, `next.config.js` retains the default R2 origin fallback. Optional additional origins can be supplied via `CSP_EXTRA_CONNECT_SRC` (space-separated).

---

## 2. Variable Classification by Workload Role

### 2.1 Build-Time Arguments (`Dockerfile` `builder` Stage)

| Variable | Secret? | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | No | `https://zenote.app` | Canonical public URL for metadata, OpenGraph, sitemap, JSON-LD |
| `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY` | No (public form ID) | `""` | Contact form key on `/welcome/intro` |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | No | `""` | Optional Google Search Console verification tag |
| `NEXT_PUBLIC_ZENOTE_DOWNLOAD_URL` | No | `""` | Optional desktop/mobile download CTA URL |
| `STORAGE_ENDPOINT` | No | Unset (uses R2 fallback) | Injects object storage origin into `next.config.js` CSP `connect-src` |
| `CSP_EXTRA_CONNECT_SRC` | No | `""` | Optional space-separated extra CSP `connect-src` origins |

### 2.2 Web Container (`zenote-web`)

| Category | Variable | Secret? | Default / Prod Value | Notes |
|---|---|---|---|---|
| **Server Runtime** | `NODE_ENV` | No | `production` | Baked into `web` stage |
| | `PORT` | No | `3000` | Next.js standalone HTTP listen port |
| | `HOSTNAME` | No | `0.0.0.0` | Required for container ingress binding |
| | `LOG_FORMAT` | No | `json` | Structured JSON logs to stdout/stderr |
| **Database** | `DATABASE_URL` | **Yes** | Required | Neon / PostgreSQL + `pgvector` runtime connection string |
| **Auth & Security** | `NEXTAUTH_URL` | No | `https://<domain>` | Canonical origin for OAuth redirects & `Secure` cookies |
| | `NEXTAUTH_SECRET` | **Yes** | Required | NextAuth session signing & HMAC fallback |
| | `SITE_URL` | No | Falls back to `NEXTAUTH_URL` | Optional canonical metadata override |
| **Worker Separation** | `BULLMQ_ENABLED` | No | `true` (when Redis configured) | Keeps BullMQ producer queue active on web |
| | `BULLMQ_DEDICATED_WORKER` | No | `true` (baked in `web`) | Enqueues to Redis without falling back to web-process execution |
| | `BULLMQ_EMBEDDED_WORKER` | No | `false` (baked in `web`) | Prevents `zenote-web` from starting an embedded BullMQ Worker |
| | `BULLMQ_EMBEDDED_MAINTENANCE` | No | `false` (baked in `web`) | Disables web-process startup reconciliation & interval timers |
| | `BULLMQ_QUEUE_NAME` | No | `zenote-processing-jobs` | Must match `zenote-worker` |
| **Redis (REST + TCP/TLS)** | `UPSTASH_REDIS_REST_URL` | No | Required for rate limits | REST endpoint for rate limiting & `/api/health` |
| | `UPSTASH_REDIS_REST_TOKEN` | **Yes** | Required with REST URL | Also derives `rediss://default:<token>@<host>:6379` |
| | `BULLMQ_REDIS_URL` / `REDIS_URL` | **Yes** | Optional override | Explicit `redis://` or `rediss://` endpoint |
| | `UPSTASH_REDIS_TCP_PORT` | No | `6379` | Override port for Upstash TLS derivation |
| | `BULLMQ_DISABLE_UPSTASH_TCP` | No | `false` | Set `"true"` to keep REST rate limit while using local `REDIS_URL` |
| | `BULLMQ_REDIS_TLS_REJECT_UNAUTHORIZED` | No | `true` (strict) | Only `"false"` for local self-signed dev Redis |
| **Object Storage** | `STORAGE_PROVIDER` | No | `s3` in prod (`local` in compose) | Must be `s3` (Cloudflare R2 / S3) for multi-container prod |
| | `STORAGE_ENDPOINT` | No | R2 HTTPS endpoint | S3-compatible URL |
| | `STORAGE_REGION` | No | `auto` | R2 region or AWS region |
| | `STORAGE_BUCKET` | No | Required in `s3` mode | Target bucket name |
| | `STORAGE_ACCESS_KEY_ID` | **Yes** | Required in `s3` mode | S3 API access key |
| | `STORAGE_SECRET_ACCESS_KEY` | **Yes** | Required in `s3` mode | S3 API secret key |
| | `STORAGE_LOCAL_DIR` | No | `./.storage` | Used only when `STORAGE_PROVIDER=local` |
| **AI / Embeddings / STT** | `AI_PROVIDER` | No | `gemini` | Gemini structured synthesis & Socratic tutor |
| | `GOOGLE_AI_API_KEY` | **Yes** | Required for AI routes | Google Gemini API key |
| | `EMBEDDING_PROVIDER` | No | `openai` | `text-embedding-3-small` (`1536` dims) |
| | `OPENAI_API_KEY` | **Yes** | Required for semantic RAG/embeddings | Also used if `SPEECH_PROVIDER=openai` |
| | `SPEECH_PROVIDER` | No | `assemblyai` | `assemblyai` or `openai` |
| | `ASSEMBLYAI_API_KEY` | **Yes** | Required if `SPEECH_PROVIDER=assemblyai` | Speech-to-text + diarization |
| **Google OAuth & Drive** | `GOOGLE_CLIENT_ID` | No | Required for Google Sign-In | NextAuth `GoogleProvider` client ID |
| | `GOOGLE_CLIENT_SECRET` | **Yes** | Required for Google Sign-In | NextAuth `GoogleProvider` client secret |
| | `GOOGLE_DRIVE_CLIENT_ID` | No | Falls back to `GOOGLE_CLIENT_ID` | Drive/Docs/Slides Connected Accounts client |
| | `GOOGLE_DRIVE_CLIENT_SECRET` | **Yes** | Falls back to `GOOGLE_CLIENT_SECRET` | Connected Accounts client secret |
| | `GOOGLE_TOKEN_ENCRYPTION_KEY` | **Yes** | Falls back to `NEXTAUTH_SECRET` | Dedicated AES-256-GCM encryption key for OAuth tokens |
| | `GOOGLE_WEBHOOK_SECRET` | **Yes** | Required in `production` (falls back to enc/NextAuth secret if set, fails closed if all 3 unset) | HMAC-SHA256 key for `X-Goog-Channel-Token` |
| | `GOOGLE_DRIVE_WEBHOOK_URL` | No | `${NEXTAUTH_URL}/api/integrations/google/webhook` | Public `https://` Drive push notification URL |
| **Billing (Stripe)** | `STRIPE_SECRET_KEY` | **Yes** | Optional (HTTP 503 if unset) | Stripe API secret (`sk_test_...` / `sk_live_...`) |
| | `STRIPE_WEBHOOK_SECRET` | **Yes** | Required when `STRIPE_SECRET_KEY` is set | Stripe webhook HMAC secret (`whsec_...`) |
| | `ALLOWED_REDIRECT_ORIGINS` | No | Optional comma-separated origins | Extra trusted redirect origins for Stripe checkout/portal (`LIM-20(4)` same-origin enforcement) |
| | `STRIPE_PRICE_ID_STUDENT` | No | Optional | Stripe Price ID for Student plan |
| | `STRIPE_PRICE_ID_PRO` | No | Optional | Stripe Price ID for Pro plan |
| | `STRIPE_PRICE_ID_TEAM` | No | Optional | Stripe Price ID for Team plan |
| | `STRIPE_PRICE_ID_INSTITUTION` | No | Optional | Stripe Price ID for Institution plan |
| **Cloud Identity, Key Vault & Vertex WIF (Stage B)** | `GEMINI_AUTH_MODE` | No | `"auto"` (supports `"api_key"`, `"vertex_wif"`, `"vertex_adc"`) | `"vertex_wif"` when Bicep sets WIF without API key; `"auto"` for hybrid WIF + `GOOGLE_AI_API_KEY` fallback or local dev |
| | `GOOGLE_GENAI_USE_VERTEXAI` | No | `"true"` in strict WIF (`"false"` in hybrid `"auto"` fallback) | Must stay `"false"` in hybrid `auto` mode so API-key fallback remains reachable without MI |
| | `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` | No | e.g. `us-central1` | Target GCP project & region for Vertex AI Gemini |
| | `GOOGLE_WIF_AUDIENCE` | No | `//iam.googleapis.com/projects/.../providers/...` | Google Workload Identity Federation provider audience |
| | `GOOGLE_WIF_AZURE_RESOURCE` | No | `api://AzureADTokenExchange` | Azure AD resource requested from Managed Identity endpoint |
| | `GOOGLE_WIF_SERVICE_ACCOUNT` | No | Optional | Optional GCP service account email for IAM impersonation |
| | `AZURE_CLIENT_ID` | No | Provisioned MI Client ID | User-Assigned Managed Identity client ID for Key Vault & WIF (fail-closed without `IDENTITY_ENDPOINT` unless IMDS fallback explicitly opted in) |
| | `AZURE_KEY_VAULT_URI` | No | `https://<vault>.vault.azure.net` | Optional runtime secret hydration endpoint (redirects forbidden; set `AZURE_KEY_VAULT_ALLOW_IMDS_FALLBACK=true` only where IMDS without `IDENTITY_ENDPOINT` is intentional) |
| | `CLOUD_PRODUCTION_STRICT` / `ZENOTE_DEPLOYMENT_TARGET` | No | `"true"` / `"azure"` in cloud ACA | Enables strict fail-closed production env & health validation |
| | `SSE_REDIS_PUBSUB_ENABLED` | No | `"false"` (`"true"` in ACA scale-out) | Enables Redis Pub/Sub cross-replica SSE fan-out (`events.ts`) |
| **Observability (Datadog & Azure Monitor)** | `APPLICATIONINSIGHTS_CONNECTION_STRING` | **Yes** | Optional (injected by ACA Bicep) | Azure Monitor / Application Insights Breeze track intake |
| | `AZURE_CLOUD_ROLE_NAME` / `ZENOTE_SERVICE_ROLE` | No | Inferred via `DD_SERVICE` / `ZENOTE_WORKER_BUNDLED` | Explicit Azure Monitor `ai.cloud.role` (`zenote-web` vs `zenote-worker`) |
| | `DD_API_KEY` | **Yes** | Optional | Datadog HTTP intake API key |
| | `DD_SITE` | No | `datadoghq.com` | Datadog org site (`us5.datadoghq.com`, etc.) |
| | `DD_ENV` | No | `NODE_ENV` | Deployment environment tag |
| | `DD_SERVICE` | No | `notes-platform` | Set explicitly (`zenote-web` / `zenote-worker`) in Docker & ACA |
| | `DD_VERSION` | No | `""` | Git SHA / container image tag |

### 2.3 Worker Container (`zenote-worker`)

| Category | Variable | Secret? | Default / Prod Value | Notes |
|---|---|---|---|---|
| **Worker Identity & Health** | `NODE_ENV` | No | `production` | Baked into `worker` stage |
| | `ZENOTE_WORKER_BUNDLED` | No | `"true"` (inlined in `dist/workers/index.cjs`) | Identifies bundled standalone worker even if `WORKER_HEALTH_PORT` is unset |
| | `AZURE_CLOUD_ROLE_NAME` / `ZENOTE_SERVICE_ROLE` / `DD_SERVICE` | No | `zenote-worker` in Docker & ACA | Telemetry role tag for App Insights & Datadog (`DD_SERVICE=zenote-worker`) |
| | `WORKER_HEALTH_PORT` | No | `3001` | Serves `/live` (`/healthz`) and `/health` (`/ready`) |
| | `WORKER_SHUTDOWN_TIMEOUT_MS` | No | `25000` | Watchdog force-exit bound inside Container Apps 30s grace window |
| | `BULLMQ_ENABLED` | No | `true` | Baked into `worker` stage |
| | `BULLMQ_DEDICATED_WORKER` | No | `true` | Must match `zenote-web` |
| | `BULLMQ_WORKER_CONCURRENCY` | No | `3` | Concurrent jobs per worker replica |
| | `BULLMQ_QUEUE_NAME` | No | `zenote-processing-jobs` | Must match `zenote-web` |
| | `WORKER_ID` | No | `os.hostname()-pid` | Optional replica/pod identifier for scheduler leases & logs |
| | `LOG_FORMAT` | No | `json` | Structured JSON logging |
| **Database & Redis** | `DATABASE_URL` | **Yes** | Same PostgreSQL DB as `zenote-web` | Required for `ProcessingJob` claiming & writes |
| | `UPSTASH_REDIS_*` / `BULLMQ_REDIS_URL` / `REDIS_URL` | **Yes** | Same Redis as `zenote-web` | Shared queue & multi-replica scheduler lease locks (`SET NX PX`) |
| | `BULLMQ_REDIS_TLS_REJECT_UNAUTHORIZED` | No | `true` | Strict certificate validation on `rediss://` |
| **Storage / AI / STT / Google** | Same storage, AI, embedding, STT, and Google OAuth/Drive secrets/configs as `zenote-web` (including `NEXTAUTH_URL`, `GOOGLE_DRIVE_CLIENT_*`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_WEBHOOK_SECRET`, `GOOGLE_DRIVE_WEBHOOK_URL`) | Mixed | Identical values | Needed to download uploaded bytes, run extraction/STT/AI/embeddings, and renew Drive watches (`infra/azure/main.bicep` mirrors these into `workerApp` while keeping `STRIPE_*` web-only). Complete pair (`GOOGLE_DRIVE_CLIENT_ID` + `GOOGLE_DRIVE_CLIENT_SECRET`) enforced in `CLOUD_PRODUCTION_STRICT`. |
| **Extraction Limits** | `DOCUMENT_EXTRACTION_CONCURRENCY` | No | `1` | Per-process semaphore inside worker |
| | `DOCUMENT_EXTRACTION_MAX_QUEUE_DEPTH` | No | `30` | Max queued local extractions per process |
| | `DOCUMENT_EXTRACTION_MAX_QUEUE_WAIT_MS` | No | `300000` | Max queue wait (ms) |
| | `DOCUMENT_EXTRACTION_ACTIVE_TIMEOUT_MS` | No | `120000` | Max parse time per document |

### 2.4 Database Migration Job (`migrator` Target)

| Variable | Secret? | Purpose |
|---|---|---|
| `DATABASE_URL` | **Yes** | Target PostgreSQL URL for `prisma migrate deploy` (for Neon, prefer the non-pooled direct endpoint during DDL migrations) |

---

## 3. Azure Key Vault Split & Feature Flags (Staging / Production)

When provisioning Stage B / Azure Container Apps (`infra/azure/main.bicep`):
- Store **Secrets** in Azure Key Vault (bound conditionally via `enable*Secret*` Bicep feature flags; only populated optional flags bind into Container Apps, and `APPLICATIONINSIGHTS-CONNECTION-STRING` is wired automatically from the provisioned App Insights resource rather than Key Vault):
  - **Core (Always Bound):** `DATABASE-URL`, `NEXTAUTH-SECRET`, `UPSTASH-REDIS-REST-URL`, `UPSTASH-REDIS-REST-TOKEN`, `STORAGE-ACCESS-KEY-ID`, `STORAGE-SECRET-ACCESS-KEY`.
  - **Feature-Flagged Shared (`web` + `worker`):** `OPENAI-API-KEY`, `ASSEMBLYAI-API-KEY`, `GOOGLE-AI-API-KEY` *(auto-bound if `googleWifAudience` is empty)*, `GOOGLE-CLIENT-ID`, `GOOGLE-CLIENT-SECRET`, `GOOGLE-DRIVE-CLIENT-ID`, `GOOGLE-DRIVE-CLIENT-SECRET`, `GOOGLE-TOKEN-ENCRYPTION-KEY`, `GOOGLE-WEBHOOK-SECRET`, `DD-API-KEY`.
  - **Feature-Flagged Web-Only (`zenote-web` only):** `STRIPE-SECRET-KEY`, `STRIPE-WEBHOOK-SECRET`.
- Pass **Non-Secret Configuration** as standard Container App environment variables:
  - `NODE_ENV`, `PORT`, `HOSTNAME`, `NEXTAUTH_URL`, `ZENOTE_DEPLOYMENT_TARGET`, `CLOUD_PRODUCTION_STRICT`, `BULLMQ_*`, `WORKER_*`, `SSE_REDIS_PUBSUB_ENABLED`, `STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `AI_PROVIDER`, `GEMINI_AUTH_MODE`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_WIF_*`, `AZURE_CLIENT_ID`, `AZURE_KEY_VAULT_URI`, `EMBEDDING_PROVIDER`, `SPEECH_PROVIDER`, `ALLOWED_REDIRECT_ORIGINS`, `AZURE_CLOUD_ROLE_NAME`, `ZENOTE_SERVICE_ROLE`, `DD_SITE`, `DD_ENV`, `DD_SERVICE`, `DD_VERSION`, `LOG_FORMAT`.
