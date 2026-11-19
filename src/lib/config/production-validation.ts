/**
 * Fail-Closed Production & Cloud Runtime Configuration Validation (Stage B).
 *
 * Keeps local development and non-strict Docker Compose verification working
 * without requiring cloud-only secrets, while failing closed when strict
 * cloud production validation is enabled (`CLOUD_PRODUCTION_STRICT=true`,
 * `ZENOTE_DEPLOYMENT_TARGET=azure`, or explicit `{ strict: true }`).
 *
 * Security:
 *   - NEVER includes secret values, tokens, URLs with credentials, or raw
 *     environment variable contents in error/warning output.
 */

import { detectAzureIdentityMode } from "@/lib/cloud/azure-identity";
import {
  getAzureKeyVaultConfigStatus,
  parseAzureKeyVaultUri,
  parseKeyVaultSecretMapping,
} from "@/lib/cloud/key-vault";
import { resolveBullMqRedisConfig } from "@/lib/queue/connection";

export type RuntimeServiceRole = "web" | "worker" | "migrator";

export interface RuntimeValidationOptions {
  role?: RuntimeServiceRole;
  strict?: boolean;
  env?: Record<string, string | undefined>;
}

export interface RuntimeValidationResult {
  ok: boolean;
  role: RuntimeServiceRole;
  strict: boolean;
  errors: string[];
  warnings: string[];
}

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-random-32-byte-secret",
  "placeholder-not-a-real-secret",
  "local-compose-dev-secret-change-in-production-32bytes",
  "changeme",
  "secret",
  "dev-secret",
]);

function isLocalhostHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "0.0.0.0"
  );
}

function validateUrlString(
  rawUrl: string | undefined,
  allowedProtocols: string[]
): { valid: boolean; parsed?: URL } {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return { valid: false };
  try {
    const parsed = new URL(trimmed);
    if (!allowedProtocols.includes(parsed.protocol)) {
      return { valid: false };
    }
    return { valid: true, parsed };
  } catch {
    return { valid: false };
  }
}

export function isStrictCloudProduction(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.CLOUD_PRODUCTION_STRICT === "true" ||
    env.ZENOTE_DEPLOYMENT_TARGET === "azure" ||
    env.ZENOTE_DEPLOYMENT_TARGET === "cloud"
  );
}

/**
 * Validates environment configuration for the specified service role without
 * ever emitting secret values or credential substrings.
 */
