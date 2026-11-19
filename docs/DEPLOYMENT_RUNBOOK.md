# Zenote — Staging & Production Deployment Runbook (Stage B / C / D & Phase 2 Remediation)

> **Audience:** Maintainers, release engineers, and SRE/DevOps operators deploying Zenote (`zenote-web`, `zenote-worker`, `zenote-migrator`) to **Azure Container Apps** backed by **Neon PostgreSQL (`pgvector`)**, **Upstash Redis**, **Cloudflare R2**, **Azure Key Vault**, **Azure Monitor / Application Insights**, and **Google Vertex AI (via Workload Identity Federation)**.

---

## 1. Architecture & Process Separation Checklist

| Workload | Artifact / Bicep Resource | Ingress | Health Probes | Responsibilities |
|---|---|---|---|---|
| `zenote-migrator` | `Dockerfile` target `migrator` -> ACA Job (`zenote-<env>-migrator`) | None | Exit code `0` | Executes `prisma migrate deploy` prior to app traffic cutover |
| `zenote-worker` | `Dockerfile` target `worker` -> ACA App (`zenote-<env>-worker`) | None | `GET :3001/live` (503 on drain), `GET :3001/health` | Consumes BullMQ jobs, reconciliation, Drive watch-channel renewal, retention pruning |
| `zenote-web` | `Dockerfile` target `web` -> ACA App (`zenote-<env>-web`) | External HTTPS (`:3000`) | `GET :3000/api/health/live`, `GET :3000/api/health` | Next.js standalone UI/API/SSE producer (`BULLMQ_DEDICATED_WORKER=true`, `BULLMQ_EMBEDDED_WORKER=false`) |

---

## 2. Pre-Flight Infrastructure & Identity Provisioning

### 2.1 Azure Resources (`infra/azure/main.bicep`)
Provision cleanly via Bicep per environment (`staging` or `production`):
- **Log Analytics Workspace & Application Insights** (`APPLICATIONINSIGHTS_CONNECTION_STRING` injected directly into `zenote-web` and `zenote-worker` Container App secrets from `appInsights.properties.ConnectionString` — eliminating circular Key Vault dependencies)
- **User-Assigned Managed Identity** (`zenote-<env>-id`) granted:
  - `AcrPull` on the Azure Container Registry
  - `Key Vault Secrets User` on the environment Key Vault
- **Azure Key Vault** (RBAC-enabled, soft delete + production purge protection)
- **Container Apps Environment** hosting `zenote-<env>-migrator`, `zenote-<env>-worker`, and `zenote-<env>-web`
- **Monitoring Alerts** (`infra/monitoring/azure-monitor-alerts.bicep`) wired to your Action Group (email / Teams / PagerDuty)

#### Conditional Key Vault Secret Feature Flags & Two-Stage First-Time Bootstrap
`infra/azure/main.bicep` only binds optional integration secrets into ACA when their boolean feature flags are enabled in `parameters.<env>.json`:
- Required core secrets always bound: `DATABASE-URL`, `NEXTAUTH-SECRET`, `UPSTASH-REDIS-REST-URL`, `UPSTASH-REDIS-REST-TOKEN`, `STORAGE-ACCESS-KEY-ID`, `STORAGE-SECRET-ACCESS-KEY`.
- Conditional flags (`parameters.<env>.json`): `enableOpenAiSecret` (default `true`), `enableGeminiApiKeySecret` (default `false`; automatically bound if `googleWifAudience` is empty), `enableAssemblyAiSecret` (default `true`), `enableGoogleOAuthSecrets`, `enableGoogleDriveClientSecrets`, `enableGoogleTokenEncryptionSecret`, `enableGoogleWebhookSecret`, `enableStripeBillingSecrets` (`webApp` only), and `enableDatadogSecret`.

On a **brand-new empty environment**, run a two-stage bootstrap before expecting Container Apps to pull secrets:
1. **Stage 1 (Infra + Key Vault Bootstrap):** Deploy `infra/azure/main.bicep` with `deployContainerApps=false` to create Key Vault, Managed Identity, Log Analytics, App Insights, and the Container Apps Environment without creating failing Container Apps against missing Key Vault secrets.
2. **Populate Enabled Key Vault Secrets:** Write the core + enabled optional secrets from §2.2 into Azure Key Vault.
3. **Stage 2 (Migrator-First App Deploy):** Run `.github/workflows/cd-azure-container-apps.yml` (or deploy `deployContainerApps=true deployWorkloadApps=false`, run `zenote-<env>-migrator` to `Succeeded`, then deploy `deployWorkloadApps=true`).

