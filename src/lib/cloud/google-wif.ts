/**
 * Google Workload Identity Federation (WIF) Client for Vertex AI (Stage B).
 *
 * Exchanges an Azure Managed Identity JWT for a short-lived Google Cloud OAuth2
 * access token via Google Security Token Service (`sts.googleapis.com`), with
 * optional IAM Service Account impersonation (`iamcredentials.googleapis.com`).
 *
 * Compatible directly with `@google/genai`'s `googleAuthOptions.authClient`
 * (`new GoogleGenAI({ vertexai: true, project, location, googleAuthOptions: { authClient } })`),
 * requiring zero static GCP JSON key files in Azure Container Apps.
 *
 * Security & Reliability:
 *   - Caches the final GCP access token in memory with a 5-minute refresh buffer
 *     and coalesces concurrent exchanges.
 *   - Enforces bounded HTTP timeouts (`5000ms`).
 *   - Redacts sensitive fields from errors and never logs OAuth tokens.
 */

import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { redactSensitiveText } from "@/lib/queue/logger";
import {
  detectAzureIdentityMode,
  getAzureManagedIdentityToken,
  type EnvLike,
} from "@/lib/cloud/azure-identity";

const GOOGLE_STS_URL = "https://sts.googleapis.com/v1/token";
const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_AZURE_WIF_RESOURCE = "api://AzureADTokenExchange";
const DEFAULT_VERTEX_LOCATION = "us-central1";
const WIF_TIMEOUT_MS = 5_000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class GoogleWifAuthError extends Error {
  constructor(message: string) {
    super(redactSensitiveText(message));
    this.name = "GoogleWifAuthError";
  }
}

export interface GoogleWifConfiguration {
  project: string;
  location: string;
  audience: string;
  azureResource: string;
  serviceAccountEmail?: string;
}

export interface GoogleWifAccessTokenEntry {
  accessToken: string;
  expiresAtMs: number;
}

export type GoogleWifAuthClient = {
  getRequestHeaders(url?: string): Promise<Headers>;
};

const wifTokenCache = new Map<string, GoogleWifAccessTokenEntry>();
const wifInFlight = new Map<string, Promise<GoogleWifAccessTokenEntry>>();

export function resetGoogleWifTokenCacheForTests(): void {
  wifTokenCache.clear();
  wifInFlight.clear();
}

export function resolveGoogleWifConfiguration(
  env: EnvLike = process.env
): GoogleWifConfiguration | null {
  const project =
    env.GOOGLE_CLOUD_PROJECT?.trim() ||
    env.GCP_PROJECT_ID?.trim() ||
    env.GOOGLE_VERTEX_PROJECT?.trim() ||
    "";
  const location =
    env.GOOGLE_CLOUD_LOCATION?.trim() ||
    env.GCP_LOCATION?.trim() ||
    env.GOOGLE_VERTEX_LOCATION?.trim() ||
    DEFAULT_VERTEX_LOCATION;
  const audience = env.GOOGLE_WIF_AUDIENCE?.trim() || "";
  if (!project || !audience) {
    return null;
  }

  return {
    project,
    location,
    audience,
    azureResource: env.GOOGLE_WIF_AZURE_RESOURCE?.trim() || DEFAULT_AZURE_WIF_RESOURCE,
    serviceAccountEmail: env.GOOGLE_WIF_SERVICE_ACCOUNT?.trim() || undefined,
  };
}

export function isGoogleWifConfigured(env: EnvLike = process.env): boolean {
  const cfg = resolveGoogleWifConfiguration(env);
  if (!cfg) return false;
  return detectAzureIdentityMode(env) !== "unconfigured";
}

function normalizeEmailForImpersonation(email: string): string {
  return encodeURIComponent(email.trim());
}

