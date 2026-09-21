import OpenAI, { APIConnectionError, APIError } from "openai";
import type { EmbeddingCreateParams, CreateEmbeddingResponse } from "openai/resources/embeddings";
import type { EmbeddingResult, EmbeddingService } from "./interfaces";
import { ServiceNotConfiguredError, AIProviderUnavailableError } from "./interfaces";
import { EMBEDDING_DIMENSIONS } from "./embedding";

/**
 * The one OpenAI client surface this file actually touches, expressed as
 * our own minimal interface rather than `Pick<OpenAI, "embeddings">` — the
 * real `Embeddings` resource class has a private `_client` field, which
 * makes it (and therefore `Pick<OpenAI, "embeddings">`) impossible to
 * satisfy with a plain mock object in tests. A real `OpenAI` client still
 * satisfies this interface structurally, so createOpenAIEmbeddingService()
 * below needs no cast.
 */
interface EmbeddingsClient {
  embeddings: { create(body: EmbeddingCreateParams): Promise<CreateEmbeddingResponse> };
}

/**
 * text-embedding-3-small is 1536-dimensional by default (unlike
 * text-embedding-3-large, which defaults to 3072 and would need explicit
 * truncation) — see docs/ai-setup.md §1. `dimensions` is still passed
 * explicitly below so a future change to this constant, or to OpenAI's
 * default for this model, can't silently drift away from
 * MaterialChunk.embedding's fixed vector(1536) column without this file
 * (and its assertion in `embed()`) failing loudly first.
 */
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Phase 9.4 — explicit request bounds. The OpenAI SDK's defaults are a
 * 10-minute timeout and 2 automatic retries, and it retries EVERY 429 —
 * including `insufficient_quota`, which can never succeed on retry. Query
 * embedding sits on the user-facing chat path, so both are tightened:
 * 30s per attempt, one retry (the SDK retries connection errors, 408,
 * 409, 429 and 5xx; 4xx auth/validation errors are not retried).
 */
const OPENAI_EMBEDDING_TIMEOUT_MS = 30_000;
const OPENAI_EMBEDDING_MAX_RETRIES = 1;

/**
 * OpenAI accepts at most 2048 inputs and ~300k tokens per embeddings
 * request. Ingestion used to send every chunk of a document in ONE
 * request, so a large PDF could exceed that and fail outright. Requests
 * are split into fixed-size batches instead (~100 chunks × a few hundred
 * tokens each stays far below either limit).
 */
const OPENAI_EMBEDDING_BATCH_SIZE = 100;

/** A failure that means "OpenAI is unreachable/overloaded right now" (retry later), as opposed to "we sent it something wrong" or "we're not authorized". */
function isTransientOpenAIError(err: unknown): boolean {
  if (err instanceof APIConnectionError) return true; // includes APIConnectionTimeoutError
  if (err instanceof APIError) {
    return err.status === 408 || err.status === 429 || (typeof err.status === "number" && err.status >= 500);
  }
  return false;
}

/**
 * Real integration against OpenAI's embeddings API via the official `openai`
 * SDK (see docs/ai-setup.md §2 — this is the point where the project
 * stops being provider-agnostic, by design). Untestable against the live
 * API from this sandbox — api.openai.com isn't reachable here — the same
 * documented limitation as speech-openai.ts and the S3 storage backend;
 * this class is unit-tested with the SDK client mocked instead (see
 * __tests__/embedding-openai.test.ts).
 */
export class OpenAIEmbeddingService implements EmbeddingService {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly providerName = "openai";
  readonly modelName = OPENAI_EMBEDDING_MODEL;

  constructor(private readonly client: EmbeddingsClient) {}

  async embed(texts: string[]): Promise<EmbeddingResult> {
    if (texts.length === 0) return { vectors: [], totalTokens: null };

    const vectors: number[][] = [];
    let totalTokens: number | null = 0;

    for (let start = 0; start < texts.length; start += OPENAI_EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(start, start + OPENAI_EMBEDDING_BATCH_SIZE);
      const batchResult = await this.embedBatch(batch, start);
      vectors.push(...batchResult.vectors);
      // Null if ANY batch's usage was missing — a partial sum would
      // under-report real, billed tokens (spec §92: never estimate).
      totalTokens = totalTokens === null || batchResult.totalTokens === null ? null : totalTokens + batchResult.totalTokens;
    }

    return { vectors, totalTokens };
  }

  private async embedBatch(texts: string[], globalOffset: number): Promise<EmbeddingResult> {
    let response;
    try {
      response = await this.client.embeddings.create({
        model: OPENAI_EMBEDDING_MODEL,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
      });
    } catch (err) {
      const detail =
        err instanceof APIError && typeof err.status === "number" ? `(${err.status}) ${err.message}` : (err as Error).message;
      const message = `OpenAI embeddings request failed: ${detail}`;
      // Consistent with the Gemini provider (Phase 9.1): a transient
      // provider-side failure is AIProviderUnavailableError so callers can
      // answer 503 "try again" instead of a generic 500.
      throw isTransientOpenAIError(err) ? new AIProviderUnavailableError(message) : new Error(message);
    }

    if (response.data.length !== texts.length) {
      throw new Error(
        `OpenAI embeddings API returned ${response.data.length} embedding(s) for ${texts.length} input(s) — ` +
          "refusing to guess which input each vector belongs to."
      );
    }

    // The API documents results as returned in the same order as the
    // input, but each result also carries its own `index` — sorting by it
    // costs nothing and removes any dependency on that ordering guarantee
    // holding forever.
    const vectors = [...response.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);

    vectors.forEach((vector, i) => {
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `OpenAI returned a ${vector.length}-dimensional embedding for input ${globalOffset + i}, but ` +
            `MaterialChunk.embedding is a fixed vector(${EMBEDDING_DIMENSIONS}) column. Refusing to write an ` +
            "invalid vector to PostgreSQL — see docs/ai-setup.md before changing OPENAI_EMBEDDING_MODEL or its " +
            "requested `dimensions`."
        );
      }
    });

    // response.usage.total_tokens is OpenAI's real, billed token count for
    // this request — never estimated locally. Genuinely absent (not just
    // falsy/zero) only if the SDK's response shape changes; `null` in that
    // case rather than guessing (spec §92).
    const totalTokens = typeof response.usage?.total_tokens === "number" ? response.usage.total_tokens : null;

    return { vectors, totalTokens };
  }
}

export function createOpenAIEmbeddingService(): OpenAIEmbeddingService {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ServiceNotConfiguredError("OpenAI EmbeddingService", ["OPENAI_API_KEY"]);
  }
  return new OpenAIEmbeddingService(
    new OpenAI({ apiKey, timeout: OPENAI_EMBEDDING_TIMEOUT_MS, maxRetries: OPENAI_EMBEDDING_MAX_RETRIES })
  );
}
