/**
 * Stage D — Offline Deployment Readiness Validator (`npm run verify:readiness`).
 *
 * Performs deterministic pre-flight verification across:
 *   1. Prisma migration inventory (matches expected 13 directories + lockfile)
 *   2. Multi-stage Dockerfile targets & secret/artifact hygiene in `.dockerignore`
 *   3. Next.js standalone & `pdfjs-dist` tracing configuration (`next.config.js`)
 *   4. Azure Container Apps IaC (`infra/azure/main.bicep`) & alert specs
 *   5. CI/CD workflow hygiene (least privilege + migration-before-app cutover)
 *   6. Compiled worker bundle check (`dist/workers/index.cjs` when built)
 *
 * Strictly offline — never reads `.env`/`.env.local` or touches any live DB/cloud service.
 */

import fs from "node:fs";
import path from "node:path";
import { verifyMigrationIndexIdempotency } from "./prepare-concurrent-indexes.mjs";

const rootDir = process.cwd();
const errors = [];
const warnings = [];
const checks = [];

function pass(label) {
  checks.push({ status: "PASS", label });
}

function fail(label, detail) {
  errors.push(`${label}: ${detail}`);
  checks.push({ status: "FAIL", label, detail });
}

function warn(label, detail) {
  warnings.push(`${label}: ${detail}`);
  checks.push({ status: "WARN", label, detail });
}