### 2.2 Required Key Vault Secrets (Zero Secrets in Git / Bicep Params)
Populate these Key Vault secret names before enabling `deployContainerApps=true`:
- **Core (Always Required):**
  - `DATABASE-URL` (Neon runtime connection string; prefer non-pooled direct endpoint for DDL migrations)
  - `NEXTAUTH-SECRET` (`openssl rand -base64 32` — **never** use placeholder values)
  - `UPSTASH-REDIS-REST-URL` & `UPSTASH-REDIS-REST-TOKEN`
  - `STORAGE-ACCESS-KEY-ID` & `STORAGE-SECRET-ACCESS-KEY`
- **Feature-Flagged Providers (Enabled per `enable*Secret*` Bicep Parameters):**
  - `OPENAI-API-KEY` (`enableOpenAiSecret=true`, embeddings `text-embedding-3-small`, `vector(1536)`)
  - `ASSEMBLYAI-API-KEY` (`enableAssemblyAiSecret=true`, speech-to-text)
  - `GOOGLE-AI-API-KEY` (`enableGeminiApiKeySecret=true` or when `googleWifAudience == ""`)
  - `GOOGLE-CLIENT-ID` & `GOOGLE-CLIENT-SECRET` (`enableGoogleOAuthSecrets=true`, NextAuth Google login)
  - `GOOGLE-DRIVE-CLIENT-ID` & `GOOGLE-DRIVE-CLIENT-SECRET` (`enableGoogleDriveClientSecrets=true`, synced to **both** `zenote-web` and `zenote-worker`)
  - `GOOGLE-TOKEN-ENCRYPTION-KEY` (`enableGoogleTokenEncryptionSecret=true`) & `GOOGLE-WEBHOOK-SECRET` (`enableGoogleWebhookSecret=true`) — synced to **both** `zenote-web` and `zenote-worker`
  - `STRIPE-SECRET-KEY` & `STRIPE-WEBHOOK-SECRET` (`enableStripeBillingSecrets=true`, bound to **`zenote-web` only**)
  - `DD-API-KEY` (`enableDatadogSecret=true`, bound to **both** `zenote-web` and `zenote-worker`)
- **Automatically Provisioned in Bicep:** `APPLICATIONINSIGHTS-CONNECTION-STRING` is injected directly from the provisioned App Insights resource into Container Apps secrets (you do not need to pre-create it in Key Vault).

### 2.3 Google Vertex AI Workload Identity Federation & Hybrid Fallback
To call Gemini (`gemini-2.5-flash-lite` or configured `GOOGLE_GEMINI_MODEL`) without static JSON key files:
1. Obtain the **Principal ID** (`managedIdentityPrincipalId`) and Tenant ID of `zenote-<env>-id`.
2. In GCP IAM, create a Workload Identity Pool & OIDC Provider federated with Microsoft Entra (`https://sts.windows.net/<TENANT_ID>/v2.0`) trusting `api://AzureADTokenExchange` (or custom App ID URI via `GOOGLE_WIF_AZURE_RESOURCE`).
3. Bind the federated identity (or impersonated Google Service Account via `GOOGLE_WIF_SERVICE_ACCOUNT`) to role **`roles/aiplatform.user`** on your GCP project.
4. Set in `parameters.<env>.json` (or GitHub Actions `vars.*` for CD):
   - `googleCloudProject`: GCP Project ID
   - `googleCloudLocation`: e.g. `us-central1`
   - `googleWifAudience`: `//iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL>/providers/<PROVIDER>`
   - `googleWifAzureResource`: optional (`api://AzureADTokenExchange` default)
   - `googleWifServiceAccount`: optional service account email

> Note on Gemini Auth Modes in Bicep (`infra/azure/main.bicep`):
> - When `googleWifAudience == ""`: Bicep sets `GEMINI_AUTH_MODE="api_key"` (`GOOGLE_GENAI_USE_VERTEXAI="false"`) and binds `GOOGLE-AI-API-KEY` from Key Vault.
> - When `googleWifAudience != ""` and `enableGeminiApiKeySecret=false`: Bicep sets `GEMINI_AUTH_MODE="vertex_wif"` and `GOOGLE_GENAI_USE_VERTEXAI="true"` (strict WIF, fail-closed without Managed Identity).
> - When `googleWifAudience != ""` and `enableGeminiApiKeySecret=true` (hybrid transition): Bicep sets `GEMINI_AUTH_MODE="auto"` and `GOOGLE_GENAI_USE_VERTEXAI="false"` alongside Key Vault `GOOGLE-AI-API-KEY`, so WIF is preferred whenever Azure Managed Identity is reachable and API-key fallback stays functional otherwise.

