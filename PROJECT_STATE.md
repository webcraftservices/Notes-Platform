# Project State

Last reconciled against the repository at commit `45db743` plus the Phase
8.1 Learning System foundation working-tree changes on top of it, on
2026-09-12.

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
| Phase 8 — Flashcards, quizzes, and tutor | IN PROGRESS (8.1 foundation + 8.2 flashcards + 8.3 quizzes complete) | Flashcard generation (8.2) and quiz generation + real quiz-taking with server-side scoring (8.3) are both real and working end-to-end. The AI tutor, study sessions, progress/analytics, and spaced repetition are NOT implemented — see "Phase 8.3 — Quizzes" below. |
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

## Phase 8.1 — Learning System foundation

Only the foundation is implemented. No flashcard/quiz generation, study
UI, or AI tutor exists yet — the "Study Tools" tab still shows the
existing Phase 8 `PhasePlaceholder`, unchanged.

What changed:

- `FlashcardDeck` and `Quiz` now carry the same five-field scope as
  `Material` (`workspaceId`/`groupId`/`subjectId`/`chapterId`/`topicId`),
  instead of being hard-tied to an optional `topicId` alone. This reuses
  `resolveMaterialScope()` (re-exported as `resolveLearningScope()` from
  the new `lib/learning-scope.ts`) rather than introducing a second scope
  resolver — see that file's doc comment. A **bare group scope** (a
  deck/quiz attached to a Group with nothing narrower under it, the way
  `AIConversation` supports for Phase 6.5 group chat) is deliberately not
  supported yet, matching Material's own "no Unorganized within a Group"
  limitation.
- New `getAccessibleFlashcardDeck()`/`getAccessibleQuiz()` in
  `lib/access.ts`, following the same owner-or-scope-membership shape as
  `getAccessibleMaterial()`. No `requireFlashcardDeck`/`requireQuiz`
  server-component pair yet, since 8.1 adds no pages.
- **Ownership-boundary fix:** the original `Flashcard` scaffolding stored
  `timesReviewed`/`timesCorrect`/`nextReviewAt` directly on the shared
  card row, which would have conflated one group member's private study
  activity with another's the moment a deck was shared — a direct
  violation of the Group Learning Model's "User A must not automatically
  see User B's progress" rule. Nothing in the app read or wrote those
  columns yet, so they were removed and replaced with a new
  `FlashcardReview` table (private, per-user, one row per review event),
  mirroring the `Quiz`/`QuizQuestion` vs. `QuizAttempt` split that already
  existed and was already correct.
- **Provenance:** `Flashcard.sources` and `QuizQuestion.sources` are new
  nullable JSON columns, reusing `AIMessage.sources`'s existing shape
  (`{ materialId, label, timestampSeconds?, page? }[]`) instead of a new
  provenance table. Typed and validated via `learningSourceRefSchema` in
  `lib/validation/learning.ts`.
- **Structured-output contracts:** `lib/validation/learning.ts` also adds
  `flashcardGenerationItemSchema` and `quizQuestionGenerationItemSchema`
  — Zod schemas used to validate AIService's JSON output before writing
  it to the database. `flashcardGenerationItemSchema` is now actually
  wired in as of Phase 8.2 (below); `quizQuestionGenerationItemSchema`
  still isn't wired into any route — that's Phase 8.3. No new `AIService`
  method was added for either.
- Migration `20260912100000_learning_system_foundation` was hand-written
  (same as every other migration in this checkout — `prisma migrate dev`
  cannot reach `binaries.prisma.sh` in this sandbox) and has not been
  applied to any database.

Deliberately deferred to 8.3+: quiz generation, any study/tutor UI beyond
the minimal flashcard entry point below, spaced repetition scheduling,
shared/aggregate progress views, and a bare-group learning scope.

## Phase 8.2 — Flashcards

