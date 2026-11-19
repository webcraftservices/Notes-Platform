/**
 * Azure Managed Identity Token Client (Stage B).
 *
 * Acquires short-lived Microsoft Entra ID OAuth2 access tokens cleanly in
 * Node.js without pulling heavy Azure SDK dependency trees into the
 * Next.js standalone or worker bundles:
 *   1. Azure Container Apps / App Service Managed Identity endpoint
 *      (`IDENTITY_ENDPOINT` + `IDENTITY_HEADER`, api-version `2019-08-01`)
 *   2. Azure VM / AKS IMDS endpoint (`AZURE_IMDS_ENDPOINT` override or
 *      `http://169.254.169.254/metadata/identity/oauth2/token`, api-version
 *      `2018-02-01` + `Metadata: true`)
 *
 * Security & Reliability:
 *   - Supports both System-Assigned and User-Assigned Managed Identities
 *     (`AZURE_CLIENT_ID`).
 *   - Caches tokens in memory per `(resource, clientId)` with a 5-minute
 *     refresh margin and coalesces concurrent refresh calls.
 *   - Strictly redacts credentials/tokens/URLs from all errors and never logs
 *     raw bearer tokens.
 */

import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { redactSensitiveText } from "@/lib/queue/logger";

const DEFAULT_IMDS_TOKEN_URL = "http://169.254.169.254/metadata/identity/oauth2/token";
const TOKEN_TIMEOUT_MS = 5_000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type EnvLike = Record<string, string | undefined>;

export interface AzureManagedIdentityOptions {
  clientId?: string;
  env?: EnvLike;
  timeoutMs?: number;
  nowMs?: () => number;
}

export interface AzureTokenCacheEntry {
  accessToken: string;
  expiresAtMs: number;
}

export class AzureIdentityUnavailableError extends Error {
  constructor(message: string) {
    super(redactSensitiveText(message));
    this.name = "AzureIdentityUnavailableError";
  }
}

const tokenCache = new Map<string, AzureTokenCacheEntry>();
const inFlightRequests = new Map<string, Promise<AzureTokenCacheEntry>>();

export function resetAzureIdentityTokenCacheForTests(): void {
  tokenCache.clear();
  inFlightRequests.clear();
}

export type AzureIdentityEnvironmentMode = "aca_identity_endpoint" | "imds" | "unconfigured";

/**
 * Inspects environment variables to determine whether an Azure Managed
 * Identity token endpoint is explicitly provisioned (`IDENTITY_ENDPOINT` +
 * `IDENTITY_HEADER`) or configured for IMDS (`AZURE_IMDS_ENABLED=true` /
 * `AZURE_IMDS_ENDPOINT`).
 */
export function detectAzureIdentityMode(
  env: EnvLike = process.env
): AzureIdentityEnvironmentMode {
  const identityEndpoint = env.IDENTITY_ENDPOINT?.trim();
  const identityHeader = env.IDENTITY_HEADER?.trim();
  if (identityEndpoint && identityHeader) {
    return "aca_identity_endpoint";
  }
  if (
    env.AZURE_IMDS_ENABLED === "true" ||
    Boolean(env.AZURE_IMDS_ENDPOINT?.trim())
  ) {
    return "imds";
  }
  return "unconfigured";
}

function parseExpiresOnMs(
  payload: { expires_on?: unknown; expires_in?: unknown },
  nowMs: number
): number {
  if (typeof payload.expires_on === "number" && Number.isFinite(payload.expires_on)) {
    return payload.expires_on > 10_000_000_000 ? payload.expires_on : payload.expires_on * 1000;
  }
  if (typeof payload.expires_on === "string" && payload.expires_on.trim()) {
    const numeric = Number(payload.expires_on.trim());
    if (Number.isFinite(numeric)) {
      return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    }
    const parsedDate = Date.parse(payload.expires_on.trim());
    if (Number.isFinite(parsedDate)) {
      return parsedDate;
    }
  }
  if (
    (typeof payload.expires_in === "number" || typeof payload.expires_in === "string") &&
    Number.isFinite(Number(payload.expires_in))
  ) {
    return nowMs + Math.max(60, Number(payload.expires_in)) * 1000;
  }
  return nowMs + 55 * 60 * 1000;
}

const ALLOWED_LOCAL_HTTP_METADATA_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "169.254.169.254",
]);

function validateMetadataEndpointUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AzureIdentityUnavailableError("Azure Managed Identity endpoint URL is malformed.");
  }
  if (parsed.username || parsed.password) {
    throw new AzureIdentityUnavailableError(
      "Azure Managed Identity endpoint URL must not contain credentials."
    );
  }
  if (parsed.protocol === "https:") {
    return parsed;
  }
  if (parsed.protocol === "http:") {
    const hostname = parsed.hostname.toLowerCase();
    if (ALLOWED_LOCAL_HTTP_METADATA_HOSTS.has(hostname)) {
      return parsed;
    }
    throw new AzureIdentityUnavailableError(
      "Azure Managed Identity endpoint must use https:// for non-local hosts."
    );
  }
  throw new AzureIdentityUnavailableError(
    "Azure Managed Identity endpoint must use http or https protocol."
  );
}