---

## 3. Release & Cutover Procedure

### 3.1 Automated Gate (`npm run verify:readiness`)
Before any image push or deploy, run the offline verification gate (also enforced automatically in `.github/workflows/ci.yml` and `.github/workflows/cd-azure-container-apps.yml`):
```bash
npm ci
npx prisma generate
npm run typecheck
npm run lint
npm test
npm run build:worker
npm run build
npm run verify:readiness
```

### 3.2 Staging Deploy -> Validation -> Production Promotion
Before running CD, configure GitHub Environment/Repository variables (`vars.*`) for `.github/workflows/cd-azure-container-apps.yml`:
- Required core & storage: `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `ACR_LOGIN_SERVER`, `PUBLIC_BASE_URL`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION` (defaults `'auto'`)
- Vertex WIF: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (`'us-central1'`), `GOOGLE_WIF_AUDIENCE`, `GOOGLE_WIF_AZURE_RESOURCE` (`'api://AzureADTokenExchange'`), `GOOGLE_WIF_SERVICE_ACCOUNT`
- Secret flags: `ENABLE_OPENAI_SECRET`, `ENABLE_GEMINI_API_KEY_SECRET`, `ENABLE_ASSEMBLYAI_SECRET`, `ENABLE_GOOGLE_OAUTH_SECRETS`, `ENABLE_GOOGLE_DRIVE_CLIENT_SECRETS`, `ENABLE_GOOGLE_TOKEN_ENCRYPTION_SECRET`, `ENABLE_GOOGLE_WEBHOOK_SECRET`, `ENABLE_STRIPE_BILLING_SECRETS`, `ENABLE_DATADOG_SECRET`
- Non-secret runtime integration config: `DD_SITE` (`'datadoghq.com'`), `ALLOWED_REDIRECT_ORIGINS`, `GOOGLE_DRIVE_WEBHOOK_URL`, `STRIPE_PRICE_ID_STUDENT`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_TEAM`, `STRIPE_PRICE_ID_INSTITUTION`

1. Trigger `.github/workflows/cd-azure-container-apps.yml` targeting **`staging`** with an immutable release tag (e.g. git SHA or `vX.Y.Z`).
2. Pipeline sequence:
   - Authenticates to Azure via **GitHub OIDC (`id-token: write`)** (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` secrets).
   - Builds and pushes `zenote-migrator:<tag>`, `zenote-web:<tag>`, and `zenote-worker:<tag>` to ACR (passing build-time `NEXT_PUBLIC_SITE_URL` and `STORAGE_ENDPOINT` for CSP injection).
   - Step 1 (Infra + Migrator Update): Applies `infra/azure/main.bicep` with `deployContainerApps=true deployWorkloadApps=false` and the complete non-secret parameter + `ENABLE_*` flag set so Key Vault/Identity/Migrator config stay in sync without rolling out web/worker code ahead of DB migrations.
   - Step 2 (Migrator Gate): Starts `zenote-<env>-migrator` (`prisma migrate deploy`), polls execution state until **`Succeeded`**, and fails fast on `Failed`, `Cancelled`, `Stopped`, unexpected status, or timeout.
   - Step 3 (Web + Worker Rollout): **Only after migration `Succeeded`**, applies `infra/azure/main.bicep` with `deployContainerApps=true deployWorkloadApps=true` (`webImage` + `workerImage` + full non-secret parameters + explicit `ENABLE_*` secret feature flags).
   - Runs `npm run smoke:check -- --web-url <staging-url>` verifying:
     - `GET /api/health/live` -> `200 { status: "alive" }`
     - `GET /api/health` -> `200`, `database: "connected"`, `config: "ok"`, `queue.workerMode: "dedicated"`
     - `GET /api/auth/providers` -> `200`
     - Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`)
3. Manually spot-check staging flows (Google OAuth login, R2 presigned upload -> BullMQ worker extraction SSE, Gemini RAG chat, Stripe webhook test event).
4. Promote the exact immutable `<tag>` to **`production`** via `workflow_dispatch` (protected by GitHub `production` environment reviewers).

---

## 4. Rollback & Schema Compatibility Strategy

### 4.1 Container Revision Rollback (Fastest Recovery)
When an application bug or regression appears without incompatible schema loss:
```bash
# List recent revisions
az containerapp revision list -n zenote-production-web -g <rg> -o table
az containerapp revision list -n zenote-production-worker -g <rg> -o table

