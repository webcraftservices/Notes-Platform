# Current Application Architecture

This document describes the system that exists in the repository now. The
repository source is authoritative; planned work is explicitly labelled.

## 1. High-level architecture

The application is one Next.js 14 App Router deployable unit:

```text
User
  -> Next.js pages and client components
  -> NextAuth session
  -> centralized access checks in src/lib/access.ts
  -> Workspace -> Subject -> Chapter -> Topic
  -> Materials, Notes, Audio, and Group collaboration
  -> StorageService and ProcessingJob
  -> extraction or transcription
  -> text/timestamp/page-aware chunks
  -> EmbeddingService
  -> PostgreSQL + pgvector MaterialChunk rows
  -> scoped semantic retrieval
  -> numbered RAG context
  -> AIService
  -> private AIConversation and AIMessage rows
  -> citations and authorized source navigation
```

Route handlers are the API. There is no separate backend service. Most API
routes are not protected only by middleware: they call `getSessionUser()` and
perform resource authorization themselves.

The main application areas are:

- `src/app/(auth)` — sign-in and sign-up.
- `src/app/(app)` — authenticated shell, dashboard, hierarchy, materials,
  assistant, groups, search, and settings.
- `src/app/api` — route handlers.
- `src/components` — feature and UI components.
- `src/lib` — access, validation, processing, retrieval, services, and pure
  domain helpers.

## 2. Authentication and authorization

NextAuth uses JWT sessions. Credentials authentication uses bcrypt and Zod
validation. Google OAuth is available for sign-in. Google Drive/Docs access
uses a separate connected-account OAuth flow rather than broad sign-in
scopes.

`src/lib/access.ts` is the centralized authorization layer:

- Workspace access requires workspace membership.
- Subject access checks the Subject’s workspace or group owner.
- Chapter access resolves its Subject and checks the Subject owner.
- Topic access resolves its Chapter and Subject and checks the Subject owner.
- Material access uses owner identity plus attached workspace/group access.
- Group access requires active group membership.
- Group management operations require the appropriate role.

Server components use `requireUser()` and `require*()` helpers that call
`notFound()` for missing or unauthorized resources. API routes use
`getSessionUser()`, `getAccessible*()` helpers, and shared `401`/`403`/`404`
response helpers.

### AI authorization invariant

AI scope input is resolved through `getAccessibleAIScope()`. The resolver
derives ownership from the actual Subject/Chapter/Topic rather than trusting
client-supplied owner IDs. Stored conversations are private to their
`userId`; they are not shared merely because their scope is shared.

Before a conversation message is retrieved or generated,
`getAccessibleAIConversation()` re-authorizes the stored hierarchy/group/
workspace scope. The message route then resolves that scope again before
calling retrieval. Group knowledge is shared with authorized group members,
but each member’s AI conversation history remains private.

## 3. Hierarchy and material scope

The hierarchy is:

```text
Workspace
  -> Subject
    -> Chapter
      -> Topic
```

Subjects belong to exactly one owner scope: a personal Workspace or a Group.
Chapters belong to Subjects and Topics belong to Chapters.

Material hierarchy IDs are intentionally denormalized. The current invariant
is:

```text
Subject material: subjectId = S
Chapter material: subjectId = S, chapterId = C
Topic material:   subjectId = S, chapterId = C, topicId = T
```

Unorganized materials use their workspace/group ownership without a narrower
hierarchy attachment. `resolveMaterialScope()` derives ancestor IDs from the
authorized Topic or Chapter and prevents mismatched client-supplied
hierarchy IDs from being written.

This denormalization is required by scoped retrieval:

- `{ subjectId: S }` includes direct Subject, descendant Chapter, and
  descendant Topic materials.
- `{ chapterId: C }` includes direct Chapter and descendant Topic materials.
- `{ topicId: T }` includes only Topic T materials.

Retrieval intentionally uses these indexed scalar IDs rather than relational
`OR` queries.

## 4. Materials, storage, and processing

Materials support links, images, text, PDFs, DOCX, PPTX, audio, video, and
Google-imported sources. Material records contain ownership/scope IDs,
metadata, MIME type, storage key, source URL/external reference, processing
status, extracted text, extracted pages, and soft-delete/archive fields.

`StorageService` is an interface with a registry:

- `LocalStorageService` stores files under `STORAGE_LOCAL_DIR` (default
  `.storage`).
- `S3StorageService` uses AWS SDK v3 and presigned upload URLs.
- Uploads can go directly to S3.
- Reads for both backends are proxied through `/api/storage/read`, which
  rechecks session/material access and avoids browser CORS failures.

Material completion extracts non-AI metadata where supported, including PDF
page count, image dimensions, and audio/video duration. Processing jobs are
created for transcription, document extraction, embedding, and related
operations. Jobs currently execute fire-and-forget in the persistent Node
process; a durable queue/worker is future work.

### Document extraction

`DocumentProcessingService` currently has a local implementation:

