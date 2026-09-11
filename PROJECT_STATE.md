# Project State

Last reconciled against the repository at commit `22a856a` and the current
working tree on 2026-09-11.

`PROJECT_STATE.md` is the canonical state document. There is no separate
root-level `STATE.md`.

## Phase status

| Phase | Status | Current state |
|---|---|---|
| Phase 1 — Architecture, auth, database | COMPLETE | Next.js, Prisma/PostgreSQL, pgvector, NextAuth, validation, and the base schema are in place. |
| Phase 2 — Dashboard and hierarchy | COMPLETE | Workspace → Subject → Chapter → Topic pages, CRUD, notes, and navigation are implemented. |
| Phase 3 — Materials, storage, and notes | COMPLETE | Uploads, links, organization, previews, notes, versions, storage limits, and soft deletion are implemented. |
| Phase 4 — Audio and transcription | COMPLETE | Recording, upload, playback, transcription jobs, transcripts, segments, and real speech providers are implemented. |
| Phase 5 — AI, RAG, and AI chat | IN PROGRESS | The provider abstractions, Gemini generation path, embedding implementation, extraction, chunking, indexing, retrieval, scoped chat, citations, and authorization are present. Provider activation and several planned AI UX/features remain incomplete. |
| Phase 6 — Groups and collaboration | COMPLETE | Groups, membership, roles, invitations, shared Subjects/Materials, activity, notifications, and group AI scope are implemented. |
| Phase 7 — Google Drive/Docs | IN PROGRESS / PARTIAL | Google OAuth connections, Drive browsing/import, Docs text export, re-import, and supported-file processing are implemented. Continuous sync and native Google Slides import are not implemented. |
| Phase 8 — Flashcards, quizzes, and tutor | NOT YET IMPLEMENTED | Prisma models exist as scaffolding; the user-facing feature set is not implemented. |
| Phase 9 — Billing, usage ledger, security hardening, and production polish | NOT YET IMPLEMENTED | Some plan limits and live usage calculations exist, but the full ledger and hardening work do not. |

## Implemented product surface

- Authenticated Next.js App Router application with sign-in, sign-up,
  onboarding, dashboard, settings, and an authenticated shell.
- Personal hierarchy: Workspace → Subject → Chapter → Topic.
- Rich Topic notes with ordered blocks, autosave, versions, restore, and
  note-level access checks.
- Material upload, links, tags, archive, soft delete, organization, previews,
  download, storage limits, and plan-based file limits.
- Local filesystem storage and S3-compatible storage behind `StorageService`.
- Audio recording with device selection, level meter, pause/resume/cancel,
  WebM duration repair, upload progress, playback, and transcript playback
  seeking.
- Groups with roles `OWNER`, `ADMIN`, `MEMBER`, and `VIEWER`; invitations,
  membership management, role enforcement, activity, notifications, shared
  Subjects, and shared Materials.
- Group AI Assistant scoped to the group’s shared Materials.
- Google Drive/Docs connected accounts, encrypted tokens, Drive browsing,
  import, duplicate detection, re-import, Google Docs text export, and
  supported binary-file processing.
- PDF, DOCX, and PPTX extraction. PDF pages and PPTX slides retain page/slide
  provenance in `Material.extractedPages`; DOCX and Google Docs use flattened
  extracted text.
- PPTX browser preview with slide navigation and download.

## Phase 5 — current implementation

### COMPLETE

- `AIService` and `EmbeddingService` interfaces in
  `src/lib/services/interfaces.ts`.
- Environment-selected AI registry in `src/lib/services/ai.ts`.
- Concrete Gemini generation and note-generation provider in
  `src/lib/services/ai-gemini.ts`, using model `gemini-2.5-flash-lite`.
- Concrete OpenAI embedding provider in
  `src/lib/services/embedding-openai.ts`, using
  `text-embedding-3-small` and requesting exactly 1536 dimensions.
- Fixed `MaterialChunk.embedding` schema dimension:
  `vector(1536)`.
- Local PDF, DOCX, and PPTX text extraction through
  `DocumentProcessingService`.
- `Material.extractedText` and `Material.extractedPages`.
- Deterministic word-window chunking, transcript timestamp chunking, and
  page-aware chunking.
- Embedding-job orchestration and pgvector writes through parameterized raw
  SQL where Prisma cannot represent the vector column.
- pgvector cosine-distance semantic retrieval.
- Scope-aware retrieval with Subject, Chapter, Topic, group, and workspace
  scopes.
- AI conversations and messages persisted in Prisma.
- Topic, Subject, Chapter, workspace, and bare group chat surfaces.
- AI message citations containing material IDs, labels, PDF/page or
  audio/video timestamp provenance where available.
- Citation click-through to the authorized material detail page, including
  page and timestamp query parameters.