# Shift 100% traffic back to the prior healthy revision (example: single/multiple revisions)
az containerapp update -n zenote-production-web -g <rg> --image <acr>.azurecr.io/zenote-web:<previous-tag>
az containerapp update -n zenote-production-worker -g <rg> --image <acr>.azurecr.io/zenote-worker:<previous-tag>
```
Run `npm run smoke:check -- --web-url https://zenote.app` immediately after rollback.

### 4.2 Forward-Only Database Migrations
Prisma migrations in `prisma/migrations/` follow expand-and-contract safety:
- Never run `prisma migrate reset` or destructive SQL against shared/production databases.
- Additive schema changes (`CREATE TABLE`, nullable columns, additive indexes) stay backward-compatible with the N-1 revision so rolling back `zenote-web` / `zenote-worker` images remains safe.
- Any breaking column drop/rename must wait until after a verified N+1 deployment succeeds cleanly.

### 4.3 Zero-Downtime Populated Database Migration & Concurrent Index Procedure (`LIM-09`)

Standard `CREATE INDEX` statements inside Prisma migration files (`prisma/migrations/20261110090000_phase12_search_indexing`, `20261111180000_phase13_intelligent_study_system`, `20261112223000_phase14_google_drive_sync_and_slides`, and `20261113210000_phase15_durable_jobs_and_billing`) acquire a table-level `SHARE` lock that blocks concurrent `INSERT`/`UPDATE`/`DELETE` operations while building the index (and PostgreSQL rejects `CREATE INDEX CONCURRENTLY` inside multi-statement command batches or implicit transaction blocks).

All `19` Phase 12–15 indexes in `CONCURRENT_INDEX_MANIFEST` (out of `23` total Phase 12–15 `CREATE [UNIQUE] INDEX` statements, where the other `4` are inline indexes on brand-new empty tables `NoteChunk_noteId_idx` and `BillingWebhookEvent_*`) are authored with `IF NOT EXISTS` and verified for exact semantic parity in CI via `node scripts/prepare-concurrent-indexes.mjs --verify` and `npm run verify:readiness`.

- **Why `12` of the `19` manifest indexes receive default pre-migration SQL (`phase: "pre_migrate"` across `11` pre-existing tables):**
  - `12` indexes (`idx_material_chunk_embedding_hnsw`, `idx_subject_search_fts`, `idx_chapter_search_fts`, `idx_topic_search_fts`, `idx_material_search_fts`, `idx_group_search_fts`, `idx_flashcard_deck_search_fts`, `idx_flashcard_search_fts`, `FlashcardReview_userId_reviewedAt_idx`, `FlashcardReview_userId_flashcardId_reviewedAt_idx`, `ProcessingJob_status_createdAt_idx`, and `Subscription_externalCustomerId_idx`) target `11` tables and columns that **already exist** before Phases 12–15 migrations run (`FlashcardReview` has 2 `pre_migrate` indexes).
  - The remaining `7` manifest indexes (`phase: "in_migration_or_post_column"`: `idx_note_chunk_embedding_hnsw` on new table `NoteChunk`, `idx_note_search_fts` on new column `Note.plainText`, `FlashcardReview_userId_idempotencyKey_key` on new column `idempotencyKey`, `FlashcardReview_userId_dueAt_idx` on new column `dueAt`, `ConnectedAccount_watchChannelId_key` on new column `watchChannelId`, `ConnectedAccount_watchExpiresAt_idx` on new column `watchExpiresAt`, and `Subscription_externalSubscriptionId_key` on new column `externalSubscriptionId`) reference columns or tables introduced by the Phase 12–15 migrations themselves and therefore cannot be created before those columns/tables exist (use `--post-column-only` or `--include-post-column` once the columns exist).

Follow the appropriate procedure below depending on target database state:

#### A. Fresh / Empty Database (`docker-compose`, CI `zenote_local`, or New Environment Bootstrap)
- Tables contain `0` rows, so standard `CREATE INDEX IF NOT EXISTS` inside `npx prisma migrate deploy` completes in milliseconds (`< 600 ms` total across all 13 migrations).
- Run `npx prisma migrate deploy` directly (via `zenote-migrator` or `docker compose up`).

