import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeminiAIService,
  createGeminiAIService,
  resolveGeminiAuthConfig,
} from "@/lib/services/ai-gemini";
import { AIProviderUnavailableError, ServiceNotConfiguredError } from "@/lib/services/interfaces";
import { AzureIdentityUnavailableError } from "@/lib/cloud/azure-identity";
import { GoogleWifAuthError } from "@/lib/cloud/google-wif";

describe("Stage B — Gemini Auth Mode Resolution (API Key, Vertex WIF & Vertex ADC)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("defaults to api_key mode when GOOGLE_AI_API_KEY is set and Vertex vars are absent", () => {
    expect(resolveGeminiAuthConfig({ GOOGLE_AI_API_KEY: "test-api-key" })).toEqual({
      mode: "api_key",
    });
  });

  it("throws ServiceNotConfiguredError naming GOOGLE_AI_API_KEY when no auth is configured", () => {
    expect(() => resolveGeminiAuthConfig({})).toThrow(ServiceNotConfiguredError);
    expect(() => resolveGeminiAuthConfig({})).toThrow(/GOOGLE_AI_API_KEY/);
  });

  it("selects vertex_wif automatically when Vertex project + WIF audience + Azure MI exist", () => {
    const cfg = resolveGeminiAuthConfig({
      GOOGLE_CLOUD_PROJECT: "zenote-prod",
      GOOGLE_CLOUD_LOCATION: "europe-west4",
      GOOGLE_WIF_AUDIENCE: "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/az",
      IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
      IDENTITY_HEADER: "secret-hdr",
    });

    expect(cfg).toEqual({
      mode: "vertex_wif",
      project: "zenote-prod",
      location: "europe-west4",
    });
  });

  it("fails closed when GEMINI_AUTH_MODE=vertex_wif without Azure MI identity endpoint", () => {
    expect(() =>
      resolveGeminiAuthConfig({
        GEMINI_AUTH_MODE: "vertex_wif",
        GOOGLE_CLOUD_PROJECT: "zenote-prod",
        GOOGLE_WIF_AUDIENCE: "//iam.googleapis.com/...",
      })
    ).toThrow(ServiceNotConfiguredError);
  });

  it("constructs GeminiAIService cleanly in vertex_wif mode and vertex_adc mode", () => {
    vi.stubEnv("GEMINI_AUTH_MODE", "vertex_wif");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "zenote-prod");
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "us-central1");
    vi.stubEnv("GOOGLE_WIF_AUDIENCE", "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/az");
    vi.stubEnv("IDENTITY_ENDPOINT", "http://127.0.0.1:42356/msi/token");
    vi.stubEnv("IDENTITY_HEADER", "hdr");

    const wifService = createGeminiAIService();
    expect(wifService).toBeInstanceOf(GeminiAIService);
    expect(wifService.providerName).toBe("gemini");

    vi.stubEnv("GEMINI_AUTH_MODE", "vertex_adc");
    const adcService = createGeminiAIService();
    expect(adcService).toBeInstanceOf(GeminiAIService);
  });

  it("maps AzureIdentityUnavailableError and GoogleWifAuthError to AIProviderUnavailableError (503)", async () => {
    const s1 = new GeminiAIService({
      models: {
        generateContent: vi
          .fn()
          .mockRejectedValueOnce(new AzureIdentityUnavailableError("IMDS unreachable"))
          .mockRejectedValueOnce(new GoogleWifAuthError("STS unavailable")),
      },
    });

    await expect(
      s1.chat({ messages: [{ role: "user", content: "hello" }] })
    ).rejects.toBeInstanceOf(AIProviderUnavailableError);

    await expect(
      s1.chat({ messages: [{ role: "user", content: "hello" }] })
    ).rejects.toBeInstanceOf(AIProviderUnavailableError);
  });

  it("supports hybrid auto mode (vertex_wif when MI present, api_key fallback when MI absent and GOOGLE_GENAI_USE_VERTEXAI=false) (NEW-06)", () => {
    const hybridBase = {
      GEMINI_AUTH_MODE: "auto",
      GOOGLE_GENAI_USE_VERTEXAI: "false",
      GOOGLE_CLOUD_PROJECT: "zenote-prod",
      GOOGLE_CLOUD_LOCATION: "us-central1",
      GOOGLE_WIF_AUDIENCE: "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/az/providers/aca",
      GOOGLE_AI_API_KEY: "fallback-api-key",
    };

    // Without MI endpoint, hybrid auto falls cleanly back to GOOGLE_AI_API_KEY instead of vertex_adc
    expect(resolveGeminiAuthConfig(hybridBase)).toEqual({
      mode: "api_key",
    });

    // With MI endpoint provisioned (as inside ACA), hybrid auto selects vertex_wif
    expect(
      resolveGeminiAuthConfig({
        ...hybridBase,
        IDENTITY_ENDPOINT: "http://127.0.0.1:42356/msi/token",
        IDENTITY_HEADER: "secret-hdr",
      })
    ).toEqual({
      mode: "vertex_wif",
      project: "zenote-prod",
      location: "us-central1",
    });
  });

  it("constructs API-key GoogleGenAI client with vertexai=false even when GOOGLE_GENAI_USE_VERTEXAI=true (NEW-06)", () => {
    vi.stubEnv("GEMINI_AUTH_MODE", "api_key");
    vi.stubEnv("GOOGLE_GENAI_USE_VERTEXAI", "true");
    vi.stubEnv("GOOGLE_AI_API_KEY", "AIza-test-override-check");

    const svc = createGeminiAIService();
    expect(svc).toBeInstanceOf(GeminiAIService);
    expect((svc as unknown as { client?: { vertexai?: boolean } }).client?.vertexai).toBe(false);
  });
});