export function validateRuntimeConfiguration(
  options: RuntimeValidationOptions = {}
): RuntimeValidationResult {
  const env = options.env ?? process.env;
  const role: RuntimeServiceRole = options.role ?? "web";
  const strict = options.strict ?? isStrictCloudProduction(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  const isProdNode = env.NODE_ENV === "production";

  if (!isProdNode && !strict) {
    return { ok: true, role, strict: false, errors, warnings };
  }

  // Non-strict production baseline (matches /api/health baseline and local Docker Compose)
  if (role === "web" && !env.NEXTAUTH_SECRET?.trim()) {
    errors.push("NEXTAUTH_SECRET is missing in production.");
  }

  if (!strict) {
    return {
      ok: errors.length === 0,
      role,
      strict: false,
      errors,
      warnings,
    };
  }

  // ---- Strict Cloud Production Invariants ----
  const dbCheck = validateUrlString(env.DATABASE_URL, ["postgres:", "postgresql:"]);
  if (!dbCheck.valid || !dbCheck.parsed) {
    errors.push("DATABASE_URL must be a valid postgres:// or postgresql:// connection string.");
  } else {
    if (isLocalhostHost(dbCheck.parsed.hostname)) {
      errors.push("DATABASE_URL must not target localhost/loopback in strict cloud production.");
    }
    const sslMode = dbCheck.parsed.searchParams.get("sslmode");
    if (!sslMode || sslMode === "disable" || sslMode === "allow") {
      warnings.push("DATABASE_URL does not enforce sslmode=require or verify-full.");
    }
  }

  // Key Vault format check when configured
  if (env.AZURE_KEY_VAULT_URI?.trim()) {
    if (!parseAzureKeyVaultUri(env.AZURE_KEY_VAULT_URI)) {
      errors.push("AZURE_KEY_VAULT_URI must use https:// and be a valid vault URI.");
    } else if (getAzureKeyVaultConfigStatus(env) === "misconfigured") {
      errors.push(
        "AZURE_KEY_VAULT_URI is configured, but Azure Managed Identity / IMDS credentials are unavailable for Key Vault access."
      );
    }
    if (env.AZURE_KEY_VAULT_SECRET_MAP?.trim()) {
      try {
        parseKeyVaultSecretMapping(env.AZURE_KEY_VAULT_SECRET_MAP);
      } catch {
        errors.push("AZURE_KEY_VAULT_SECRET_MAP contains an invalid mapping specification.");
      }
    }
  } else if (env.AZURE_KEY_VAULT_SECRET_MAP?.trim()) {
    errors.push("AZURE_KEY_VAULT_SECRET_MAP requires AZURE_KEY_VAULT_URI to be set.");
  }

  if (role === "migrator") {
    return {
      ok: errors.length === 0,
      role,
      strict: true,
      errors,
      warnings,
    };
  }

  // Auth secret strength for web + worker
  const nextAuthSecret = env.NEXTAUTH_SECRET?.trim() ?? "";
  if (nextAuthSecret.length < 32 || KNOWN_PLACEHOLDER_SECRETS.has(nextAuthSecret)) {
    errors.push(
      "NEXTAUTH_SECRET must be a non-placeholder secret with at least 32 characters."
    );
  }

  if (role === "web") {
    const nextAuthUrl = validateUrlString(env.NEXTAUTH_URL, ["https:"]);
    if (!nextAuthUrl.valid || !nextAuthUrl.parsed || isLocalhostHost(nextAuthUrl.parsed.hostname)) {
      errors.push("NEXTAUTH_URL must be an https:// public origin (non-localhost) in cloud web deployment.");
    }

    if (env.BULLMQ_DEDICATED_WORKER !== "true") {
      errors.push("BULLMQ_DEDICATED_WORKER must be \"true\" on zenote-web in cloud multi-container topology.");
    }
    if (env.BULLMQ_EMBEDDED_WORKER !== "false") {
      errors.push("BULLMQ_EMBEDDED_WORKER must be \"false\" on zenote-web in cloud multi-container topology.");
    }
    if (env.BULLMQ_EMBEDDED_MAINTENANCE === "true") {
      errors.push("BULLMQ_EMBEDDED_MAINTENANCE must not be \"true\" on zenote-web.");
    }
  }

  // Distributed storage invariant: local filesystem cannot be shared across containers in cloud
  const storageProvider = env.STORAGE_PROVIDER?.trim();
  if (storageProvider !== "s3") {
    errors.push("STORAGE_PROVIDER must be \"s3\" (Cloudflare R2 / S3) in strict cloud production.");
  } else {
    if (
      !env.STORAGE_BUCKET?.trim() ||
      !env.STORAGE_ACCESS_KEY_ID?.trim() ||
      !env.STORAGE_SECRET_ACCESS_KEY?.trim()
    ) {
      errors.push(
        "STORAGE_PROVIDER=\"s3\" requires STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, and STORAGE_SECRET_ACCESS_KEY."
      );
    }
    if (env.STORAGE_ENDPOINT?.trim()) {
      const ep = validateUrlString(env.STORAGE_ENDPOINT, ["https:"]);
      if (!ep.valid) {
        errors.push("STORAGE_ENDPOINT must use https:// in strict cloud production.");
      }
    }
  }

  // Durable Redis / BullMQ check
  const redisCfg = resolveBullMqRedisConfig(env as NodeJS.ProcessEnv);
  if (!redisCfg) {
    errors.push(
      "Durable BullMQ Redis configuration is required (BULLMQ_REDIS_URL, REDIS_URL, or UPSTASH_REDIS_REST_*)."
    );
  } else if (!redisCfg.tls && !env.REDIS_ALLOW_INSECURE_CLOUD) {
    warnings.push("BullMQ Redis connection is not using rediss:// TLS encryption.");
  }

  // AI auth configuration check (supports both GOOGLE_AI_API_KEY and Vertex WIF / ADC)
  if (env.AI_PROVIDER === "gemini") {
    const authMode = env.GEMINI_AUTH_MODE?.trim() || "auto";
    const hasApiKey = Boolean(env.GOOGLE_AI_API_KEY?.trim());
    const hasProject = Boolean(
      env.GOOGLE_CLOUD_PROJECT?.trim() ||
        env.GCP_PROJECT_ID?.trim() ||
        env.GOOGLE_VERTEX_PROJECT?.trim()
    );
    const hasWifVars = Boolean(hasProject && env.GOOGLE_WIF_AUDIENCE?.trim());
    const hasMi = detectAzureIdentityMode(env) !== "unconfigured";
    const vertexFlag = env.GOOGLE_GENAI_USE_VERTEXAI === "true";

    if (authMode === "api_key") {
      if (!hasApiKey) {
        errors.push("GEMINI_AUTH_MODE=api_key requires GOOGLE_AI_API_KEY.");
      }
    } else if (authMode === "vertex_wif") {
      if (!hasWifVars) {
        errors.push("Gemini Vertex WIF mode requires GOOGLE_CLOUD_PROJECT and GOOGLE_WIF_AUDIENCE.");
      }
      if (!hasMi) {
        errors.push(
          "Gemini Vertex WIF mode requires Azure Managed Identity (IDENTITY_ENDPOINT + IDENTITY_HEADER or AZURE_IMDS_ENABLED=true)."
        );
      }
    } else if (authMode === "vertex_adc") {
      if (!hasProject) {
        errors.push("Gemini Vertex ADC mode requires GOOGLE_CLOUD_PROJECT.");
      }
    } else if (authMode === "auto") {
      if (hasWifVars && hasMi) {
        // Hybrid/WIF auto mode resolves to vertex_wif cleanly
      } else if (vertexFlag) {
        if (!hasProject) {
          errors.push("Gemini Vertex ADC mode requires GOOGLE_CLOUD_PROJECT.");
        }
      } else if (!hasApiKey) {
        if (hasWifVars && !hasMi) {
          errors.push(
            "Gemini Vertex WIF mode requires Azure Managed Identity (IDENTITY_ENDPOINT + IDENTITY_HEADER or AZURE_IMDS_ENABLED=true) or GOOGLE_AI_API_KEY fallback."
          );
        } else {
          errors.push("AI_PROVIDER=gemini requires GOOGLE_AI_API_KEY or Vertex AI WIF configuration.");
        }
      }
    } else {
      errors.push(
        `GEMINI_AUTH_MODE must be one of "auto", "api_key", "vertex_wif", or "vertex_adc".`
      );
    }
  }

  // Stripe fail-closed invariant
  if (env.STRIPE_SECRET_KEY?.trim() && !env.STRIPE_WEBHOOK_SECRET?.trim()) {
    errors.push("STRIPE_WEBHOOK_SECRET must be set whenever STRIPE_SECRET_KEY is configured.");
  }

  // Google OAuth pair completeness
  if (Boolean(env.GOOGLE_CLIENT_ID?.trim()) !== Boolean(env.GOOGLE_CLIENT_SECRET?.trim())) {
    errors.push("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must either both be set or both omitted.");
  }

  if (
    Boolean(env.GOOGLE_DRIVE_CLIENT_ID?.trim()) !==
    Boolean(env.GOOGLE_DRIVE_CLIENT_SECRET?.trim())
  ) {
    errors.push(
      "GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET must either both be set or both omitted."
    );
  }

  return {
    ok: errors.length === 0,
    role,
    strict: true,
    errors,
    warnings,
  };
}
