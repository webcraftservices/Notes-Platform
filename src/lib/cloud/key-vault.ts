/**
 * Azure Key Vault Secret Resolver & Startup Hydration Helper (Stage B).
 *
 * In Azure Container Apps, native Container App Key Vault secret references
 * inject secrets directly into container environment variables at startup.
 * This module provides:
 *   1. Direct REST secret resolution using Azure Managed Identity
 *      (`https://vault.azure.net`) for workflows or runtime secret rotation
 *      without pulling `@azure/keyvault-secrets` SDK dependencies.
 *   2. Optional startup environment hydration (`hydrateEnvFromAzureKeyVault`)
 *      driven by `AZURE_KEY_VAULT_URI` + `AZURE_KEY_VAULT_SECRET_MAP`.
 *   3. Safe, secret-free configuration inspection (`getAzureKeyVaultConfigStatus`).
 */

import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { redactSensitiveText } from "@/lib/queue/logger";
import {
  detectAzureIdentityMode,
  getAzureManagedIdentityToken,
  type EnvLike,
} from "@/lib/cloud/azure-identity";

const KEY_VAULT_RESOURCE = "https://vault.azure.net";
const KEY_VAULT_API_VERSION = "7.4";
const KEY_VAULT_TIMEOUT_MS = 5_000;
const SECRET_NAME_RE = /^[A-Za-z0-9-]+$/;

export class AzureKeyVaultError extends Error {
  constructor(message: string) {
    super(redactSensitiveText(message));
    this.name = "AzureKeyVaultError";
  }
}

export interface KeyVaultSecretResult {
  name: string;
  value: string;
  version?: string;
}

export type KeyVaultConfigStatus = "not_configured" | "configured" | "misconfigured";

export function parseAzureKeyVaultUri(rawUri: string | undefined): URL | null {
  const trimmed = rawUri?.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  return parsed;
}

export function getAzureKeyVaultConfigStatus(
  env: EnvLike = process.env
): KeyVaultConfigStatus {
  const rawUri = env.AZURE_KEY_VAULT_URI?.trim();
  if (!rawUri) return "not_configured";
  const parsed = parseAzureKeyVaultUri(rawUri);
  if (!parsed) return "misconfigured";
  if (
    detectAzureIdentityMode(env) === "unconfigured" &&
    env.AZURE_KEY_VAULT_ALLOW_IMDS_FALLBACK !== "true"
  ) {
    return "misconfigured";
  }
  return "configured";
}

/**
 * Parses `AZURE_KEY_VAULT_SECRET_MAP` supporting either:
 *   - JSON object: `{"DATABASE_URL":"zenote-database-url","NEXTAUTH_SECRET":"zenote-nextauth-secret"}`
 *   - Comma/semicolon pairs: `DATABASE_URL=zenote-database-url,NEXTAUTH_SECRET=zenote-nextauth-secret`
 */
export function parseKeyVaultSecretMapping(rawMap: string | undefined): Record<string, string> {
  const trimmed = rawMap?.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new AzureKeyVaultError("AZURE_KEY_VAULT_SECRET_MAP is not valid JSON.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AzureKeyVaultError("AZURE_KEY_VAULT_SECRET_MAP must be a JSON object.");
    }
    const result: Record<string, string> = {};
    for (const [envKey, secretName] of Object.entries(parsed)) {
      if (typeof secretName !== "string" || !SECRET_NAME_RE.test(secretName.trim())) {
        throw new AzureKeyVaultError(
          `Invalid Key Vault secret name mapped for environment variable "${envKey}".`
        );
      }
      if (!envKey.trim()) continue;
      result[envKey.trim()] = secretName.trim();
    }
    return result;
  }

  const result: Record<string, string> = {};
  for (const part of trimmed.split(/[;,]/)) {
    const entry = part.trim();
    if (!entry) continue;
    const eqIndex = entry.indexOf("=");
    if (eqIndex <= 0) {
      throw new AzureKeyVaultError(
        "AZURE_KEY_VAULT_SECRET_MAP entries must use ENV_VAR=secret-name syntax."
      );
    }
    const envKey = entry.slice(0, eqIndex).trim();
    const secretName = entry.slice(eqIndex + 1).trim();
    if (!SECRET_NAME_RE.test(secretName)) {
      throw new AzureKeyVaultError(
        `Invalid Key Vault secret name mapped for environment variable "${envKey}".`
      );
    }
    result[envKey] = secretName;
  }
  return result;
}

