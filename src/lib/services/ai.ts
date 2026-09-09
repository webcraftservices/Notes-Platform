import type { AIService } from "./interfaces";
import { ServiceNotConfiguredError } from "./interfaces";

/**
 * AI_PROVIDER selects the backend explicitly ("anthropic" | "openai" |
 * "gemini"), matching .env.example. No default silently picks a provider
 * — if unset (or set to an unimplemented provider name), this throws a
 * clear configuration error naming exactly what to set, same pattern as
 * getSpeechService()/getEmbeddingService(). "Not configured" and
 * "actually failed" both surface as a real error to the caller (spec §92
 * — never fake success).
 *
 * Only "gemini" has a concrete implementation so far (ai-gemini.ts),
 * chosen as the initial default provider for cost reasons (see that
 * file's doc comment) — NOT hard-coded as the only option. Adding
 * "anthropic"/"openai" later means creating ai-anthropic.ts/ai-openai.ts
 * following the exact same shape and adding one more branch here — never
 * inlining a second provider's logic into this function. Streaming:
 * AIService.chat()'s `stream?: boolean` field and its Promise-based
 * (non-streaming) return type are left as-is per this phase's explicit
 * scope — see docs/ai-setup.md for the documented future upgrade path.
 */
const KEY_ENV_VAR_BY_PROVIDER: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_AI_API_KEY",
};

export function getAIService(): AIService {
  const provider = process.env.AI_PROVIDER;

  if (provider === "gemini") {
    const { createGeminiAIService } = require("./ai-gemini") as typeof import("./ai-gemini");
    return createGeminiAIService();
  }

  const keyEnvVar = provider ? KEY_ENV_VAR_BY_PROVIDER[provider] : undefined;

  throw new ServiceNotConfiguredError("AIService", [
    provider
      ? `no concrete AIService implementation exists yet for AI_PROVIDER="${provider}"`
      : 'AI_PROVIDER ("anthropic", "openai", or "gemini")',
    keyEnvVar ?? "a matching API key, once a provider implementation is added — see docs/ai-setup.md",
  ]);
}
