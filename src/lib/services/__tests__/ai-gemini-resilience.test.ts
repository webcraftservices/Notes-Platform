import { beforeEach, describe, expect, it, vi } from "vitest";

const ctor = vi.hoisted(() => ({ options: undefined as unknown }));
vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent: vi.fn() };
      constructor(options: unknown) {
        ctor.options = options;
      }
    },
  };
});

import { createGeminiAIService, GeminiAIService } from "@/lib/services/ai-gemini";

type HttpOptions = { timeout?: number; retryOptions?: { attempts?: number; httpStatusCodes?: number[] } };

describe("Gemini provider — Phase 9.4 timeout and retry bounds", () => {
  beforeEach(() => {
    process.env.GOOGLE_AI_API_KEY = "fake-key-not-a-real-key";
    ctor.options = undefined;
  });

  it("sets an explicit per-attempt timeout (the SDK default is none)", () => {
    createGeminiAIService();
    const http = (ctor.options as { httpOptions: HttpOptions }).httpOptions;
    expect(http.timeout).toBeGreaterThan(0);
    expect(http.timeout).toBeLessThanOrEqual(120_000);
  });

  it("retries at most once, and only for 5xx — never 429 (quota) or 4xx (validation/auth)", () => {
    createGeminiAIService();
    const retry = (ctor.options as { httpOptions: HttpOptions }).httpOptions.retryOptions!;
    expect(retry.attempts).toBeLessThanOrEqual(2);
    expect(retry.httpStatusCodes!.length).toBeGreaterThan(0);
    for (const status of retry.httpStatusCodes!) expect(status).toBeGreaterThanOrEqual(500);
    expect(retry.httpStatusCodes).not.toContain(429);
  });

  it("gives note generation (whole transcript in, long structured output) a longer per-request budget than the default", async () => {
    createGeminiAIService();
    const defaultTimeout = (ctor.options as { httpOptions: HttpOptions }).httpOptions.timeout!;
    const generateContent = vi.fn().mockResolvedValue({ text: "[]", usageMetadata: {} });
    const service = new GeminiAIService({ models: { generateContent } } as never);

    await service.generateNotes({ transcriptText: "t", templateKind: "lecture" });

    const params = generateContent.mock.calls[0]![0] as { config: { httpOptions?: { timeout?: number } } };
    expect(params.config.httpOptions?.timeout).toBeGreaterThan(defaultTimeout);
  });
});