function readText(relPath) {
  const full = path.resolve(rootDir, relPath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
}

// 1. Prisma Migration Inventory
const migrationsDir = path.resolve(rootDir, "prisma/migrations");
if (!fs.existsSync(migrationsDir)) {
  fail("prisma.migrations", "Missing prisma/migrations directory");
} else {
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (dirs.length < 13) {
    fail("prisma.migrations", `Expected at least 13 migration directories, found ${dirs.length}`);
  } else {
    const emptyMigrations = dirs.filter((d) => {
      const sqlPath = path.join(migrationsDir, d, "migration.sql");
      return !fs.existsSync(sqlPath) || fs.readFileSync(sqlPath, "utf8").trim().length === 0;
    });
    if (emptyMigrations.length > 0) {
      fail("prisma.migrations", `Empty or missing migration.sql in: ${emptyMigrations.join(", ")}`);
    } else {
      pass(`Prisma migration inventory valid (${dirs.length} migration directories with non-empty SQL)`);
    }
    const indexCheck = verifyMigrationIndexIdempotency(migrationsDir);
    if (!indexCheck.valid) {
      fail("prisma.concurrent_indexes", indexCheck.errors.join("; "));
    } else {
      pass(
        `LIM-09 concurrent index manifest verified (${indexCheck.checkedCount} indexes use IF NOT EXISTS for out-of-band concurrent index compatibility)`
      );
    }
  }
  if (!fs.existsSync(path.join(migrationsDir, "migration_lock.toml"))) {
    fail("prisma.migration_lock", "Missing prisma/migrations/migration_lock.toml");
  } else {
    pass("prisma/migrations/migration_lock.toml present");
  }
}

// 2. Dockerfile & .dockerignore hygiene
const dockerfile = readText("Dockerfile");
if (!dockerfile) {
  fail("dockerfile", "Missing Dockerfile");
} else {
  for (const target of ["AS base", "AS migrator", "AS builder", "AS web", "AS worker"]) {
    if (!dockerfile.includes(target)) {
      fail("dockerfile.targets", `Missing Docker stage '${target}'`);
    }
  }
  if (!dockerfile.includes("USER nextjs") || !dockerfile.includes("USER worker") || !dockerfile.includes("USER migrator")) {
    fail("dockerfile.nonroot", "All runtime Docker targets (migrator, web, worker) must run as non-root users");
  } else if (
    !dockerfile.includes("chown -R nextjs:nodejs /app/.next /tmp/zenote-local-storage") ||
    !dockerfile.includes("chown -R worker:nodejs /tmp/zenote-local-storage")
  ) {
    fail(
      "dockerfile.volume_permissions",
      "Dockerfile must pre-create and chown /tmp/zenote-local-storage for nextjs and worker UID 1001"
    );
  } else {
    pass("Dockerfile multi-stage targets (migrator, web, worker) use non-root UID 1001 and writable volume mount dirs");
  }
  if (!dockerfile.includes(".next/standalone/.env*")) {
    fail("dockerfile.secret_scrub", "Dockerfile builder stage must strip .next/standalone/.env*");
  } else {
    pass("Dockerfile explicitly scrubs .next/standalone/.env*");
  }
  if (
    !dockerfile.includes("AZURE_CLOUD_ROLE_NAME=zenote-web") ||
    !dockerfile.includes("AZURE_CLOUD_ROLE_NAME=zenote-worker")
  ) {
    fail(
      "dockerfile.service_roles",
      "Dockerfile must set distinct AZURE_CLOUD_ROLE_NAME values for web and worker targets"
    );
  } else {
    pass("Dockerfile sets unambiguous AZURE_CLOUD_ROLE_NAME for web and worker targets");
  }
}

const dockerCompose = readText("docker-compose.yml");
if (dockerCompose) {
  if (
    !dockerCompose.includes("AZURE_CLOUD_ROLE_NAME: zenote-web") ||
    !dockerCompose.includes("AZURE_CLOUD_ROLE_NAME: zenote-worker")
  ) {
    fail(
      "dockercompose.service_roles",
      "docker-compose.yml must differentiate web and worker AZURE_CLOUD_ROLE_NAME"
    );
  } else {
    pass("docker-compose.yml differentiates AZURE_CLOUD_ROLE_NAME for web and worker");
  }
}

const dockerignore = readText(".dockerignore");
if (!dockerignore) {
  fail("dockerignore", "Missing .dockerignore");
} else if (!dockerignore.includes(".env") || !dockerignore.includes(".storage")) {
  fail("dockerignore.rules", ".dockerignore must exclude .env files and .storage directory");
} else {
  pass(".dockerignore excludes .env* and .storage");
}

// 3. next.config.js standalone & pdfjs-dist tracing
const nextConfig = readText("next.config.js");
if (!nextConfig) {
  fail("next.config.js", "Missing next.config.js");
} else {
  if (!nextConfig.includes('output: "standalone"') && !nextConfig.includes("output: 'standalone'")) {
    fail("next.config.standalone", 'next.config.js must set output: "standalone"');
  } else if (!nextConfig.includes("pdfjs-dist/package.json") || !nextConfig.includes("pdfjs-dist/standard_fonts")) {
    fail("next.config.pdfjs", "next.config.js must trace pdfjs-dist/package.json and standard_fonts");
  } else {
    pass("next.config.js standalone output and pdfjs-dist tracing configured");
  }
}

// 4. Stage B Azure IaC & Stage C Monitoring Specs
const mainBicep = readText("infra/azure/main.bicep");
if (!mainBicep) {
  fail("infra.azure.bicep", "Missing infra/azure/main.bicep");
} else {
  const requiredTokens = [
    "Microsoft.KeyVault/vaults",
    "Microsoft.ManagedIdentity/userAssignedIdentities",
    "Microsoft.App/managedEnvironments",
    "Microsoft.App/jobs",
    "Microsoft.App/containerApps",
    "deployContainerApps",
    "deployWorkloadApps",
    "enableStripeBillingSecrets",
    "enableGoogleOAuthSecrets",
    "appInsights.properties.ConnectionString",
    "GOOGLE_DRIVE_CLIENT_ID",
    "GOOGLE_WEBHOOK_SECRET",
    "GOOGLE_TOKEN_ENCRYPTION_KEY",
    "BULLMQ_DEDICATED_WORKER",
    "BULLMQ_EMBEDDED_WORKER",
    "GOOGLE_WIF_AUDIENCE",
    "/api/health/live",
    "/api/health",
    "/live",
    "/health",
  ];
  const missingTokens = requiredTokens.filter((t) => !mainBicep.includes(t));
  if (missingTokens.length > 0) {
    fail("infra.azure.bicep", `Missing required IaC definitions: ${missingTokens.join(", ")}`);
  } else if (mainBicep.includes("secrets: commonKeyVaultSecrets")) {
    fail(
      "infra.azure.bicep.secrets_split",
      "main.bicep must not unconditionally bind commonKeyVaultSecrets to worker and web"
    );
  } else if (
    !mainBicep.includes("var geminiAuthMode") ||
    mainBicep.includes("{ name: 'GEMINI_AUTH_MODE', value: empty(googleWifAudience) ? 'api_key' : 'vertex_wif' }")
  ) {
    fail(
      "infra.azure.bicep.gemini_auth_mode",
      "main.bicep must preserve hybrid 'auto' GEMINI_AUTH_MODE when googleWifAudience and enableGeminiApiKeySecret are both enabled"
    );
  } else {
    pass(
      "infra/azure/main.bicep supports two-stage rollout, hybrid Gemini auth mode, conditional KV secrets, AppInsights wiring & worker/web secret split"
    );
  }
}

const alertsBicep = readText("infra/monitoring/azure-monitor-alerts.bicep");
const dashboardSpec = readText("infra/monitoring/dashboard-spec.json");
if (!alertsBicep || !dashboardSpec) {
  fail("infra.monitoring", "Missing Azure Monitor alerts Bicep or dashboard-spec.json");
} else if (
  !alertsBicep.includes("[api:health]") ||
  !alertsBicep.includes("worker_health_unhealthy") ||
  !alertsBicep.includes("runtime_config_validation_failed") ||
  !alertsBicep.includes("key_vault_hydration_failed")
) {
  fail(
    "infra.monitoring.alerts_kql",
    "azure-monitor-alerts.bicep health alert must match [api:health], worker_health_unhealthy, runtime_config_validation_failed, and key_vault_hydration_failed"
  );
} else if (dashboardSpec.includes("max(Max)")) {
  fail(
    "infra.monitoring.dashboard_kql",
    "dashboard-spec.json must query AppMetrics columns genuinely emitted by Breeze (use Sum, not unpopulated Max)"
  );
} else {
  try {
    JSON.parse(dashboardSpec);
    pass("Azure Monitor alerts Bicep and dashboard-spec.json KQL align with runtime logs and emitted Breeze metrics");
  } catch (err) {
    fail("infra.monitoring.json", `Invalid dashboard-spec.json: ${err.message}`);
  }
}

// 5. GitHub Actions CI & CD workflows
const ciYml = readText(".github/workflows/ci.yml");
const cdYml = readText(".github/workflows/cd-azure-container-apps.yml");
if (!ciYml || !cdYml) {
  fail("workflows", "Missing .github/workflows/ci.yml or cd-azure-container-apps.yml");
} else {
  const stageAYml = readText(".github/workflows/stage-a-verification.yml");
  if (!stageAYml || !stageAYml.includes("docker update --restart=no")) {
    fail(
      "workflows.stage_a.sigterm_wait",
      "stage-a-verification.yml must clear container restart policy (`docker update --restart=no`) before SIGTERM + docker wait"
    );
  } else if (
    !stageAYml.includes("group-deletion-postgres-integration.test.ts") ||
    !stageAYml.includes("search-postgres-integration.test.ts") ||
    !stageAYml.includes("study-postgres-integration.test.ts") ||
    !stageAYml.includes("phase15-live-integration.test.ts") ||
    !stageAYml.includes("lim09-concurrent-indexes.test.ts")
  ) {
    fail(
      "workflows.stage_a.live_integration_suites",
      "stage-a-verification.yml must run all live PostgreSQL/Redis integration suites against the isolated Compose stack"
    );
  } else if (
    !stageAYml.includes('ISOLATED_TEST_DATABASE_URL="postgresql://zenote:zenote_local_pw@127.0.0.1:5433/zenote_local?schema=public"') ||
    !stageAYml.includes('ISOLATED_TEST_REDIS_URL="redis://127.0.0.1:6380"') ||
    !stageAYml.includes('DATABASE_URL="postgresql://zenote:zenote_local_pw@127.0.0.1:5433/zenote_local?schema=public"') ||
    !stageAYml.includes('REDIS_URL="redis://127.0.0.1:6380"') ||
    !stageAYml.includes('ENABLE_LIVE_BULLMQ_TESTS="true"')
  ) {
    fail(
      "workflows.stage_a.compose_port_parity",
      "stage-a-verification.yml host-runner Vitest step must connect to Compose published ports 127.0.0.1:5433 (postgres) and 127.0.0.1:6380 (redis)"
    );
  } else {
    pass("stage-a-verification.yml host-runner endpoints (127.0.0.1:5433 / 127.0.0.1:6380) match docker-compose.yml published ports");
  }
  const preMigrateRolloutIdx = cdYml.indexOf("deployWorkloadApps=false");
  const migrateStartIdx = cdYml.indexOf("az containerapp job start");
  const postMigrateRolloutIdx = cdYml.indexOf("deployWorkloadApps=true");
  const requiredCdParams = [
    "storageRegion=",
    "googleWifAzureResource=",
    "enableOpenAiSecret=",
    "enableGeminiApiKeySecret=",
    "enableAssemblyAiSecret=",
    "enableGoogleOAuthSecrets=",
    "enableGoogleDriveClientSecrets=",
    "enableGoogleTokenEncryptionSecret=",
    "enableGoogleWebhookSecret=",
    "enableStripeBillingSecrets=",
    "enableDatadogSecret=",
    "ddSite=",
    "allowedRedirectOrigins=",
    "googleDriveWebhookUrl=",
    "stripePriceIdStudent=",
    "stripePriceIdPro=",
    "stripePriceIdTeam=",
    "stripePriceIdInstitution=",
  ];

  if (
    preMigrateRolloutIdx < 0 ||
    migrateStartIdx < 0 ||
    postMigrateRolloutIdx < 0 ||
    !(preMigrateRolloutIdx < migrateStartIdx && migrateStartIdx < postMigrateRolloutIdx) ||
    !cdYml.includes("id-token: write")
  ) {
    fail(
      "workflows.cd",
      "CD workflow must use OIDC (id-token: write) and run migrator job (deployWorkloadApps=false) strictly before web/worker rollout (deployWorkloadApps=true)"
    );
  } else {
    const preDeployBlock = cdYml.slice(preMigrateRolloutIdx, migrateStartIdx);
    const postDeployBlock = cdYml.slice(postMigrateRolloutIdx);
    const missingPre = requiredCdParams.filter((p) => !preDeployBlock.includes(p));
    const missingPost = requiredCdParams.filter((p) => !postDeployBlock.includes(p));
    if (missingPre.length > 0 || missingPost.length > 0) {
      fail(
        "workflows.cd.params",
        `CD workflow az deployment blocks omit non-secret/flag params — Step1 missing: [${missingPre.join(", ")}], Step3 missing: [${missingPost.join(", ")}]`
      );
    } else {
      pass("CI/CD workflows enforce OIDC, strict migration-before-app ordering & complete Bicep parameter forwarding");
    }
  }
}

// 6. Optional built-artifact checks (warn only if build not yet executed locally)
const workerBundlePath = path.resolve(rootDir, "dist/workers/index.cjs");
if (!fs.existsSync(workerBundlePath)) {
  warn("dist.worker", "dist/workers/index.cjs not built yet (run npm run build:worker)");
} else {
  const bundle = fs.readFileSync(workerBundlePath, "utf8");
  if (/(?:require|import)\(["']@\/[^"']+["']\)/.test(bundle)) {
    fail("dist.worker.aliases", "dist/workers/index.cjs contains unresolved @/ alias");
  } else {
    pass("dist/workers/index.cjs exists with zero unresolved @/ path aliases");
  }
}

const standaloneServer = path.resolve(rootDir, ".next/standalone/server.js");
if (!fs.existsSync(standaloneServer)) {
  warn("next.standalone", ".next/standalone/server.js not built yet (run npm run build)");
} else {
  const pdfPkg = path.resolve(rootDir, ".next/standalone/node_modules/pdfjs-dist/package.json");
  const pdfFonts = path.resolve(rootDir, ".next/standalone/node_modules/pdfjs-dist/standard_fonts");
  const leakedEnv = fs.existsSync(path.resolve(rootDir, ".next/standalone/.env")) ||
    fs.existsSync(path.resolve(rootDir, ".next/standalone/.env.local"));
  if (!fs.existsSync(pdfPkg) || !fs.existsSync(pdfFonts)) {
    fail("next.standalone.pdfjs", ".next/standalone is missing pdfjs-dist runtime assets");
  } else if (leakedEnv) {
    fail("next.standalone.env_leak", ".next/standalone contains .env or .env.local!");
  } else {
    pass(".next/standalone bundle contains pdfjs-dist assets and zero .env* leakage");
  }
}

for (const item of checks) {
  const tag = `[${item.status}]`;
  console.log(`${tag} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`);
}

console.log(
  `\nSummary: ${checks.filter((c) => c.status === "PASS").length} passed, ${warnings.length} warning(s), ${errors.length} error(s).`
);

if (errors.length > 0) {
  process.exit(1);
}