/**
 * Fetches one secret from Azure Key Vault over HTTPS using Managed Identity.
 */
export async function fetchAzureKeyVaultSecret(
  secretName: string,
  options: {
    vaultUri?: string;
    version?: string;
    env?: EnvLike;
    timeoutMs?: number;
  } = {}
): Promise<KeyVaultSecretResult> {
  const env = options.env ?? process.env;
  const cleanName = secretName.trim();
  if (!SECRET_NAME_RE.test(cleanName)) {
    throw new AzureKeyVaultError(
      "Azure Key Vault secret names must only contain letters, numbers, and hyphens."
    );
  }

  const parsedVault = parseAzureKeyVaultUri(options.vaultUri ?? env.AZURE_KEY_VAULT_URI);
  if (!parsedVault) {
    throw new AzureKeyVaultError(
      "AZURE_KEY_VAULT_URI must be set to a valid https:// Azure Key Vault URI."
    );
  }

  const basePath = parsedVault.origin;
  const versionSuffix = options.version?.trim()
    ? `/${encodeURIComponent(options.version.trim())}`
    : "";
  const url = `${basePath}/secrets/${encodeURIComponent(cleanName)}${versionSuffix}?api-version=${KEY_VAULT_API_VERSION}`;

  const token = await getAzureManagedIdentityToken(KEY_VAULT_RESOURCE, {
    env,
    timeoutMs: options.timeoutMs ?? KEY_VAULT_TIMEOUT_MS,
  });

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "error",
      },
      {
        timeoutMs: options.timeoutMs ?? KEY_VAULT_TIMEOUT_MS,
        label: "Azure Key Vault secret fetch",
      }
    );
  } catch (err) {
    throw new AzureKeyVaultError(
      `Failed to fetch secret "${cleanName}" from Azure Key Vault: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (
    response.type === "opaqueredirect" ||
    response.redirected ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new AzureKeyVaultError(
      `Azure Key Vault rejected request for secret "${cleanName}" (unexpected redirect).`
    );
  }

  if (!response.ok) {
    throw new AzureKeyVaultError(
      `Azure Key Vault rejected request for secret "${cleanName}" (HTTP ${response.status}).`
    );
  }

  let data: { value?: unknown; id?: unknown };
  try {
    data = (await response.json()) as { value?: unknown; id?: unknown };
  } catch {
    throw new AzureKeyVaultError(
      `Azure Key Vault returned invalid JSON for secret "${cleanName}".`
    );
  }

  if (typeof data.value !== "string") {
    throw new AzureKeyVaultError(
      `Azure Key Vault response for secret "${cleanName}" did not contain a string value.`
    );
  }

  const versionMatch =
    typeof data.id === "string" ? data.id.match(/\/secrets\/[^/]+\/([^/?#]+)/) : null;

  return {
    name: cleanName,
    value: data.value,
    version: versionMatch?.[1],
  };
}

export interface HydrateKeyVaultResult {
  attempted: boolean;
  loadedKeys: string[];
  skippedKeys: string[];
}

/**
 * Resolves configured Key Vault secret mappings into `env` at runtime startup.
 * Safe no-op when `AZURE_KEY_VAULT_URI` or `AZURE_KEY_VAULT_SECRET_MAP` is unset.
 * Never logs secret values.
 */
export async function hydrateEnvFromAzureKeyVault(
  options: {
    env?: EnvLike;
    overrideExisting?: boolean;
  } = {}
): Promise<HydrateKeyVaultResult> {
  const env = options.env ?? process.env;
  const rawUri = env.AZURE_KEY_VAULT_URI?.trim();
  const rawMap = env.AZURE_KEY_VAULT_SECRET_MAP?.trim();

  if (!rawUri || !rawMap) {
    return { attempted: false, loadedKeys: [], skippedKeys: [] };
  }

  const mapping = parseKeyVaultSecretMapping(rawMap);
  const loadedKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const [envKey, secretName] of Object.entries(mapping)) {
    const existing = env[envKey];
    if (!options.overrideExisting && typeof existing === "string" && existing.trim().length > 0) {
      skippedKeys.push(envKey);
      continue;
    }

    const secret = await fetchAzureKeyVaultSecret(secretName, { env });
    env[envKey] = secret.value;
    loadedKeys.push(envKey);
  }

  return {
    attempted: true,
    loadedKeys,
    skippedKeys,
  };
}
