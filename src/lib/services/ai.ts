import type { AIService } from "./interfaces";
import { ServiceNotConfiguredError } from "./interfaces";

/**
 * AI_PROVIDER selects the backend explicitly ("anthropic" | "openai" |
 * "google"), matching .env.example. Phase 5 was explicitly scoped as a
 * provider-agnostic pass — no concrete AIService implementation exists
 * yet, and no AI SDK (Anthropic/OpenAI/Google) is a dependency of this
 * project. This registry function always throws ServiceNotConfiguredError,
 * same as getSpeechService()/getStorageService() did before their first
 * concrete implementation existed — chat and note-generation callers see
 * a real, actionable configuration error, never a fabricated response
 * (see CLAUDE.md's "never fake a feature" rule).
 *
 * When a real provider is added later, it must follow the exact pattern
 * used by speech.ts: a new file (e.g. ai-anthropic.ts) exporting a class
 * that implements AIService, required()'d from a new branch here — never
 * inlined into this function. Streaming: AIService.chat()'s `stream?:
 * boolean` field and its Promise-based (non-streaming) return type are
 * left as-is per this phase's explicit scope — see docs/ai-setup.md for
 * the documented future upgrade path.
 */
const KEY_ENV_VAR_BY_PROVIDER: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_AI_API_KEY",
};

export function getAIService(): AIService {
  const provider = process.env.AI_PROVIDER;
  const keyEnvVar = provider ? KEY_ENV_VAR_BY_PROVIDER[provider] : undefined;

  throw new ServiceNotConfiguredError("AIService", [
    provider
      ? `no concrete AIService implementation exists yet for AI_PROVIDER="${provider}"`
      : 'AI_PROVIDER ("anthropic", "openai", or "google")',
    keyEnvVar ?? "a matching API key, once a provider implementation is added — see docs/ai-setup.md",
  ]);
}
