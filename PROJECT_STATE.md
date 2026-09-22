# Project State

Last reconciled against the repository at commit `0348aa9` ("feat: add
study progress tracking" — Phase 8.5) plus the Phase 8.6 Flashcard Study
& Review working-tree changes on top of it, on 2026-09-17.

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
| Phase 8 — Flashcards, quizzes, and tutor | IN PROGRESS (8.1 foundation + 8.2 flashcards + 8.3 quizzes + 8.4 AI Tutor + 8.5 Study Progress + 8.6 Flashcard Study & Review complete) | Flashcard generation (8.2), quiz generation + real quiz-taking with server-side scoring (8.3), a real, Topic-scoped, plan-gated AI Tutor (8.4), real private Quiz/Tutor progress aggregation (8.5), and a real interactive flashcard study loop with private per-user review persistence (8.6) are all real and working end-to-end. Flashcard progress/mastery surfacing, study streaks, and spaced repetition are NOT implemented — see "Phase 8.6 — Flashcard Study & Review" below. |
| Phase 9 — Billing, usage ledger, security hardening, and production polish | IN PROGRESS (9.1 security hardening + 9.2 observability foundation + 9.3 production security boundary hardening complete) | Some plan limits and live usage calculations exist. Phase 9.1 adds: Mammoth-generated DOCX HTML sanitization before rendering, Upstash Redis-backed distributed rate limiting (in-memory fallback preserved for local dev), a generic safe-500 path + structured server-side error logging in api-response.ts, and AI provider network/timeout failures mapped to a clean 503 (`AIProviderUnavailableError`) instead of leaking raw provider exceptions. Phase 9.2 adds a Datadog observability foundation (direct HTTP log/metric intake — no Agent/dd-trace, see `docs/observability.md`): `logServerError()` now also forwards to Datadog; the AI messages route emits request/latency/failure-category metrics and a request/correlation ID on its 503/500 responses; `/api/health` became a real liveness/readiness endpoint (DB, Redis, storage, AI); a new `/api/client-errors` endpoint lets the client-side global error boundary actually reach server logs for the first time. Full APM/tracing and Datadog RUM were evaluated and deliberately deferred (see that doc). Phase 9.3 is an evidence-driven security boundary audit (see `docs/security-hardening.md`): fixed a real stored-XSS input-validation gap (NoteBlock content accepted arbitrary JSON rendered through a Tiptap version with a known `mergeAttributes()` prototype-pollution bug — now guarded in lib/validation/safe-json.ts), upgraded `image-size`/`music-metadata` to patched versions (fixing upload-triggerable infinite-loop DoS advisories), added HTTP security headers + a CSP (documented `unsafe-inline` limitation for script/style-src pending nonce infrastructure), and stopped a Google OAuth callback from leaking raw provider error text into a redirect URL. Authorization (`lib/access.ts`), CSRF/CORS posture, session/cookie config, and Google token encryption were all audited and found already correct — not changed. Phase 9.4 (reliability/resilience hardening — explicit provider timeouts, atomic job de-duplication + stale-job recovery, S3 upload verification, Redis-outage degradation, readiness/liveness split; see `docs/ARCHITECTURE.md` "Phase 9.4") is committed (baseline `46cef33`). Phase 9.5 (evidence-driven performance audit — see `docs/ARCHITECTURE.md` "Phase 9.5") is in the working tree, not yet committed: fixed the S3 storage-read proxy fully buffering objects to serve byte-range requests (now uses a real S3 `Range` GET), and trimmed six material-list queries that were fetching each material's full extracted text/pages for no reason. The billing/usage ledger and row-level security are NOT yet implemented. |

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

This phase implemented the foundation. (Subsequent phases 8.2-8.5 have since implemented generation, study UI, and the AI tutor, replacing the placeholder.)

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
  `getAccessibleFlashcardDeck`. As of Phase 8.6 below, each card also
  carries the requesting user's own latest `FlashcardReview` (`review:
  {...} | null`) via a Prisma `include` scoped to `userId` — shared
  content stays shared, but review activity stays private per user, per
  the Group Learning Model.
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
- **UI:** the Topic Study Tools tab now shows the flashcard panel, the
  quiz panel, and (as of Phase 8.4) a real AI Tutor entry point, side by
  side/below; a minimal `/quizzes/[quizId]` page + `QuizTakingView`
  handles MCQ/TRUE_FALSE/SHORT_ANSWER input, submission, and a result
  view built entirely from the server's response. No timer, no
  bookmarking, no adaptive difficulty, no per-question one-at-a-time flow.
- Deliberately NOT implemented in 8.3 (all explicitly deferred): study
  sessions, progress/analytics, spaced repetition, adaptive difficulty,
  quiz regeneration/versioning, retake restrictions (a user can submit
  multiple attempts — nothing currently prevents or surfaces that), and a
  "resume/view past attempt" endpoint (the submission response already
  returns the full result inline, so nothing else reads `QuizAttempt`
  back in this phase).

## Phase 8.4 — AI Tutor

A real, Topic-scoped, plan-gated AI Tutor, built as the smallest clean
extension of the Phase 5 AI chat infrastructure — not a parallel
conversation/message schema.

**Important history — read before trusting any earlier "Phase 8.4" claim.**
Commit `0182b54` ("fix: separate AI tutor rate limiting") added an
`AI_TUTOR_RATE_LIMIT` constant and an `isTutorConversation` branch keyed
off `conversation.kind`, but **`AIConversation` had no `kind` column at
that point** — no migration, no schema field, no enum. That branch was
unreachable dead code against any real database row (`"kind" in
conversation` is always `false` for a real Prisma row lacking that
column); nothing else — no system prompt, no usage category, no UI entry
point, no `aiTutor` entitlement enforcement — existed at all. A
ground-truth audit against the actual repository (not the commit message)
caught this before it compounded. This Phase 8.4 entry documents what
was verified to actually work after a genuine implementation pass; treat
any prior description of "Phase 8.4 complete" as inaccurate.

- **Schema:** `AIConversation.kind` (`AIConversationKind`: `CHAT` default
  | `TUTOR`) is now a real column, added via migration
  `20260916090000_ai_conversation_kind`, plus a `(userId, kind)` index.
  Every pre-8.4 conversation row defaults to `CHAT` and is unaffected.
  `getAccessibleAIConversation` needed **zero code changes** — it already
  returns the full, unmodified Prisma row (no `select` clause), so `kind`
  flows through it automatically once the column exists.
- **Topic-only, by design and by validation:** a TUTOR conversation
  cannot be created without a `topicId` — `lib/validation/ai.ts`'s
  `aiConversationScopeSchema` rejects `kind: "TUTOR"` without one via
  `.superRefine`, at the schema layer, before any DB/authorization work.
  This matches where flashcards/quizzes already live (Topic-only) and is
  what guarantees Tutor retrieval can never escape to broader
  workspace/group material — `retrieval-scope.ts` already narrows
  strictly to `topicId` whenever a scope has one set.
- **Conversation resolution (`/api/ai/conversations` GET/POST):** now
  accepts an optional `kind` (query param or body field, default `CHAT`)
  and folds it into the get-or-create/create call, so a Topic's plain
  "Ask AI" conversation and its Tutor conversation are two distinct,
  separately-private rows.
- **Plan entitlement, actually enforced:** `lib/plans.ts`'s
  `advancedFeatures.aiTutor` flag existed since early Phase 8 scaffolding
  but was read nowhere in the codebase — a FREE-tier user faced no actual
  restriction. `lib/ai-quota.ts` now has `assertAiTutorEntitlement()` +
  `AITutorNotEnabledError`, following the exact existing
  `assertGoogleDriveSyncAllowed`/`GoogleDriveNotEnabledError` pattern from
  `lib/google-import.ts` (same `getPlanLimits(subscription?.plan ??
  "FREE")` shape, no new entitlement system). Checked in **two** places:
  at conversation creation (`conversations/route.ts`, both GET and POST)
  and again live on every message send (`messages/route.ts`) — so a plan
  downgrade blocks the very next message on an already-created Tutor
  conversation, not just new ones.
- **Messages route (`POST /api/ai/conversations/[conversationId]/messages`)**
  branches on the loaded conversation's real `kind`:
  - the previously dead-code rate-limit branch is now reachable: TUTOR
    uses its own `ai-tutor-chat:<userId>` bucket, CHAT keeps
    `ai-chat:<userId>` — exactly one bucket is ever consumed per message,
    proven by dedicated tests;
  - a real `TUTOR_SYSTEM_INSTRUCTION` (`lib/ai-chat.ts`) is passed as an
    extra `system`-role `AIChatMessage` — `ai-gemini.ts`'s existing
    `extractSystemMessages`/`buildSystemInstruction` already fold this
    into the provider's system instruction, so no new `AIService` method
    or provider-specific code was needed. It instructs: act as a Topic
    tutor, teach progressively rather than dumping answers, use supplied
    material as the primary factual source, never invent facts, admit
    when material is insufficient, ask check-understanding questions
    where useful, never claim unsupported info came from the student's
    materials, and stay scoped to the Topic (decline unrestricted-
    assistant requests). CHAT conversations never receive this message —
    pre-8.4 behavior is byte-for-byte unchanged;
  - **no indexed material for the Topic** (zero retrieved chunks) returns
    a `409 TUTOR_INSUFFICIENT_MATERIAL` *before* calling the AI provider
    at all — mirrors `InsufficientSourceMaterialError`'s existing
    fail-before-calling-the-model posture from flashcard/quiz generation,
    applied to Tutor instead of inventing a new "insufficient material"
    behavior. CHAT's pre-8.4 behavior with zero chunks (still calls the
    model, lets `HALLUCINATION_CONTROL_INSTRUCTION` decide) is unchanged;
  - usage is recorded under a new `"tutor_chat"` `AIUsageCategory`
    (`lib/ai-usage.ts`) instead of the previously hardcoded `"chat"` —
    same quota pool, separately visible in the ledger.
- **UI:** `AIChatPanel` gained a `kind` prop (`"CHAT" | "TUTOR"`, default
  `"CHAT"` — every existing call site is unaffected) that changes only the
  conversation-fetch query string, the empty-state icon/copy, and adds a
  `blockedError` state for the new 403 (`AI_TUTOR_NOT_ENABLED`) / 409
  (`TUTOR_INSUFFICIENT_MATERIAL`) responses. The Topic page
  (`topics/[topicId]/page.tsx`) resolves `advancedFeatures.aiTutor`
  server-side (same `getPlanLimits(subscription?.plan ?? "FREE")` used
  elsewhere) and passes it to `TopicTabs` as `aiTutorEnabled`; the Study
  Tools tab's former "The AI tutor is coming in a later update." text is
  now a real `<AIChatPanel kind="TUTOR">` when entitled, or a short
  plan-upgrade message when not. This is UX-only gating — the actual
  enforcement is server-side (`assertAiTutorEntitlement`), same
  frontend-hides/backend-is-authoritative split as every other
  entitlement in this app.
- **Privacy:** unchanged, unmodified `getAccessibleAIConversation`
  ownership check (`conversation.userId !== userId` throws, regardless of
  `kind`) — a group-shared Topic's material can ground multiple members'
  Tutor conversations, but each member's own conversation stays private
  to them. Verified with real (non-mocked) tests against
  `lib/access.ts` in `lib/__tests__/access-ai-scope.test.ts`, not by
  mocking `@/lib/access` itself and asserting on an injected shape (the
  mistake in the pre-8.4 tests that let the dead-code branch go
  unnoticed).
- Deliberately NOT implemented in 8.4: Subject/Chapter/Group Tutor entry
  points (Topic only, matching flashcards/quizzes/Study Tools), a
  standalone tutor conversation-history/list page beyond the inline
  panel, one-question-at-a-time Socratic tutoring mode, correctness
  evaluation of student answers, and weak-area tracking — none of this
  was requested for this phase. (Weak-area/progress tracking is now
  partially addressed by Phase 8.5 below, for quizzes and Tutor activity
  only — not for the correctness-evaluation/Socratic-mode items above.)

## Phase 8.5 — Study Progress

Real, private, per-user Quiz and AI Tutor activity aggregation.
Deliberately **not** a new `StudyProgress` model — `QuizAttempt` and the
Phase 8.4 `AIConversation`/`AIMessage` (`kind = TUTOR`) rows were already
real persisted activity; this phase only aggregates them.

**Audit finding that shaped this phase's scope.** A read-only audit
performed first (before any code changes) found that `FlashcardReview`
exists in the schema but has **no write path anywhere in the
codebase** — no route ever creates one, and `FlashcardDeckView` is a
static list with no flip/correct-incorrect interaction. Flashcard
progress was therefore excluded from 8.5 entirely rather than shown as a
permanently-empty "0 flashcards reviewed" state. The audit also confirmed
`QuizAttempt.weakTopics` is schema-only (default `[]`, never written by
any route) and was left untouched.

- **Service (`src/lib/study-progress.ts`):** `getQuizProgress(userId,
  scope?)` and `getTutorActivity(userId, scope?)`, plus a
  `getStudyProgress` convenience wrapper. Every query starts `WHERE
  userId = userId` — never inferred from a request param. `scope`, when
  given, must already be an authorized `ResolvedAIScope` (from
  `getAccessibleAIScope`); it narrows which `Quiz`/`AIConversation` rows
  count via `lib/retrieval-scope.ts`'s existing `materialWhereForScope`
  (reused as-is — Quiz and AIConversation share Material's exact
  five-field scope shape, so no new scope-to-where helper was needed). No
  `scope` at all means the true global aggregate: every attempt/session
  this user has ever had, personal or group.
- **Quiz progress** never collapses multiple attempts: `attempts` counts
  every one, `latest` is the most recently started, `bestScore`/
  `averageScore` are computed across all of them, and multiple quizzes
  under one scope (e.g. several quizzes generated for the same Topic
  over time) all roll up together because the where-clause narrows by
  `quiz.topicId` (etc.), not by a single `quizId`. History is capped at
  20 most-recent attempts — a personal list, not a paginated report.
- **Tutor activity** counts only `AIConversation` rows with `kind =
  TUTOR` — a plain "Ask AI" (`kind = CHAT`) conversation never
  contributes, verified by a dedicated test. Reads
  `AIConversation`/`AIMessage` directly rather than the `tutor_chat`
  `UsageRecord` ledger, since `UsageRecord` is a best-effort accounting
  record while the conversation/message tables are the real activity.
- **API — `GET /api/progress`:** follows the same `getSessionUser` →
  validate (`aiScopeQuerySchema`, reused unchanged from Phase 5/6.5) →
  `getAccessibleAIScope` → aggregate shape as `GET /api/ai/conversations`.
  No scope query params → skips scope resolution entirely and returns
  the global aggregate. Any scope param present is resolved/authorized
  through the same `getAccessibleAIScope` AI chat already uses — no
  second authorization system. An inaccessible scope throws
  `NotAuthorizedError` → `403`, never a misleadingly-empty `200`.
- **Privacy:** unchanged, reused authorization. Content (a group-owned
  Quiz or Tutor-enabled Topic) is shared; activity (`QuizAttempt`,
  `AIConversation`) stays strictly per-`userId` — two members of the same
  group who both took the same Quiz each see only their own attempts,
  verified directly by a test asserting User A's progress never includes
  User B's rows on a shared group quiz.
- **UI:** a "Your progress" summary inside the existing Topic Study Tools
  tab (`StudyProgressPanel`, client-fetched from `/api/progress?
  topicId=...`) — no new tab. A separate dashboard "Study Activity"
  section (`StudyActivityWidget`, server-rendered from
  `getStudyProgress(user.id)` with no scope) — kept visually and
  semantically distinct from the existing `ProgressRow`
  (`ChapterStatus`-based chapter completion); the two are never merged.
  Both render only the metrics the API actually returns — no flashcard
  section, no streak, no weak-topic breakdown.
- Deliberately NOT implemented in 8.5 (see the audit above): flashcard
  review recording and flashcard progress/mastery, study streaks or
  daily-activity buckets (and therefore no timezone handling), populating
  `weakTopics`, per-question weak-topic analytics, gamification, badges,
  leaderboards, and any general analytics dashboard beyond this. No
  schema change and no new index were made — `QuizAttempt.userId` and
  `AIConversation`'s existing `(userId, kind)` index already cover this
  phase's query patterns at the expected scale.

## Phase 8.6 — Flashcard Study & Review

Activates the `FlashcardReview` model that Phase 8.1 defined and Phase
8.5's audit confirmed had no write path anywhere in the codebase. This
phase adds exactly that write path plus a real study UI — nothing else.
**No schema change** — `FlashcardReview`'s existing fields
(`flashcardId`, `userId`, `wasCorrect`, `selfRating`, `reviewedAt`) were
already the correct shape; `selfRating` remains unused/optional, as
before.

- **API — `POST /api/flashcards/[deckId]/reviews`:** mirrors `POST
  /api/quizzes/[quizId]/attempts`'s authorization shape exactly:
  `getSessionUser` → validate body (`submitFlashcardReviewSchema`:
  `flashcardId` + `wasCorrect`, nothing else) → `getAccessibleFlashcardDeck`
  (the same owner-or-scope-membership check the GET route already uses,
  so group-owned decks work identically) → `db.flashcard.findFirst({
  where: { id: flashcardId, deckId: deck.id } })` to confirm the card
  actually belongs to *this* deck → `db.flashcardReview.create(...)` with
  `userId` always taken from the authenticated session, never the
  request body (the schema doesn't even have a `userId` field, so there
  is nothing for a client to send). A flashcard id that's real but
  belongs to a different (even accessible) deck fails the `findFirst`
  lookup and returns 400 — closes the flashcardId-IDOR path explicitly.
  Multiple reviews per card are allowed and never deduplicated/upserted —
  append-only history, the same posture `QuizAttempt` already has.
- **API — `GET /api/flashcards/[deckId]` (extended):** the `flashcard`
  query now includes each card's own-user latest review: `reviews: {
  where: { userId: user.id }, orderBy: { reviewedAt: "desc" }, take: 1
  }`. The route maps this down to a single `review: {...} | null` field
  per card and never returns the raw plural `reviews` array — the
  Prisma `where: { userId: user.id }` clause is the actual privacy
  boundary (structurally incapable of returning another user's rows),
  the same pattern Phase 8.5's aggregation and the quiz-attempts route
  already rely on.
- **Frontend:** `src/components/flashcards/flashcard-study-view.tsx` is
  the real one-card-at-a-time loop — front shown first, "Reveal answer"
  shows the back plus provenance sources, then "Known" / "Not Known"
  POSTs to the reviews endpoint and only advances to the next card after
  a successful response (an error keeps the user on the same card with a
  real error message, never a silent fake success). Completion shows a
  local, session-only studied/known count — never persisted, never fed
  into Phase 8.5's progress aggregation or any dashboard. An empty deck
  (zero cards) shows a proper `EmptyState`, never a broken study loop or
  a network call for a nonexistent card. `src/components/flashcards/
  flashcard-deck-page.tsx` is a small client wrapper adding a "Study" /
  "Overview" tab pair via the existing `Tabs` primitive (already used by
  `TopicTabs`/`SubjectTabs`/`ChapterTabs`/`GroupTabs`) — the deck page had
  no tab structure before this phase, so this is the smallest fitting
  addition rather than a new navigation pattern. The Phase 8.2
  `FlashcardDeckView` (static browse-all-cards list) is unchanged and is
  now the `Overview` tab's content, reachable by anyone who just wants to
  inspect the generated cards without starting a review session.
- **Revisiting:** re-derives all "already reviewed" state from the
  server's per-card `review` field on each fresh page load — nothing
  about review history is cached or inferred client-side across visits.
  Card order stays the existing stable `id asc` order regardless of
  prior review outcomes; nothing reorders, filters, or schedules cards
  by review state.
- **Explicitly NOT implemented** (out of scope by design, per the task):
  SM-2, FSRS, ease factors, review intervals, due-date scheduling, or any
  other spaced-repetition algorithm; XP, levels, badges, streaks,
  leaderboards, or any gamification; AI-generated study plans or review
  recommendations; global or weak-topic flashcard analytics; any change
  to `GET /api/progress`, the Study Progress UI, Quiz, or the AI Tutor.
  Flashcard progress/mastery is still not surfaced in `GET /api/progress`
  or either progress widget — this phase only makes the underlying
  `FlashcardReview` data real; a future phase would have to explicitly
  add it there.

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
private to their owning user — this applies identically to Tutor
conversations (Phase 8.4): `AIConversation.kind` is a behavior discriminator
(which system prompt / rate-limit bucket / usage category applies), never an
access-control input. A conversation’s stored Subject, Chapter, Topic,
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
   material-source navigation flows with configured providers, including
   the new AI Tutor panel, the Phase 8.5 Study Progress UI, and the
   Phase 8.6 flashcard Study/Overview tabs.
3. Add only the next explicitly selected Phase 5 AI UX/features; do not imply
   streaming, summaries, or study tools are complete.
4. If flashcard progress/mastery is wanted on the dashboard or `GET
   /api/progress`, that's still a distinct follow-up — Phase 8.6 made
   `FlashcardReview` a real, written, private-per-user table, but did not
   surface any aggregate over it. Study streaks and spaced repetition
   (SM-2/FSRS/due-date scheduling) also remain entirely unimplemented by
   design.
5. Continue the roadmap toward Phase 9 billing, usage-ledger, and
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
generation service and both flashcard routes (Phase 8.2), the quiz
generation service, all three quiz routes (generation, retrieval, attempt
submission), and pure quiz-scoring logic (Phase 8.3), and — as of Phase
8.4 — the real (non-mocked) `aiConversationScopeSchema` validation, the
real `assertAiTutorEntitlement`/`getPlanLimits` entitlement logic, real
`getAccessibleAIConversation` privacy behavior for TUTOR-kind rows, both
`/api/ai/conversations` routes' kind-scoped get-or-create/create/
entitlement behavior, the messages route's full Tutor branch (dedicated
rate-limit bucket, system-prompt injection, insufficient-material
short-circuit, `tutor_chat` usage), `TUTOR_SYSTEM_INSTRUCTION` content,
and the `AIChatPanel` query-building contract for CHAT vs TUTOR. As of
Phase 8.5, coverage also includes `lib/study-progress.ts`'s quiz-progress
and Tutor-activity aggregation (multi-attempt/multi-quiz rollups,
TUTOR-vs-CHAT exclusion, zero-activity and zero-question edge cases) and
`GET /api/progress`'s scope resolution, authorization, and the
group-shared-content-vs-private-activity boundary. As of Phase 8.6,
coverage also includes `POST /api/flashcards/[deckId]/reviews`'s full
authorization/validation surface and the extended `GET
/api/flashcards/[deckId]`'s per-user latest-review scoping (see the test
summary below). Everything AI-shaped
is mocked at the service/AIService boundary; no real Gemini/OpenAI
network calls in the suite. Live cloud-provider calls and production
database behavior are not exercised by the unit suite.

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

As of the Phase 8.4 commit: 51 test files / 545 passing (4 skipped),
`npm run lint` clean, `npm run typecheck` at 88 errors — the exact same
count and the same pre-existing `@prisma/client`-generation-cascade set as
the Phase 8.3 baseline before it (confirmed by diffing the full error list
line-for-line: the only differences are line-number shifts from added doc
comments, zero new errors). `npm run build` could not be fully verified in
this sandbox: it fails at the Google Fonts fetch step during compilation
(`fonts.googleapis.com` isn't reachable here), before ever reaching the
`/api/health` static-generation step's environmental Neon DB error — a
stricter sandbox network restriction than whatever access produced that
DB-only failure previously, and unrelated to this phase's changes
(`app/layout.tsx`, the only file that touches fonts, was not modified).

As of the Phase 8.5 commit (working tree, not yet committed): 53 test
files / 567 passing (4 skipped, the same pre-existing set), `npm run
lint` clean, `npm run typecheck` at 96 errors — diffed line-for-line
against a stash-isolated Phase 8.4 baseline: identical error set, only
line-number shifts in `src/app/(app)/home/page.tsx` from the added
Study Activity section (same pre-existing implicit-`any`/Prisma-cascade
pattern, zero new errors). `npm run build` remains unverifiable in this
sandbox for the same two pre-existing, unrelated reasons: no network
egress to `fonts.googleapis.com` (Google Fonts) and no network egress to
Prisma's engine-binary checksum host (`npx prisma generate` itself fails
here with a 403) — neither is touched by this phase's files. The 22 new
Phase 8.5 tests (15 for `lib/study-progress.ts`, 7 for `GET /api/progress`)
cover: empty-activity state, single and multiple attempts on one quiz,
latest/best/average correctness, multi-quiz topic rollups, a bare-group
scope, history capping, zero-question/zero-division safety, TUTOR-vs-CHAT
exclusion, unscoped-vs-scoped requests, malformed scope (400), an
inaccessible scope (403, not an empty 200), and — the most important
privacy case — that User A's progress on a shared group Quiz never
includes User B's attempts, and vice versa. No schema change; `git diff
prisma/schema.prisma` is empty. `FlashcardReview` and `weakTopics` remained
completely untouched as of this commit (`FlashcardReview` was
subsequently activated in Phase 8.6 below; `weakTopics` remains
untouched).

As of the Phase 8.6 changes (working tree, not committed per this task's
no-commit rule): 54 test files / 585 passing (4 skipped, the same pre-existing
set) — one new test file (`reviews/__tests__/route.test.ts`) versus the
Phase 8.5 baseline's 53 — `npm run lint` clean, `npm run typecheck`
diffed line-for-line against a stash-isolated Phase 8.5 baseline:
identical 96-error pre-existing `@prisma/client`-generation-cascade set,
zero new errors. `npm run build` remains unverifiable in this sandbox
for the same pre-existing, unrelated reason as every prior phase: no
network egress to `fonts.googleapis.com` (confirmed identical on
unmodified `main` before any Phase 8.6 file was touched). `npx prisma
validate`/`generate` also remain blocked by the sandbox's lack of egress
to `binaries.prisma.sh` (403), same as every prior phase. 18 net new
tests versus the Phase 8.5 baseline: 15 new for `POST
/api/flashcards/[deckId]/reviews` (auth, personal-deck and group-deck
authorization, malformed/missing payload, a flashcardId that doesn't
exist or belongs to a different deck — the explicit IDOR case, a
client-supplied `userId` having no effect, multiple reviews on one card,
and the response shape), and a net +3 for `GET /api/flashcards/[deckId]`
(one obsolete "never returns reviews" test removed, four new ones added
covering the `include`'s exact `where: { userId }` scoping arguments,
the singular `review` field replacing the raw array, `review: null` for
an unreviewed card, and — the privacy case — a second user's request
never surfacing the first user's review). No schema change; `git diff
prisma/schema.prisma` is empty.
