import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateRuntimeConfiguration } from "@/lib/config/production-validation";

describe("Stage B — Fail-Closed Production Configuration Validation", () => {
  it("allows local development mode cleanly without requiring production secrets", () => {
    const res = validateRuntimeConfiguration({
      role: "web",
      env: { NODE_ENV: "development" },
    });
    expect(res.ok).toBe(true);
    expect(res.strict).toBe(false);
    expect(res.errors).toEqual([]);
  });

  it("enforces NEXTAUTH_SECRET in non-strict production mode without breaking Compose defaults", () => {
    const missingSecret = validateRuntimeConfiguration({
      role: "web",
      env: { NODE_ENV: "production" },
    });
    expect(missingSecret.ok).toBe(false);

    const composeBaseline = validateRuntimeConfiguration({
      role: "web",
      env: {
        NODE_ENV: "production",
        NEXTAUTH_SECRET: "local-compose-dev-secret-change-in-production-32bytes",
        STORAGE_PROVIDER: "local",
      },
    });
    expect(composeBaseline.ok).toBe(true);
  });

  it("rejects placeholder secrets, localhost DB, local disk storage, and embedded worker flags in strict cloud mode", () => {
    const bad = validateRuntimeConfiguration({
      role: "web",
      strict: true,
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:supersecretpw@localhost:5432/zenote",
        NEXTAUTH_SECRET: "placeholder-not-a-real-secret",
        NEXTAUTH_URL: "http://localhost:3000",
        STORAGE_PROVIDER: "local",
        AI_PROVIDER: "gemini",
        STRIPE_SECRET_KEY: "sk_live_mock",
      },
    });

    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThanOrEqual(6);
    // Security invariant: raw secret values never appear in validation output
    expect(JSON.stringify(bad)).not.toContain("supersecretpw");
    expect(JSON.stringify(bad)).not.toContain("sk_live_mock");
  });

  it("passes strict cloud validation for a complete Azure Container Apps web + worker configuration", () => {
    const validSharedEnv: Record<string, string | undefined> = {
      NODE_ENV: "production",
      ZENOTE_DEPLOYMENT_TARGET: "azure",
      CLOUD_PRODUCTION_STRICT: "true",
      DATABASE_URL: "postgresql://zenote:strongpw@ep-example.neon.tech/zenote_prod?sslmode=require",
      NEXTAUTH_SECRET: "a94f3c8e21b04e679928d3a4b5c6e7f8901234567890abcd",
      NEXTAUTH_URL: "https://zenote.app",
      BULLMQ_DEDICATED_WORKER: "true",
      BULLMQ_EMBEDDED_WORKER: "false",
      BULLMQ_EMBEDDED_MAINTENANCE: "false",
      UPSTASH_REDIS_REST_URL: "https://example-upstash.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "upstash-token-xyz",
      STORAGE_PROVIDER: "s3",
      STORAGE_ENDPOINT: "https://r2-account.r2.cloudflarestorage.com",
      STORAGE_BUCKET: "zenote-prod",
      STORAGE_ACCESS_KEY_ID: "r2-key-id",
      STORAGE_SECRET_ACCESS_KEY: "r2-secret",
      AI_PROVIDER: "gemini",
      GEMINI_AUTH_MODE: "vertex_wif",
      GOOGLE_CLOUD_PROJECT: "zenote-gcp-prod",
      GOOGLE_WIF_AUDIENCE: "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/az/providers/aca",
      IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
      IDENTITY_HEADER: "aca-hdr",
      STRIPE_SECRET_KEY: "sk_test_value",
      STRIPE_WEBHOOK_SECRET: "whsec_value",
      AZURE_KEY_VAULT_URI: "https://zenote-kv.vault.azure.net",
    };

    const webRes = validateRuntimeConfiguration({ role: "web", env: validSharedEnv });
    expect(webRes.ok).toBe(true);
    expect(webRes.errors).toEqual([]);

    const workerRes = validateRuntimeConfiguration({ role: "worker", env: validSharedEnv });
    expect(workerRes.ok).toBe(true);
    expect(workerRes.errors).toEqual([]);
  });

  it("rejects incomplete GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET pairs in strict cloud mode (AUD-01)", () => {
    const partialDrive = validateRuntimeConfiguration({
      role: "worker",
      strict: true,
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://zenote:strongpw@ep-example.neon.tech/zenote_prod?sslmode=require",
        NEXTAUTH_SECRET: "a94f3c8e21b04e679928d3a4b5c6e7f8901234567890abcd",
        UPSTASH_REDIS_REST_URL: "https://example-upstash.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "upstash-token-xyz",
        STORAGE_PROVIDER: "s3",
        STORAGE_ENDPOINT: "https://r2-account.r2.cloudflarestorage.com",
        STORAGE_BUCKET: "zenote-prod",
        STORAGE_ACCESS_KEY_ID: "r2-key-id",
        STORAGE_SECRET_ACCESS_KEY: "r2-secret",
        GOOGLE_DRIVE_CLIENT_ID: "only-client-id-set",
      },
    });
    expect(partialDrive.ok).toBe(false);
    expect(
      partialDrive.errors.some((e) => e.includes("GOOGLE_DRIVE_CLIENT_ID"))
    ).toBe(true);
  });

  it("enforces Azure IaC conditional KV secret split, worker Google env parity, Alert KQL fidelity, and migration-first CD ordering (AUD-01, AUD-07, AUD-08)", () => {
    const root = process.cwd();
    const mainBicep = fs.readFileSync(path.join(root, "infra/azure/main.bicep"), "utf8");
    const alertsBicep = fs.readFileSync(
      path.join(root, "infra/monitoring/azure-monitor-alerts.bicep"),
      "utf8"
    );
    const cdWorkflow = fs.readFileSync(
      path.join(root, ".github/workflows/cd-azure-container-apps.yml"),
      "utf8"
    );

    // AUD-01 checks
    expect(mainBicep).toContain("appInsights.properties.ConnectionString");
    expect(mainBicep).not.toContain("secrets: commonKeyVaultSecrets");
    expect(mainBicep).toContain("var workerSecrets = sharedSecrets");
    expect(mainBicep).toContain("var webSecrets = concat(sharedSecrets, optionalStripeSecrets)");
    expect(mainBicep).toContain("param deployContainerApps bool = true");
    expect(mainBicep).toContain("param deployWorkloadApps bool = true");

    // AUD-07 check
    expect(alertsBicep).toContain('Log_s has "[api:health]"');

    // AUD-08 check: migration job execution sits strictly between deployWorkloadApps=false and deployWorkloadApps=true
    const idxPre = cdWorkflow.indexOf("deployWorkloadApps=false");
    const idxMigrate = cdWorkflow.indexOf("az containerapp job start");
    const idxPost = cdWorkflow.indexOf("deployWorkloadApps=true");
    expect(idxPre).toBeGreaterThan(-1);
    expect(idxMigrate).toBeGreaterThan(idxPre);
    expect(idxPost).toBeGreaterThan(idxMigrate);

    // NEW-01 check: BOTH Step 1 and Step 3 az deployment blocks forward all non-secret params and feature flags
    const step1Block = cdWorkflow.slice(idxPre, idxMigrate);
    const step3Block = cdWorkflow.slice(idxPost);
    for (const param of [
      "storageRegion=",
      "googleWifAzureResource=",
      "enableOpenAiSecret=",
      "enableGeminiApiKeySecret=",
      "enableStripeBillingSecrets=",
      "ddSite=",
      "allowedRedirectOrigins=",
      "googleDriveWebhookUrl=",
      "stripePriceIdStudent=",
      "stripePriceIdPro=",
      "stripePriceIdTeam=",
      "stripePriceIdInstitution=",
    ]) {
      expect(step1Block).toContain(param);
      expect(step3Block).toContain(param);
    }

    // NEW-06 check: main.bicep selects 'auto' (with GOOGLE_GENAI_USE_VERTEXAI='false') in hybrid WIF + API-key mode
    expect(mainBicep).toContain("var geminiAuthMode = empty(googleWifAudience)");
    expect(mainBicep).toContain("? 'api_key'");
    expect(mainBicep).toContain(": (enableGeminiApiKeySecret ? 'auto' : 'vertex_wif')");
    expect(mainBicep).toContain(
      "var googleGenAiUseVertexAi = (!empty(googleWifAudience) && !enableGeminiApiKeySecret) ? 'true' : 'false'"
    );
  });

  it("allows hybrid GEMINI_AUTH_MODE=auto fallback to GOOGLE_AI_API_KEY when MI is absent while failing closed on explicit vertex_wif (NEW-06)", () => {
    const baseCloudEnv: Record<string, string | undefined> = {
      NODE_ENV: "production",
      ZENOTE_DEPLOYMENT_TARGET: "azure",
      CLOUD_PRODUCTION_STRICT: "true",
      DATABASE_URL: "postgresql://zenote:strongpw@ep-example.neon.tech/zenote_prod?sslmode=require",
      NEXTAUTH_SECRET: "a94f3c8e21b04e679928d3a4b5c6e7f8901234567890abcd",
      NEXTAUTH_URL: "https://zenote.app",
      BULLMQ_DEDICATED_WORKER: "true",
      BULLMQ_EMBEDDED_WORKER: "false",
      BULLMQ_EMBEDDED_MAINTENANCE: "false",
      UPSTASH_REDIS_REST_URL: "https://example-upstash.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "upstash-token-xyz",
      STORAGE_PROVIDER: "s3",
      STORAGE_ENDPOINT: "https://r2-account.r2.cloudflarestorage.com",
      STORAGE_BUCKET: "zenote-prod",
      STORAGE_ACCESS_KEY_ID: "r2-key-id",
      STORAGE_SECRET_ACCESS_KEY: "r2-secret",
      AI_PROVIDER: "gemini",
      GOOGLE_CLOUD_PROJECT: "zenote-gcp-prod",
      GOOGLE_WIF_AUDIENCE: "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/az/providers/aca",
      GOOGLE_AI_API_KEY: "AIza-hybrid-fallback-key",
    };

    const hybridAutoNoMi = validateRuntimeConfiguration({
      role: "web",
      env: {
        ...baseCloudEnv,
        GEMINI_AUTH_MODE: "auto",
        GOOGLE_GENAI_USE_VERTEXAI: "false",
      },
    });
    expect(hybridAutoNoMi.ok).toBe(true);

    const explicitWifNoMi = validateRuntimeConfiguration({
      role: "web",
      env: {
        ...baseCloudEnv,
        GEMINI_AUTH_MODE: "vertex_wif",
      },
    });
    expect(explicitWifNoMi.ok).toBe(false);
    expect(explicitWifNoMi.errors.some((e) => e.includes("Managed Identity"))).toBe(true);

    const kvWithoutMi = validateRuntimeConfiguration({
      role: "web",
      env: {
        ...baseCloudEnv,
        GEMINI_AUTH_MODE: "api_key",
        AZURE_KEY_VAULT_URI: "https://zenote-kv.vault.azure.net",
      },
    });
    expect(kvWithoutMi.ok).toBe(false);
    expect(kvWithoutMi.errors.some((e) => e.includes("AZURE_KEY_VAULT_URI"))).toBe(true);

    const danglingKvMap = validateRuntimeConfiguration({
      role: "web",
      env: {
        ...baseCloudEnv,
        GEMINI_AUTH_MODE: "api_key",
        AZURE_KEY_VAULT_SECRET_MAP: "STRIPE_SECRET_KEY=stripe-sec",
      },
    });
    expect(danglingKvMap.ok).toBe(false);
    expect(danglingKvMap.errors.some((e) => e.includes("AZURE_KEY_VAULT_SECRET_MAP"))).toBe(true);
  });
});