- PDF uses PDF.js and returns flattened text plus ordered page text.
- DOCX uses Mammoth and returns flattened text; DOCX has no file-format page
  model in this implementation.
- PPTX reads slide XML and returns flattened text plus slide-number provenance.

The extracted result is stored in `Material.extractedText` and, for PDF/PPTX,
`Material.extractedPages`. Empty text is an honest successful no-op for a
source without a text layer. Corrupt/unreadable input creates a failed
processing job without pretending the material was understood.

## 5. Audio and transcription

The audio path is:

```text
Record or select audio/video
  -> upload through use-material-upload
  -> StorageService
  -> ProcessingJob(TRANSCRIPTION)
  -> SpeechService
  -> Transcript
  -> TranscriptSegment rows
  -> material/transcript UI and AudioPlayer
```

The browser recorder uses MediaRecorder, device selection, a real Web Audio
level meter, pause/resume/cancel, and WebM duration repair. Transcription
jobs resolve bytes from the active storage backend and write real provider
output.

`SpeechService` has two real implementations:

- AssemblyAI: upload, create, poll, retrieve, timestamps, and speaker labels
  where diarization is enabled. Requests use `universal-2`.
- OpenAI Whisper: `verbose_json` segment timestamps and a hard 25 MB request
  guard; it does not invent speaker labels.

Transcript segments retain `startSeconds` and `endSeconds`. Transcript
clicks seek the AudioPlayer through its imperative playback handle. These
timestamps also flow into RAG chunk provenance and AI citations.

## 6. Provider architecture

Provider SDKs are imported only by concrete files under
`src/lib/services`. Callers depend on interfaces and registry functions.
Missing configuration raises `ServiceNotConfiguredError`; the application
does not return fake provider results.

### AI generation

- Interface: `AIService`.
- Registry: `getAIService()`.
- Active concrete provider: Gemini.
- Model: `gemini-2.5-flash-lite`.
- Configuration: `AI_PROVIDER=gemini`, `GOOGLE_AI_API_KEY`.
- Gemini supports chat and structured note generation.
- Chat is promise-based and non-streaming.

The registry accepts `anthropic` and `openai` as future provider names, but
no concrete implementation for those AI providers currently exists.
Anthropic is therefore optional architecture, not an active integration.

### Embeddings

- Interface: `EmbeddingService`.
- Dimension contract: exactly `1536`.
- Concrete implementation: `OpenAIEmbeddingService`.
- Model: `text-embedding-3-small`.
- Requested dimension: `1536`.

The current `getEmbeddingService()` registry intentionally still throws
`ServiceNotConfiguredError` rather than dispatching to the OpenAI class.
This means the concrete provider is present and tested in isolation, but a
configured end-to-end embedding/RAG deployment is not yet activated in this
checkout. A provider with a different dimension would require a schema
migration and re-embedding all existing chunks.

### Other services

The same interface/registry pattern is used for storage, speech, and local
document processing. Vision is an interface only; no concrete vision provider
is currently registered.

## 7. RAG and semantic retrieval

The RAG pipeline is:

```text
Material transcript/extracted text/pages
  -> chunking
  -> EmbeddingService
  -> MaterialChunk rows
  -> pgvector cosine-distance search
  -> scoped material IDs
  -> numbered context block
  -> AIService.chat()
```

`chunking.ts` uses deterministic word windows with overlap. Transcript
chunks preserve timestamp spans. PDF/PPTX page chunks preserve
`pageNumber`. Plain extracted text chunks have no page/timestamp provenance.

`runEmbeddingJob()` chooses source text in this order:

1. Ready transcript segments.
2. Parsed extracted pages.
3. Flattened extracted text.

It writes vector values with parameterized raw SQL because Prisma represents
`MaterialChunk.embedding` as `Unsupported("vector(1536)")`. Other chunk fields
remain normal Prisma fields. A dimension mismatch fails loudly before writes.

`retrieveRelevantChunks()` first queries the authorized Material rows using
`materialWhereForScope()`, excludes soft-deleted materials, then restricts
the pgvector query to those material IDs. If no indexed chunks exist, it
returns an empty result without calling the embedding service.

### Scope behavior

- Subject scope retrieves direct Subject materials and all Chapter/Topic
  descendants through the denormalized `subjectId`.
- Chapter scope retrieves direct Chapter materials and Topic descendants
  through the denormalized `chapterId`.
- Topic scope retrieves only that Topic’s materials.
- Bare group scope retrieves group-owned shared materials by `groupId`.
- Bare workspace scope retrieves workspace materials by `workspaceId`.

## 8. AI chat, conversations, and citations

`AIChatPanel` is used by:

- workspace Assistant (`/assistant`);
- Topic AI Chat;
- Subject AI Chat;
- Chapter AI Chat;
- group AI Assistant.

`/api/ai/conversations` validates scope input, authorizes it, and gets or
creates a private conversation for the user and scope. A separate POST
starts a new conversation.

`/api/ai/conversations/[conversationId]/messages`:

