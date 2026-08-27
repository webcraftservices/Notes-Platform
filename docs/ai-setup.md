# AI setup (Phase 5)

## Current state

As of Phase 5, this codebase has **no concrete AI or embedding provider
implementation**. This was an explicit, deliberate project decision — Phase
5 built the full RAG/chat/note-generation architecture behind the
`AIService`/`EmbeddingService` interfaces (`src/lib/services/interfaces.ts`)
without adding any AI SDK dependency, API key, or provider-specific code.

Concretely, right now:

- `getAIService()` (`src/lib/services/ai.ts`) always throws `ServiceNotConfiguredError`.
- `getEmbeddingService()` (`src/lib/services/embedding.ts`) always throws `ServiceNotConfiguredError`.
- AI Chat (Topic tabs, workspace Assistant page) shows a real "AI chat isn't
  configured yet" message rather than a fake reply.
- "Generate AI Notes" fails with a real, visible job error rather than
  writing fabricated note content.
- Indexing (`EMBEDDING` jobs, triggered automatically after a transcription
  succeeds) fails the same way — materials stay fully usable (upload,
  preview, manual notes) but aren't AI-searchable yet.

This is intentional (see `CLAUDE.md`'s "never fake a feature" rule), not a
bug or an oversight.

## Activating a provider later

### 1. Embedding dimension is fixed at 1536

`MaterialChunk.embedding` is a pgvector `vector(1536)` column, migrated in
Phase 1 — **before** any embedding provider was chosen. Whatever
`EmbeddingService` you implement **must** produce exactly 1536-dimensional
vectors:

- OpenAI `text-embedding-3-small` — 1536 dimensions by default. Works as-is.
- OpenAI `text-embedding-3-large` — 3072 dimensions by default; must be
  requested with `dimensions: 1536` to fit the existing column.
- Google/other providers — check their native output size; truncate or
  select a matching model variant if one exists.

If you want a provider whose natural output size isn't 1536, that is **not**
a registry-level swap — it requires a deliberate database migration:
change `MaterialChunk.embedding`'s column type to the new dimension, and
re-embed every existing chunk (the old vectors are meaningless post-migration).
Do not attempt to silently truncate/pad vectors to fit; that produces
embeddings that don't mean what the model intended and will quietly degrade
retrieval quality.

### 2. Add a concrete implementation file

Follow the pattern already established by `src/lib/services/speech.ts` +
`speech-openai.ts`/`speech-assemblyai.ts`:

1. Create `src/lib/services/embedding-openai.ts` (or `-google.ts`) exporting
   a class implementing `EmbeddingService`, including a `dimensions` field.
   Assert the dimension is 1536 at construction time so a misconfigured
   model fails loudly instead of silently writing wrong-sized vectors.
2. Create `src/lib/services/ai-anthropic.ts` (or `-openai.ts`/`-google.ts`)
   exporting a class implementing `AIService`.
3. In `embedding.ts`/`ai.ts`, add a branch for the provider (mirroring how
   `speech.ts` branches on `SPEECH_PROVIDER`) that `require()`s the new file
   instead of always throwing.
4. Add the corresponding npm dependency (`openai`, `@anthropic-ai/sdk`, or
   `@google/genai`) — this is the point where the project stops being
   provider-agnostic, by design.

### 3. Chunking: word-count, not token-count

`src/lib/chunking.ts` chunks by word count, not by a real tokenizer, and
`MaterialChunk.tokenCount` is populated with that word count as an
approximation (see the file's doc comment for the full list of documented
limitations). Once you pick a concrete AI/embedding provider, consider:

- Swapping in that provider's actual tokenizer (e.g. `tiktoken` for OpenAI)
  so `tokenCount` is accurate and chunk sizing can be tuned to the
  provider's real context window, rather than word-count as an ~1.2-1.5x
  approximation of true token count for English text.
- This is additive — `chunkText`/`chunkTranscriptSegments`'s signatures
  don't need to change, only their internal word-splitting logic would be
  replaced with real tokenization.

### 4. Streaming

`AIService.chat()` is currently Promise-based (`Promise<{ content,
tokensInput, tokensOutput }>`), not a stream. The AI Chat UI
(`src/components/ai/ai-chat-panel.tsx`) waits for the full response rather
than rendering tokens as they arrive. Adding real streaming later means:

- Changing `AIService.chat()`'s return type to an async iterable/stream (a
  breaking interface change — plan for it, don't bolt it on).
- Updating the messages route to pipe that stream through as an SSE/chunked
  HTTP response instead of a single JSON body.
- Updating `AIChatPanel` to append incrementally instead of `setMessages`
  after `await res.json()`.

This is explicitly out of scope for Phase 5 (see the project's Phase 5
approval constraints) and is documented here as known future work, not
implemented as a fake "typing effect" over a non-streaming call.

## What does NOT need to change

- Database schema (`AIConversation`, `AIMessage`, `MaterialChunk`, the
  `vector(1536)` column) — already correct, built in earlier phases.
- Retrieval (`src/lib/retrieval.ts`), scoping/authorization
  (`src/lib/access.ts`'s `getAccessibleAIScope`), the ingestion job
  (`src/lib/ingestion.ts`), or the note-generation job
  (`src/lib/note-generation.ts`) — all already call the interfaces
  correctly; they only fail today because nothing implements those
  interfaces yet.
- API routes (`/api/ai/conversations`, `/api/ai/conversations/[id]/messages`,
  `/api/materials/[id]/generate-notes`) or UI components — already wired to
  the real interfaces end to end.