async function fetchManagedIdentityToken(
  resource: string,
  options: AzureManagedIdentityOptions
): Promise<AzureTokenCacheEntry> {
  const env = options.env ?? process.env;
  const mode = detectAzureIdentityMode(env);
  if (mode === "unconfigured") {
    throw new AzureIdentityUnavailableError(
      "Azure Managed Identity endpoint is not configured."
    );
  }

  const nowFn = options.nowMs ?? Date.now;
  const clientId = options.clientId?.trim() || env.AZURE_CLIENT_ID?.trim() || undefined;
  const timeoutMs = options.timeoutMs ?? TOKEN_TIMEOUT_MS;

  const identityEndpoint = env.IDENTITY_ENDPOINT?.trim();
  const identityHeader = env.IDENTITY_HEADER?.trim();

  let requestUrl: URL;
  const headers: Record<string, string> = {};

  if (mode === "aca_identity_endpoint" && identityEndpoint && identityHeader) {
    requestUrl = validateMetadataEndpointUrl(identityEndpoint);
    requestUrl.searchParams.set("api-version", "2019-08-01");
    requestUrl.searchParams.set("resource", resource);
    if (clientId) {
      requestUrl.searchParams.set("client_id", clientId);
    }
    headers["X-IDENTITY-HEADER"] = identityHeader;
  } else {
    const imdsUrl = env.AZURE_IMDS_ENDPOINT?.trim() || DEFAULT_IMDS_TOKEN_URL;
    requestUrl = validateMetadataEndpointUrl(imdsUrl);
    requestUrl.searchParams.set("api-version", "2018-02-01");
    requestUrl.searchParams.set("resource", resource);
    if (clientId) {
      requestUrl.searchParams.set("client_id", clientId);
    }
    headers["Metadata"] = "true";
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      requestUrl.toString(),
      {
        method: "GET",
        headers,
        redirect: "error",
      },
      { timeoutMs, label: "Azure Managed Identity token" }
    );
  } catch (err) {
    throw new AzureIdentityUnavailableError(
      `Failed to contact Azure Managed Identity endpoint: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (
    response.type === "opaqueredirect" ||
    response.redirected ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new AzureIdentityUnavailableError(
      `Azure Managed Identity endpoint attempted an HTTP redirect (${
        response.status || "opaqueredirect"
      }).`
    );
  }

  if (!response.ok) {
    throw new AzureIdentityUnavailableError(
      `Azure Managed Identity endpoint returned HTTP ${response.status}.`
    );
  }

  let body: { access_token?: unknown; expires_on?: unknown; expires_in?: unknown };
  try {
    body = (await response.json()) as {
      access_token?: unknown;
      expires_on?: unknown;
      expires_in?: unknown;
    };
  } catch {
    throw new AzureIdentityUnavailableError(
      "Azure Managed Identity response was not valid JSON."
    );
  }

  if (typeof body.access_token !== "string" || body.access_token.trim().length === 0) {
    throw new AzureIdentityUnavailableError(
      "Azure Managed Identity response did not include an access_token."
    );
  }

  const now = nowFn();
  const expiresAtMs = parseExpiresOnMs(body, now);
  return {
    accessToken: body.access_token,
    expiresAtMs,
  };
}

/**
 * Retrieves an Azure Managed Identity access token for `resource`
 * (e.g. `"https://vault.azure.net"` or `"api://AzureADTokenExchange"`).
 */
export async function getAzureManagedIdentityToken(
  resource: string,
  options: AzureManagedIdentityOptions = {}
): Promise<string> {
  const cleanResource = resource.trim();
  if (!cleanResource) {
    throw new Error("Azure Managed Identity resource URI must not be empty.");
  }

  const env = options.env ?? process.env;
  const nowFn = options.nowMs ?? Date.now;
  const clientId = options.clientId?.trim() || env.AZURE_CLIENT_ID?.trim() || "default";
  const cacheKey = `${cleanResource}::${clientId}`;

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - nowFn() > REFRESH_MARGIN_MS) {
    return cached.accessToken;
  }

  const pending = inFlightRequests.get(cacheKey);
  if (pending) {
    const entry = await pending;
    return entry.accessToken;
  }

  const promise = fetchManagedIdentityToken(cleanResource, options)
    .then((entry) => {
      tokenCache.set(cacheKey, entry);
      return entry;
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey);
    });

  inFlightRequests.set(cacheKey, promise);
  const resolved = await promise;
  return resolved.accessToken;
}
