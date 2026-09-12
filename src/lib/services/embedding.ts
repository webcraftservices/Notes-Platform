import type { EmbeddingService } from "./interfaces";
import { ServiceNotConfiguredError } from "./interfaces";

/**
 * MaterialChunk.embedding is a pgvector `vector(1536)` column (see
 * prisma/schema.prisma), migrated in Phase 1 before any embedding
 * provider was chosen. This constant is the single source of truth for
 * that number — code that builds or validates embeddings should import
 * it rather than hardcoding 1536 a second time.
 *
 * IMPORTANT: any concrete EmbeddingService added later MUST produce
 * exactly this many dimensions per vector (e.g. OpenAI's
 * text-embedding-3-small at its default size, or text-embedding-3-large
 * explicitly truncated to 1536 via its `dimensions` request param). A
 * provider that produces a different size is NOT a registry-level swap —
 * it requires a deliberate schema migration (change the column's vector
 * dimension and re-embed every existing MaterialChunk). See
 * docs/ai-setup.md.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * EMBEDDING_PROVIDER selects the backend explicitly ("openai" | "google"),
 * matching the two options already named in .env.example. Only "openai"
 * has a concrete implementation so far (embedding-openai.ts) — chosen as
 * the default in .env.example alongside AI_PROVIDER=gemini so ingestion
 * and RAG retrieval work out of the box with a single OPENAI_API_KEY,
 * without requiring OpenAI as the text-generation provider too.
 *
 * Same lazy-`require()` + factory pattern as getAIService()/getSpeechService()
 * — a real provider file exports a `createXxxService()` factory that reads
 * its own API key and throws ServiceNotConfiguredError itself if missing,
 * so this registry function never inlines provider-specific config/auth
 * logic. Adding "google" later means creating embedding-google.ts
 * following the exact same shape (implementing EmbeddingService, including
 * `providerName`/`modelName` and returning real `totalTokens` — see
 * interfaces.ts) and adding one more branch here — never inlined into
 * this function.
 */
export function getEmbeddingService(): EmbeddingService {
  const provider = process.env.EMBEDDING_PROVIDER;

  if (provider === "openai") {
    const { createOpenAIEmbeddingService } = require("./embedding-openai") as typeof import("./embedding-openai");
    return createOpenAIEmbeddingService();
  }

  throw new ServiceNotConfiguredError("EmbeddingService", [
    provider
      ? `no concrete EmbeddingService implementation exists yet for EMBEDDING_PROVIDER="${provider}"`
      : 'EMBEDDING_PROVIDER ("openai" or "google")',
    "OPENAI_API_KEY, once EMBEDDING_PROVIDER is set to \"openai\" — see docs/ai-setup.md",
  ]);
}