1. authenticates the caller;
2. validates message content;
3. re-authorizes the private conversation and stored scope;
4. retrieves scoped chunks;
5. builds numbered RAG context;
6. calls `AIService.chat()`;
7. persists the user and assistant messages in one transaction only after a
   successful provider call.

An assistant message stores `sources` JSON entries with `materialId`, a
human-readable label, and optional `page` or `timestampSeconds`.
`materialSourceHref()` links citations to `/materials/[materialId]` with
`?page=` or `?t=`. The material page and preview enforce authorization
again. PDF viewers can open the requested page; audio/video playback can
seek to the requested timestamp. PPTX preview supports slide rendering, while
its citation currently links to the authorized material page and preserves
the page/slide provenance in the citation label.

No streaming, suggested prompts, regenerate action, or AI answer editing is
currently implemented.

## 9. Group collaboration

Group roles are:

```text
OWNER, ADMIN, MEMBER, VIEWER
```

Groups have membership, invitations, role enforcement, subjects, materials,
activity entries, and notifications. Subjects are either Workspace-owned or
Group-owned, never both. Group-owned material scope follows the owning
Subject/Chapter/Topic.

Group knowledge is shared with authorized members. AI conversations remain
private per user even when their retrieval scope is the same group.
Invitation tokens, email validation, status transitions, and membership
authorization are checked through the centralized access and invitation
helpers.

## 10. Database and migrations

The database is PostgreSQL through Prisma. The `pgvector` extension stores
`MaterialChunk.embedding` as `vector(1536)`.

Important current models include:

- `User`, `Profile`, `Subscription`, `Workspace`, `WorkspaceMember`;
- `Subject`, `Chapter`, `Topic`;
- `Material`, `MaterialChunk`;
- `Transcript`, `TranscriptSegment`;
- `AIConversation`, `AIMessage`;
- `ProcessingJob`;
- `Group`, `GroupMember`, `GroupInvitation`, `ActivityLog`,
  `Notification`;
- `ConnectedAccount` for Google connections;
- `Note`, `NoteBlock`, `NoteVersion`;
- plan and usage-supporting models.

Flashcard and quiz models remain schema scaffolding. `UsageRecord` exists as
future ledger scaffolding; current storage and recording usage are computed
from live Material/subscription aggregates.

Tracked migrations include the initial schema, nullable Subject workspace
ownership for groups, group invitation/activity/notification changes,
`Material.extractedText`, and `Material.extractedPages`.

## 11. External integrations

Implemented integrations:

- Gemini generation through `@google/genai`.
- OpenAI embeddings implementation through the OpenAI SDK, not yet registry
  activated.
- AssemblyAI speech-to-text.
- OpenAI Whisper speech-to-text.
- Google OAuth sign-in.
- Separate Google Drive/Docs OAuth connection with signed state and encrypted
  stored tokens.
- Google Drive v3 REST browsing and import.
- Google Docs `text/plain` export.
- Local PDF/DOCX/PPTX extraction.
- Optional S3-compatible object storage.

Google-native Slides are rejected by the importer; PPTX files are supported.
Drive browsing is currently flat and there is no continuous synchronization.

## 12. Security

Current security mechanisms include:

- NextAuth session authentication.
- Bcrypt password hashing.
- Session checks in route handlers, not only middleware.
- Centralized access resolution for every protected resource.
- Scope authorization before AI conversation creation and retrieval.
- Re-authorization of stored conversation scopes on use.
- Parameterized Prisma/raw SQL values for material-ID and vector queries.
- Signed Google OAuth state.
- Encrypted connected-account tokens.
- Invitation token/email/status validation.
- No client-trusted owner or group IDs for hierarchy scope resolution.

Distributed rate limiting, database row-level security, comprehensive
observability, and production queue hardening remain future work.

## 13. Testing

The project uses Vitest with Node environment and tests live beside the
covered code in `__tests__` folders. Existing coverage includes:

- validation schemas;
- chunking and page/timestamp provenance;
- document extraction and extraction idempotency guards;
- mocked Gemini and OpenAI embedding provider behavior;
- MIME, material links, styles, invitations, groups, and crypto;
- retrieval scope selection and Subject/Chapter descendant fixtures;
- AI scope and stored-conversation authorization;
- audio-player utility behavior.

The suite does not make live cloud-provider calls and does not replace
database-backed integration testing. Run:

```text
npm run test
npm run lint
npm run typecheck
```

## 14. Known limitations and next work

- Embedding provider registry activation is still required for real indexed
  RAG in this checkout.
- AI chat is non-streaming and has limited UX actions.
- No AI summaries, suggested prompts, generated questions, or tutor feature.
- Processing is fire-and-forget and needs a persistent Node runtime.
- S3 read proxy buffers objects instead of true byte-range streaming.
- No OCR for scanned/image-only documents.
- No continuous Drive synchronization.
- Google-native Slides are not imported.
- No distributed rate limiting, usage ledger, or production observability.
- Flashcards, quizzes, and broader Phase 8 study tools are not implemented.
