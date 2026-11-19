import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AzureIdentityUnavailableError,
  detectAzureIdentityMode,
  getAzureManagedIdentityToken,
  resetAzureIdentityTokenCacheForTests,
} from "@/lib/cloud/azure-identity";
import {
  AzureKeyVaultError,
  fetchAzureKeyVaultSecret,
  getAzureKeyVaultConfigStatus,
  hydrateEnvFromAzureKeyVault,
  parseKeyVaultSecretMapping,
} from "@/lib/cloud/key-vault";
import {
  createGoogleWifAuthClient,
  getGoogleWifAccessToken,
  GoogleWifAuthError,
  isGoogleWifConfigured,
  resetGoogleWifTokenCacheForTests,
} from "@/lib/cloud/google-wif";

describe("Stage B — Azure Managed Identity, Key Vault & Google WIF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAzureIdentityTokenCacheForTests();
    resetGoogleWifTokenCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("Azure Managed Identity Token Client", () => {
    it("detects ACA IDENTITY_ENDPOINT, IMDS, and unconfigured modes accurately", () => {
      expect(detectAzureIdentityMode({})).toBe("unconfigured");
      expect(detectAzureIdentityMode({ AZURE_IMDS_ENABLED: "true" })).toBe("imds");
      expect(
        detectAzureIdentityMode({
          IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
          IDENTITY_HEADER: "local-header-secret",
        })
      ).toBe("aca_identity_endpoint");
    });

    it("uses ACA IDENTITY_ENDPOINT + X-IDENTITY-HEADER, caches tokens, and forwards user-assigned client_id", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "entra-token-abc",
          expires_in: 3600,
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const env: Record<string, string | undefined> = {
        IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
        IDENTITY_HEADER: "aca-secret-header",
        AZURE_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
      };

      const t1 = await getAzureManagedIdentityToken("https://vault.azure.net", { env });
      const t2 = await getAzureManagedIdentityToken("https://vault.azure.net", { env });

      expect(t1).toBe("entra-token-abc");
      expect(t2).toBe("entra-token-abc");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [calledUrl, init] = fetchMock.mock.calls[0]!;
      expect(String(calledUrl)).toContain("api-version=2019-08-01");
      expect(String(calledUrl)).toContain("resource=https%3A%2F%2Fvault.azure.net");
      expect(String(calledUrl)).toContain("client_id=11111111-2222-3333-4444-555555555555");
      expect((init as RequestInit).headers).toMatchObject({
        "X-IDENTITY-HEADER": "aca-secret-header",
      });
    });

    it("falls back to IMDS protocol with Metadata: true header and wraps errors as AzureIdentityUnavailableError", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "imds-token-xyz",
            expires_on: String(Math.floor(Date.now() / 1000) + 3600),
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
        });
      vi.stubGlobal("fetch", fetchMock);

      const env: Record<string, string | undefined> = { AZURE_IMDS_ENABLED: "true" };
      const token = await getAzureManagedIdentityToken("api://AzureADTokenExchange", { env });
      expect(token).toBe("imds-token-xyz");
      expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
        Metadata: "true",
      });

      resetAzureIdentityTokenCacheForTests();
      await expect(
        getAzureManagedIdentityToken("api://AzureADTokenExchange", { env })
      ).rejects.toBeInstanceOf(AzureIdentityUnavailableError);
    });

    it("fails closed with zero HTTP calls when Azure identity mode is unconfigured (AUD-04)", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        getAzureManagedIdentityToken("https://vault.azure.net", { env: {} })
      ).rejects.toBeInstanceOf(AzureIdentityUnavailableError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects non-local http metadata endpoints and embedded credentials without calling fetch (AUD-04)", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        getAzureManagedIdentityToken("https://vault.azure.net", {
          env: {
            IDENTITY_ENDPOINT: "http://169.254.170.2/v2/credentials",
            IDENTITY_HEADER: "hdr",
          },
        })
      ).rejects.toBeInstanceOf(AzureIdentityUnavailableError);

      await expect(
        getAzureManagedIdentityToken("https://vault.azure.net", {
          env: {
            AZURE_IMDS_ENDPOINT: "http://user:pass@127.0.0.1:42356/msi/token",
          },
        })
      ).rejects.toBeInstanceOf(AzureIdentityUnavailableError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("enforces redirect='error' on Managed Identity requests and fails closed on 3xx/redirected responses (NEW-05)", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 302,
          type: "basic",
          redirected: false,
        })
        .mockRejectedValueOnce(new TypeError("redirect mode is set to error"));
      vi.stubGlobal("fetch", fetchMock);

      const env: Record<string, string | undefined> = {
        IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
        IDENTITY_HEADER: "hdr",
      };

      await expect(
        getAzureManagedIdentityToken("https://vault.azure.net", { env })
      ).rejects.toBeInstanceOf(AzureIdentityUnavailableError);
      expect((fetchMock.mock.calls[0]![1] as RequestInit).redirect).toBe("error");

      resetAzureIdentityTokenCacheForTests();
      await expect(
        getAzureManagedIdentityToken("https://vault.azure.net", { env })
      ).rejects.toBeInstanceOf(AzureIdentityUnavailableError);
      expect((fetchMock.mock.calls[1]![1] as RequestInit).redirect).toBe("error");
    });
  });

  describe("Azure Key Vault Client & Env Hydration", () => {
    it("accurately distinguishes not_configured, misconfigured (bad URI or missing MI), and configured statuses (NEW-05)", () => {
      expect(getAzureKeyVaultConfigStatus({})).toBe("not_configured");
      expect(
        getAzureKeyVaultConfigStatus({ AZURE_KEY_VAULT_URI: "http://insecure.vault.azure.net" })
      ).toBe("misconfigured");
      expect(
        getAzureKeyVaultConfigStatus({ AZURE_KEY_VAULT_URI: "https://zenote-kv.vault.azure.net" })
      ).toBe("misconfigured");
      expect(
        getAzureKeyVaultConfigStatus({
          AZURE_KEY_VAULT_URI: "https://zenote-kv.vault.azure.net",
          AZURE_KEY_VAULT_ALLOW_IMDS_FALLBACK: "false",
        })
      ).toBe("misconfigured");
      expect(
        getAzureKeyVaultConfigStatus({
          AZURE_KEY_VAULT_URI: "https://zenote-kv.vault.azure.net",
          IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
          IDENTITY_HEADER: "hdr",
        })
      ).toBe("configured");
      expect(
        getAzureKeyVaultConfigStatus({
          AZURE_KEY_VAULT_URI: "https://zenote-kv.vault.azure.net",
          AZURE_IMDS_ENABLED: "true",
        })
      ).toBe("configured");
    });

    it("parses JSON and comma-separated secret maps and rejects unsafe secret names", () => {
      expect(
        parseKeyVaultSecretMapping(
          '{"DATABASE_URL":"zenote-db-url","NEXTAUTH_SECRET":"zenote-nextauth"}'
        )
      ).toEqual({
        DATABASE_URL: "zenote-db-url",
        NEXTAUTH_SECRET: "zenote-nextauth",
      });

      expect(
        parseKeyVaultSecretMapping("DATABASE_URL=zenote-db-url, REDIS_URL=zenote-redis")
      ).toEqual({
        DATABASE_URL: "zenote-db-url",
        REDIS_URL: "zenote-redis",
      });

      expect(() => parseKeyVaultSecretMapping('{"BAD":"../etc/passwd"}')).toThrow(
        AzureKeyVaultError
      );
    });

    it("fetches secrets via Managed Identity bearer token and hydrates missing env keys without overwriting set ones", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "kv-mi-token",
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            value: "hydrated-secret-value-123",
            id: "https://zenote-kv.vault.azure.net/secrets/STRIPE-SECRET/v1",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            value: "hydrated-secret-value-123",
            id: "https://zenote-kv.vault.azure.net/secrets/STRIPE-SECRET/v1",
          }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const targetEnv: Record<string, string | undefined> = {
        IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
        IDENTITY_HEADER: "hdr",
        AZURE_KEY_VAULT_URI: "https://zenote-kv.vault.azure.net",
        AZURE_KEY_VAULT_SECRET_MAP: "EXISTING_KEY=existing-sec,STRIPE_SECRET_KEY=STRIPE-SECRET",
        EXISTING_KEY: "already-populated",
      };

      const res = await hydrateEnvFromAzureKeyVault({ env: targetEnv });
      expect(res.attempted).toBe(true);
      expect(res.loadedKeys).toEqual(["STRIPE_SECRET_KEY"]);
      expect(res.skippedKeys).toEqual(["EXISTING_KEY"]);
      expect(targetEnv.STRIPE_SECRET_KEY).toBe("hydrated-secret-value-123");
      expect(targetEnv.EXISTING_KEY).toBe("already-populated");

      const direct = await fetchAzureKeyVaultSecret("STRIPE-SECRET", { env: targetEnv });
      expect(direct.version).toBe("v1");
      expect((fetchMock.mock.calls[1]![1] as RequestInit).redirect).toBe("error");

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 302,
        type: "basic",
        redirected: false,
      });
      await expect(
        fetchAzureKeyVaultSecret("STRIPE-SECRET", { env: targetEnv })
      ).rejects.toBeInstanceOf(AzureKeyVaultError);
    });
  });

  describe("Google Workload Identity Federation (STS + IAM Impersonation)", () => {
    it("exchanges Azure MI JWT via Google STS and optionally impersonates GCP Service Account", async () => {
      const env: Record<string, string | undefined> = {
        IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
        IDENTITY_HEADER: "hdr",
        GOOGLE_CLOUD_PROJECT: "zenote-gcp-prod",
        GOOGLE_CLOUD_LOCATION: "us-central1",
        GOOGLE_WIF_AUDIENCE:
          "//iam.googleapis.com/projects/12345/locations/global/workloadIdentityPools/azure/providers/aca",
        GOOGLE_WIF_SERVICE_ACCOUNT: "zenote-vertex@zenote-gcp-prod.iam.gserviceaccount.com",
      };

      expect(isGoogleWifConfigured(env)).toBe(true);

      const fetchMock = vi
        .fn()
        // 1. Azure MI token
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "azure-jwt-1", expires_in: 3600 }),
        })
        // 2. Google STS token exchange
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "sts-federated-token", expires_in: 3600 }),
        })
        // 3. IAM Credentials impersonation
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: "gcp-impersonated-vertex-token",
            expireTime: new Date(Date.now() + 3600_000).toISOString(),
          }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const authClient = createGoogleWifAuthClient({ env });
      const headers = await authClient.getRequestHeaders();
      expect(headers.get("Authorization")).toBe("Bearer gcp-impersonated-vertex-token");

      // Second call uses in-memory cache without repeating STS / IAM calls
      const cachedToken = await getGoogleWifAccessToken({ env });
      expect(cachedToken).toBe("gcp-impersonated-vertex-token");
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify STS form body contained WIF parameters
      const stsCall = fetchMock.mock.calls[1]!;
      expect(String(stsCall[0])).toBe("https://sts.googleapis.com/v1/token");
      expect(String((stsCall[1] as RequestInit).body)).toContain("subject_token=azure-jwt-1");
    });

    it("throws GoogleWifAuthError when Google STS rejects token exchange", async () => {
      const env: Record<string, string | undefined> = {
        IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
        IDENTITY_HEADER: "hdr",
        GOOGLE_CLOUD_PROJECT: "zenote-gcp-prod",
        GOOGLE_WIF_AUDIENCE: "//iam.googleapis.com/projects/12345/locations/global/workloadIdentityPools/p/providers/a",
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "azure-jwt-1", expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
        });
      vi.stubGlobal("fetch", fetchMock);

      await expect(getGoogleWifAccessToken({ env })).rejects.toBeInstanceOf(GoogleWifAuthError);
    });

    it("enforces HTTPS + redirect='error' on Google WIF STS and IAM endpoints (NEW-05)", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "azure-jwt-1", expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 302,
          type: "basic",
          redirected: false,
        });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        getGoogleWifAccessToken({
          env: {
            IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
            IDENTITY_HEADER: "hdr",
            GOOGLE_CLOUD_PROJECT: "zenote-gcp-prod",
            GOOGLE_WIF_AUDIENCE: "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/a",
            GOOGLE_STS_ENDPOINT: "http://evil.example.com/sts",
          },
        })
      ).rejects.toBeInstanceOf(GoogleWifAuthError);

      resetGoogleWifTokenCacheForTests();
      await expect(
        getGoogleWifAccessToken({
          env: {
            IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
            IDENTITY_HEADER: "hdr",
            GOOGLE_CLOUD_PROJECT: "zenote-gcp-prod",
            GOOGLE_WIF_AUDIENCE: "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/a",
          },
        })
      ).rejects.toBeInstanceOf(GoogleWifAuthError);
      expect((fetchMock.mock.calls[1]![1] as RequestInit).redirect).toBe("error");
    });
  });
});