#### B. Populated Staging / Production Database Rollout (Online Concurrent Pre-Creation)
When rolling out Phase 12–15 migrations to an already-populated database with active write traffic:
1. **Generate & Execute Pre-Migration Concurrent Indexes (Outside Transactions):**
   Use a **direct (non-pooled) PostgreSQL connection** (`DIRECT_DATABASE_URL`) and pipe the single-statement `CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS` script to `psql` **without** `--single-transaction` (`-1`):
   ```bash
   node scripts/prepare-concurrent-indexes.mjs | psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1
   ```
   - `scripts/prepare-concurrent-indexes.mjs` emits `SET statement_timeout = '0'; SET lock_timeout = '5s';` and creates all `12` `pre_migrate` indexes across the `11` pre-existing tables (`Subject`, `Chapter`, `Topic`, `Material`, `Group`, `FlashcardDeck`, `Flashcard`, `FlashcardReview` [2 indexes], `MaterialChunk`, `ProcessingJob`, `Subscription`) using `CONCURRENTLY IF NOT EXISTS` without blocking writes.
   - Brand-new tables (`NoteChunk`, `BillingWebhookEvent`) are created empty by their respective migrations (`0` rows), and new-column indexes (`7` `in_migration_or_post_column` indexes) can be built concurrently via `node scripts/prepare-concurrent-indexes.mjs --post-column-only` (or `--include-post-column` if the `ADD COLUMN IF NOT EXISTS` DDL is pre-applied).
2. **Verify Zero Invalid Concurrent Indexes (`pg_index.indisvalid`) Before Running `prisma migrate deploy`:**
   > **Critical PostgreSQL Behavior:** If `CREATE INDEX CONCURRENTLY` is interrupted or fails (e.g., deadlock or unique violation), PostgreSQL leaves an **invalid** index entry (`pg_index.indisvalid = false`). Because `CREATE INDEX IF NOT EXISTS` inside `prisma migrate deploy` checks only whether the index relation name exists in `pg_class` — **not** whether `indisvalid = true` — a leftover invalid index would cause `prisma migrate deploy` to silently skip index creation (`NOTICE: relation "..." already exists, skipping`) and leave the index permanently unusable by the query planner!
   ```bash
   # Must return 0 rows before proceeding to prisma migrate deploy:
   psql "$DIRECT_DATABASE_URL" -Atc "$(node scripts/prepare-concurrent-indexes.mjs --check-invalid-sql)"
   ```
3. **Recovery If Any Concurrent Index Is Marked `indisvalid = false`:**
   If step 2 returns any index name (e.g., `idx_material_chunk_embedding_hnsw`), print and execute its recovery SQL before running `prisma migrate deploy`:
   ```bash
   node scripts/prepare-concurrent-indexes.mjs --recover-index idx_material_chunk_embedding_hnsw | psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1
   ```
   This runs `DROP INDEX CONCURRENTLY IF EXISTS "<index_name>";` followed by a clean `CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS ...`. Re-run step 2 to confirm `0` invalid rows.
4. **Run `npx prisma migrate deploy` (`zenote-migrator`):**
   Once all pre-created concurrent indexes are valid (`indisvalid = true`), run `npx prisma migrate deploy`. Every pre-created `CREATE [UNIQUE] INDEX IF NOT EXISTS` statement in the migration files becomes an instantaneous metadata no-op (`0 ms` lock impact), and Prisma records all 13 migrations cleanly in `_prisma_migrations`.
5. **Post-Migration Verification:**
   Re-run the invalid-index check after `prisma migrate deploy` completes to confirm all `19` Phase 12–15 indexes are valid and ready (`indisvalid = true AND indisready = true`).

---

## 5. Backup & Disaster Recovery

1. **PostgreSQL (Neon):**
   - Rely on Neon Point-in-Time Recovery (PITR) / branch snapshots before major production migrations (`prisma migrate deploy`).
   - Test recovery quarterly by branching from a PITR timestamp into an isolated verification database and running `npx prisma migrate status` + smoke queries (never test against `/neondb`).
2. **Object Storage (Cloudflare R2):**
   - Enable R2 versioning / bucket backup replication for production user media. Remember all `ProcessingJob` artifacts and `Material.storageKey` pointers live in PostgreSQL.
3. **Redis (Upstash):**
   - Upstash caches transient rate-limit windows, distributed worker scheduler leases (`zenote-processing-jobs:scheduler-lock:*`), and active BullMQ queue messages.
   - PostgreSQL `ProcessingJob` remains the authoritative durable ledger: if Redis is flushed or replaced during an incident, `reconcileStrandedProcessingJobs()` automatically recovers eligible stranded `QUEUED` / `RUNNING` jobs once worker connectivity resumes.
4. **Data-Loss Safety:**
   - Never run bulk delete/drop commands without an explicit Neon branch checkpoint. Keep `CLOUD_PRODUCTION_STRICT=true` and `BULLMQ_DEDICATED_WORKER=true` active in all cloud revisions.