function assertSafeGoogleEndpointUrl(rawUrl: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new GoogleWifAuthError(`${label} endpoint must be a valid URL.`);
  }

  if (parsed.username || parsed.password) {
    throw new GoogleWifAuthError(`${label} endpoint must not embed credentials.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  if (parsed.protocol === "https:") {
    return parsed;
  }
  if (parsed.protocol === "http:" && isLoopback) {
    return parsed;
  }
  throw new GoogleWifAuthError(`${label} endpoint must use https:// (or loopback http:// for local testing).`);
}

function assertNoRedirectResponse(response: Response, label: string): void {
  if (
    response.type === "opaqueredirect" ||
    response.redirected ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new GoogleWifAuthError(`${label} rejected unexpected HTTP redirect (HTTP ${response.status}).`);
  }
}

async function exchangeAzureTokenForGoogleStsToken(
  subjectToken: string,
  audience: string,
  env: EnvLike,
  nowMs: number
): Promise<{ accessToken: string; expiresAtMs: number }> {
  const stsUrl = assertSafeGoogleEndpointUrl(
    env.GOOGLE_STS_ENDPOINT?.trim() || GOOGLE_STS_URL,
    "Google STS"
  ).toString();
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience,
    scope: GOOGLE_CLOUD_PLATFORM_SCOPE,
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    subject_token: subjectToken,
  });

  let response: Response;
  try {
    response = await fetchWithTimeout(
      stsUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        redirect: "error",
      },
      { timeoutMs: WIF_TIMEOUT_MS, label: "Google STS token exchange" }
    );
  } catch (err) {
    throw new GoogleWifAuthError(
      `Failed to contact Google STS for Workload Identity Federation: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  assertNoRedirectResponse(response, "Google STS Workload Identity exchange");

  if (!response.ok) {
    throw new GoogleWifAuthError(
      `Google STS Workload Identity exchange rejected request (HTTP ${response.status}).`
    );
  }

  let data: { access_token?: unknown; expires_in?: unknown };
  try {
    data = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  } catch {
    throw new GoogleWifAuthError("Google STS returned invalid JSON response.");
  }

  if (typeof data.access_token !== "string" || data.access_token.trim().length === 0) {
    throw new GoogleWifAuthError("Google STS response did not include an access_token.");
  }

  const expiresInSec =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
      ? Math.max(60, data.expires_in)
      : 3600;

  return {
    accessToken: data.access_token,
    expiresAtMs: nowMs + expiresInSec * 1000,
  };
}

async function impersonateGoogleServiceAccount(
  stsAccessToken: string,
  serviceAccountEmail: string,
  env: EnvLike,
  nowMs: number
): Promise<{ accessToken: string; expiresAtMs: number }> {
  const iamBaseUrl = assertSafeGoogleEndpointUrl(
    env.GOOGLE_IAM_CREDENTIALS_ENDPOINT?.trim() || "https://iamcredentials.googleapis.com",
    "Google IAM Credentials"
  )
    .toString()
    .replace(/\/$/, "");
  const url = `${iamBaseUrl}/v1/projects/-/serviceAccounts/${normalizeEmailForImpersonation(serviceAccountEmail)}:generateAccessToken`;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stsAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scope: [GOOGLE_CLOUD_PLATFORM_SCOPE],
        }),
        redirect: "error",
      },
      { timeoutMs: WIF_TIMEOUT_MS, label: "Google IAM service account impersonation" }
    );
  } catch (err) {
    throw new GoogleWifAuthError(
      `Failed to contact Google IAM Credentials API: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  assertNoRedirectResponse(response, "Google IAM Credentials impersonation");

  if (!response.ok) {
    throw new GoogleWifAuthError(
      `Google IAM service account impersonation failed (HTTP ${response.status}).`
    );
  }

  let data: { accessToken?: unknown; expireTime?: unknown };
  try {
    data = (await response.json()) as { accessToken?: unknown; expireTime?: unknown };
  } catch {
    throw new GoogleWifAuthError("Google IAM Credentials API returned invalid JSON.");
  }

  if (typeof data.accessToken !== "string" || data.accessToken.trim().length === 0) {
    throw new GoogleWifAuthError(
      "Google IAM Credentials API response did not include an accessToken."
    );
  }

  let expiresAtMs = nowMs + 55 * 60 * 1000;
  if (typeof data.expireTime === "string" && data.expireTime.trim()) {
    const parsed = Date.parse(data.expireTime.trim());
    if (Number.isFinite(parsed)) {
      expiresAtMs = parsed;
    }
  }

  return {
    accessToken: data.accessToken,
    expiresAtMs,
  };
}

/**
 * Exchanges Azure Managed Identity credentials for a short-lived GCP access token
 * suitable for calling Vertex AI Gemini endpoints.
 */
export async function getGoogleWifAccessToken(
  options: {
    env?: EnvLike;
    nowMs?: () => number;
  } = {}
): Promise<string> {
  const env = options.env ?? process.env;
  const nowFn = options.nowMs ?? Date.now;
  const config = resolveGoogleWifConfiguration(env);
  if (!config) {
    throw new GoogleWifAuthError(
      "Google Workload Identity Federation requires GOOGLE_CLOUD_PROJECT and GOOGLE_WIF_AUDIENCE."
    );
  }

  const cacheKey = `${config.project}::${config.audience}::${config.serviceAccountEmail ?? "direct"}`;
  const cached = wifTokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - nowFn() > TOKEN_REFRESH_MARGIN_MS) {
    return cached.accessToken;
  }

  const pending = wifInFlight.get(cacheKey);
  if (pending) {
    const entry = await pending;
    return entry.accessToken;
  }

  const runExchange = async (): Promise<GoogleWifAccessTokenEntry> => {
    const azureJwt = await getAzureManagedIdentityToken(config.azureResource, {
      env,
      nowMs: nowFn,
    });
    const now = nowFn();
    const sts = await exchangeAzureTokenForGoogleStsToken(
      azureJwt,
      config.audience,
      env,
      now
    );

    if (config.serviceAccountEmail) {
      return impersonateGoogleServiceAccount(
        sts.accessToken,
        config.serviceAccountEmail,
        env,
        now
      );
    }
    return sts;
  };

  const promise = runExchange()
    .then((entry) => {
      wifTokenCache.set(cacheKey, entry);
      return entry;
    })
    .finally(() => {
      wifInFlight.delete(cacheKey);
    });

  wifInFlight.set(cacheKey, promise);
  const resolved = await promise;
  return resolved.accessToken;
}

/**
 * Returns an authClient object accepted by `@google/genai`'s
 * `googleAuthOptions.authClient`.
 */
export function createGoogleWifAuthClient(
  options: { env?: EnvLike; nowMs?: () => number } = {}
): GoogleWifAuthClient {
  return {
    async getRequestHeaders(): Promise<Headers> {
      const token = await getGoogleWifAccessToken(options);
      return new Headers({
        Authorization: `Bearer ${token}`,
      });
    },
  };
}
