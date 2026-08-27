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
 * matching the two options already named in .env.example. Phase 5 was
 * explicitly scoped as a provider-agnostic pass — no concrete
 * EmbeddingService implementation exists yet, and no embedding SDK is a
 * dependency of this project. This registry function always throws
 * ServiceNotConfiguredError, same as getSpeechService()/getStorageService()
 * did before their first concrete implementation existed.
 *
 * When a real provider is added later, it must follow the exact pattern
 * used by speech.ts: a new file (e.g. embedding-openai.ts) exporting a
 * class that implements EmbeddingService and asserts `dimensions === 1536`
 * at construction time, required()'d from a new branch here — never
 * inlined into this function.
 */
export function getEmbeddingService(): EmbeddingService {
  const provider = process.env.EMBEDDING_PROVIDER;

  throw new ServiceNotConfiguredError("EmbeddingService", [
    provider
      ? `no concrete EmbeddingService implementation exists yet for EMBEDDING_PROVIDER="${provider}"`
      : 'EMBEDDING_PROVIDER ("openai" or "google")',
    "a matching API key, once a provider implementation is added — see docs/ai-setup.md",
  ]);
}