Real, end-to-end, Topic-scoped flashcard generation — not a mock, not a
generic "ask an LLM" feature. The pipeline: `getAccessibleTopic` (route)
→ `getAccessibleAIScope` (service, re-authorizes) → `retrieveRelevantChunks`
(real pgvector retrieval, limited to that Topic's materials) →
`AIService.chat()` (existing abstraction, no new provider/client) →
two-stage validation against `flashcardGenerationItemSchema` (raw AI
shape, then the complete shape including real provenance) → one
`$transaction` creating a `FlashcardDeck` + its `Flashcard`s → best-effort
`recordAIUsage` under a new `"flashcard_generation"` category.

- **Route shape:** `POST /api/topics/[topicId]/flashcards` is
  synchronous (like `POST /api/ai/conversations/[id]/messages`), NOT the
  fire-and-forget `ProcessingJob` pattern used for audio transcription —
  this is one bounded retrieval + one chat-shaped AI call, the same cost
  class as a single chat turn, so the client just awaits the finished
  deck. `GET /api/flashcards/[deckId]` returns a deck + its cards via
  `getAccessibleFlashcardDeck`, and deliberately never includes
  `FlashcardReview` rows (shared content vs. private activity, per the
  Group Learning Model).
- **Insufficient material:** if `retrieveRelevantChunks` returns nothing
  for the Topic, generation fails with a real 409
  (`FLASHCARDS_INSUFFICIENT_MATERIAL`) before ever calling the AI —
  never a fallback to general-knowledge cards, never an empty deck
  pretending to be a success.
- **Malformed AI output:** invalid JSON, an empty array, or items missing
  `front`/`back` all fail with a 502 (`FLASHCARDS_GENERATION_FAILED`)
  and create nothing — the transaction never runs.
- **Provenance:** every card in one generation batch shares the same
  `chunksToSources(chunks)` result (the exact same provenance-shaping
  function `ai-chat.ts` already uses for AI chat citations) — honest
  because it really is everything that grounded that batch, not invented
  per-card attribution the model was never asked to produce.
- **Card ordering:** `Flashcard` has no `order` column (no schema change
  was made for this). Cards are created sequentially inside the
  transaction and read back `ORDER BY id ASC`, relying on cuid's
  time-ordering — `createdAt` can't be used for this because Postgres
  fixes `now()` at transaction start, so every card in one batch would
  otherwise share an identical timestamp. See
  `lib/services/flashcard-generation.ts`'s doc comment.
- **UI:** the Topic "Study Tools" tab's Phase 8 placeholder is now a real
  `FlashcardsStudyToolsPanel` (generate → link to `/flashcards/[deckId]`)
  plus a minimal `FlashcardDeckView`/deck page — title, card count,
  front/back, source badges reusing `materialSourceHref`. No flip
  animation, no keyboard study controls, no review/answer-tracking UI —
  those are later subphases, not built here.
- Deliberately NOT implemented in 8.2 (all explicitly deferred): quiz
  generation, quiz-taking, the AI tutor, study sessions, progress
  analytics, spaced repetition, regeneration/versioning of a deck (each
  generation just creates a new deck), Subject/Chapter-wide generation
  (Topic-only for now).

## Phase 8.3 — Quizzes

Real, end-to-end Topic-scoped quiz generation and quiz-taking — mirrors
Phase 8.2's flashcard pipeline closely, applied to the Quiz/QuizQuestion
models that already existed as Phase 8.1 scaffolding, plus a real
quiz-taking flow with authoritative server-side scoring.

- **Generation** (`lib/services/quiz-generation.ts`): same shape as
  `flashcard-generation.ts` — `getAccessibleAIScope` → `retrieveRelevantChunks`
  → `AIService.chat()` → validated against the **existing**
  `quizQuestionGenerationItemSchema` (unchanged from the Phase 8.1
  corrective pass — no new/duplicate schema) → real `chunksToSources()`
  provenance attached and validated a second time → one transaction
  creating `Quiz` + `QuizQuestion` rows. Any `sources` the model supplies
  anyway is stripped before validation — never trusted (task's "no
  invented material IDs/pages/timestamps").
- **No schema change was needed.** `Quiz`/`QuizQuestion`/`QuizAttempt`
  already had every field this phase needed, including
  `QuizQuestion.order` (an explicit column Flashcard never had, so unlike
  Flashcard, question ordering doesn't rely on cuid/createdAt behavior —
  `order` is set directly during generation and is the authoritative sort
  key).
- **`QuizType` inference:** a generated quiz's `quizType` is `MCQ`/
  `TRUE_FALSE`/`SHORT_ANSWER` when every question shares one type, or
  `MIXED` when the batch mixes types — never a new enum value, never
  forced to `MIXED` for a uniform batch.
- **CRITICAL security boundary (`lib/quiz-serialization.ts`):**
  `toPublicQuiz`/`toPublicQuizQuestion` strip `correctAnswer`,
  `explanation`, and `sources` from every question before it can reach a
  quiz-taking browser. This applies not just to `GET /api/quizzes/[quizId]`
  but also to the **generation route's own response** — the person who
  just generated the quiz is still a quiz-taking client and must not see
  the answers before taking it either.
- **Server-side scoring (`lib/quiz-scoring.ts`, pure/DB-free for unit
  testability):** MCQ and TRUE_FALSE score by exact match; SHORT_ANSWER
  scores by trimmed, case-insensitive exact match — no second AI call for
  grading, no fuzzy/semantic matching. A type-mismatched or missing
  answer is scored as incorrect, never thrown as an error. The score is
  always computed from the real persisted `QuizQuestion.correctAnswer`;
  nothing in the request body (score, correctness flags) is ever trusted.
- **Routes:** `POST /api/topics/[topicId]/quizzes` (synchronous, same
  rationale as the flashcard route — one bounded retrieval + one chat
  call, not the ProcessingJob pattern), `GET /api/quizzes/[quizId]`
  (sanitized via `toPublicQuiz`), `POST /api/quizzes/[quizId]/attempts`
  (filters submitted answers down to this quiz's own question ids before
  scoring — an unknown/foreign question id is silently ignored, never
  scored or persisted — then creates a `QuizAttempt` for the
  authenticated user only, and returns the real score plus the
  post-submission reveal of each question's `correctAnswer`/
  `explanation`/`sources`).
- **Group privacy preserved:** a group-owned Topic generates a
  group-scoped `Quiz`/`QuizQuestion` (shared, same as flashcards); no
  route or query in this phase ever reads another user's `QuizAttempt`
  rows — `GET /api/quizzes/[quizId]` doesn't include attempts at all, and
  the submission route only ever creates one for `user.id`.
- **UI:** the Topic Study Tools tab now shows both the flashcard panel and
  a new `QuizStudyToolsPanel` side by side (only the AI tutor remains
  "coming later"); a minimal `/quizzes/[quizId]` page + `QuizTakingView`
  handles MCQ/TRUE_FALSE/SHORT_ANSWER input, submission, and a result
  view built entirely from the server's response. No timer, no
  bookmarking, no adaptive difficulty, no per-question one-at-a-time flow.
- Deliberately NOT implemented in 8.3 (all explicitly deferred): the AI
  tutor, study sessions, progress/analytics, spaced repetition, adaptive
  difficulty, quiz regeneration/versioning, retake restrictions (a user
  can submit multiple attempts — nothing currently prevents or surfaces
  that), and a "resume/view past attempt" endpoint (the submission
  response already returns the full result inline, so nothing else reads
  `QuizAttempt` back in this phase).

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
   streaming, summaries, or study tools are complete.
4. Phase 8.4: AI tutor — the next Phase 8 subphase per the roadmap.
5. Continue the roadmap toward Phase 8.5+ (study sessions, progress,
   spaced repetition) and Phase 9 billing, usage-ledger, and
   production-hardening work.

Known pre-existing doc drift (not touched by this task, flagged for a
future reconciliation pass): the "NOT YET IMPLEMENTED or DEFERRED" list
under Phase 5 above still says AI quota enforcement/rate limiting isn't
implemented, but `lib/ai-quota.ts`/`lib/ai-usage.ts` (already on `main` as
of commit `45db743`) implement both. This predates and is unrelated to
Phase 8.1.

## Validation

The repository provides:

```text
npm run test
npm run lint
npm run typecheck
```

Vitest covers pure chunking, extraction guards, provider behavior with mocked
SDK clients, validation schemas, material/source-link formatting, retrieval
scope selection, descendant retrieval fixtures, AI authorization
boundaries, FlashcardDeck/Quiz scope authorization, learning
generation-output validation schemas (Phase 8.1), the flashcard
generation service and both flashcard routes (Phase 8.2), and — as of
Phase 8.3 — the quiz generation service, all three quiz routes
(generation, retrieval, attempt submission), and pure quiz-scoring logic.
Everything AI-shaped is mocked at the service/AIService boundary; no real
Gemini/OpenAI network calls in the suite. Live cloud-provider calls and
production database behavior are not exercised by the unit suite.

As of the Phase 8.3 commit: 49 test files / 492 passing (4 skipped),
`npm run lint` clean, `npm run typecheck` at 88 errors — 84 of which are
the same pre-existing `@prisma/client`-generation-cascade set as the
Phase 8.2 baseline (see CLAUDE.md; `npm run db:generate` removes them all
in a real dev environment), plus 4 new occurrences of that identical
cascade pattern (`Module has no exported member 'Quiz'/'QuizQuestion'/
'QuizType'` — the same "Prisma model type not generated" cause as every
other cascade error, not a new logical error) in the three new quiz
files that import those types, confirmed by diffing the full error list
against the pre-8.3 baseline. One genuine implicit-`any` was caught and
fixed with an inline type during this pass, matching the "no `any`" rule
requested for Phase 8.3.