- Re-resolution of stored AI conversation scope before message retrieval.
- Descendant retrieval tests for Subject and Chapter scopes and focused
  scope/authorization tests.
- AI note-generation job and UI wiring for transcript-attached materials.

### Provider activation status

Gemini has a concrete implementation and is selected with
`AI_PROVIDER=gemini` and `GOOGLE_AI_API_KEY`.

OpenAI embeddings have a concrete implementation and the required
`text-embedding-3-small` model/dimension contract, but
`getEmbeddingService()` currently throws `ServiceNotConfiguredError` rather
than dispatching to that implementation. Consequently, extraction, chunking,
the embedding job, pgvector retrieval, and chat wiring are implemented, but
an end-to-end indexed/RAG deployment still requires wiring the selected
embedding implementation into the registry and configuring its key.

`AI_PROVIDER` also recognizes `anthropic` and `openai` as configuration names,
but no concrete AI implementation exists for either provider. Anthropic is
therefore an extensibility option, not an active provider.

### NOT YET IMPLEMENTED or DEFERRED

The following are not represented as completed functionality in the current
repository:

- Streaming AI responses and streaming chat UI.
- Suggested prompts.
- Regenerate, copy, and richer follow-up chat actions.
- AI summaries, important-point extraction, generated questions, and broader
  study tools.
- A fully activated embedding registry/provider path in the current checkout.
- Token/credit accounting, AI quota enforcement, and rate limiting for AI
  requests.
- OCR for scanned or image-only documents.
- Continuous document/Drive synchronization.
- A durable background queue/worker for processing jobs.

AI responses are never fabricated. Missing provider configuration returns a
real configuration error, and failed chat turns do not persist an orphaned
user message or fake assistant response.

## Material and RAG invariants

Material hierarchy IDs are intentionally denormalized:

- Subject material: `subjectId = S`.
- Chapter material: `subjectId = S`, `chapterId = C`.
- Topic material: `subjectId = S`, `chapterId = C`, `topicId = T`.

This is not the old “exactly one hierarchy ID” model. It is the invariant used
by `resolveMaterialScope()` and `materialWhereForScope()`.

- Subject retrieval with `{ subjectId: S }` includes direct Subject materials,
  all Chapters under S, and all Topics under those Chapters.
- Chapter retrieval with `{ chapterId: C }` includes direct Chapter materials
  and all Topics under C.
- Topic retrieval with `{ topicId: T }` includes only that Topic’s materials.
- A group scope with no narrower hierarchy scope filters by `groupId`.
- A workspace scope with no narrower scope filters by `workspaceId`.

Material creation and movement resolve the requested hierarchy through
centralized access helpers before writing the denormalized IDs.

## Authorization and collaboration

`src/lib/access.ts` is the centralized access boundary. Route handlers obtain
the session user, validate input, resolve the resource through
`getAccessible*`/`require*` helpers, and use shared API error helpers.

Workspace membership authorizes personal content. Group membership authorizes
group-owned Subjects, Chapters, Topics, and Materials. A Subject belongs to
exactly one owner scope: a personal Workspace or a Group.

Group knowledge is shared with authorized group members. AI conversations are
private to their owning user. A conversation’s stored Subject, Chapter, Topic,
group, or workspace scope is re-authorized whenever it is read or used for a
message, so losing access invalidates the conversation’s retrieval path.

## Processing and storage limitations

Transcription, document extraction, and embedding jobs use the existing
fire-and-forget `ProcessingJob` execution model. This requires a persistent
Node process and is not reliable on request-scoped serverless runtimes without
a real queue/worker.

Storage reads are proxied through the application for both local and S3
backends so browser media playback does not depend on object-storage CORS.
S3 reads currently buffer objects through the proxy rather than providing
true byte-range streaming from S3.

Google Drive browsing is flat, Google Docs structure is flattened to text,
Google-native Slides are rejected, and there is no continuous Drive sync.
Scanned PDFs and image-only documents have no OCR fallback.

## Current next work

1. Wire the concrete OpenAI embedding implementation into the embedding
   registry and configure it for a real end-to-end extraction → chunk →
   embed → retrieve verification.
2. Perform manual browser verification of Subject, Chapter, group, and
   material-source navigation flows with configured providers.
3. Add only the next explicitly selected Phase 5 AI UX/features; do not imply
   streaming, quotas, summaries, or study tools are complete.
4. Continue the roadmap toward Phase 8 study tools and Phase 9 billing,
   usage-ledger, and production-hardening work.

## Validation

The repository provides:

```text
npm run test
npm run lint
npm run typecheck
```

Vitest covers pure chunking, extraction guards, provider behavior with mocked
SDK clients, validation schemas, material/source-link formatting, retrieval
scope selection, descendant retrieval fixtures, and AI authorization
boundaries. Live cloud-provider calls and production database behavior are
not exercised by the unit suite.
