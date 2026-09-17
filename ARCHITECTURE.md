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

### AI Tutor (Phase 8.4)

**Ground-truth note.** An earlier commit (`0182b54`, "fix: separate AI
tutor rate limiting") added a rate-limit branch keyed off
`conversation.kind`, but `AIConversation` had no `kind` column at that
point — the branch was unreachable dead code against any real database
row, and nothing else (system prompt, usage category, UI, entitlement
enforcement) existed. A ground-truth audit against the actual repository
caught this. Everything below describes what was verified to actually
work after a genuine implementation pass.

The AI Tutor reuses the exact `AIConversation`/`AIMessage`/`AIChatPanel`
infrastructure above rather than a parallel schema.
`AIConversation.kind` (`CHAT` default | `TUTOR`) is now a real column
(migration `20260916090000_ai_conversation_kind`) and is a behavior
discriminator, not an access-control input — `getAccessibleAIConversation`'s
ownership-only privacy rule and `getAccessibleAIScope`'s workspace/group
authorization apply identically regardless of `kind`, and needed no code
changes at all, since `getAccessibleAIConversation` already returns the
full, unmodified Prisma row.

A TUTOR conversation **must** have a `topicId` — `aiConversationScopeSchema`
(`lib/validation/ai.ts`) rejects `kind: "TUTOR"` without one via
`.superRefine`, before any DB or authorization work runs. This is what
keeps Tutor retrieval Topic-scoped: `retrieval-scope.ts` already narrows
strictly to `topicId` whenever a scope has one, so no new retrieval logic
was needed.

`/api/ai/conversations` GET/POST accept an optional `kind` (default
`CHAT`), fold it into the get-or-create/create lookup key alongside the
scope, and — for TUTOR — call `assertAiTutorEntitlement()`
(`lib/ai-quota.ts`) before touching the database at all.
`assertAiTutorEntitlement` follows the exact existing
`assertGoogleDriveSyncAllowed`/`GoogleDriveNotEnabledError` pattern from
`lib/google-import.ts` (same `getPlanLimits(subscription?.plan ?? "FREE")`
shape) against `PlanLimits.advancedFeatures.aiTutor` — a flag that existed
in `lib/plans.ts` since early Phase 8 scaffolding but was read nowhere
else in the codebase before this phase.

`POST /api/ai/conversations/[conversationId]/messages` branches on the
loaded conversation's `kind`:

- **Entitlement** — re-checked live (not just at creation) so a plan
  downgrade blocks the very next message on an already-created Tutor
  conversation.
- **Rate limiting** — a dedicated `ai-tutor-chat:<userId>` bucket, separate
  from the generic `ai-chat:<userId>` bucket; exactly one bucket is
  consumed per message, for either kind.
- **No indexed material** — if retrieval returns zero chunks for the
  Topic, the route returns `409 TUTOR_INSUFFICIENT_MATERIAL` and never
  calls the AI provider. This mirrors `InsufficientSourceMaterialError`'s
  existing fail-before-calling-the-model posture from flashcard/quiz
  generation rather than inventing a new "insufficient material"
  behavior. The CHAT path is unchanged: it still calls the model with
  zero chunks and lets `HALLUCINATION_CONTROL_INSTRUCTION` decide whether
  to offer explicitly-labeled general knowledge.
- **System prompt** — `lib/ai-chat.ts`'s `TUTOR_SYSTEM_INSTRUCTION` is
  passed as an extra `system`-role `AIChatMessage`, which `ai-gemini.ts`'s
  existing `extractSystemMessages`/`buildSystemInstruction` already fold
  into the provider's system instruction — no new `AIService` method or
  provider-specific code. It instructs the model to: act as a tutor for
  the Topic, teach progressively rather than dump answers, use the
  supplied material as the primary factual source, never invent facts,
  explicitly admit when the material is insufficient, ask
  check-understanding questions where useful, never claim unsupported
  info came from the student's own materials, and stay scoped to the
  Topic (decline unrestricted-assistant requests). CHAT conversations
  never receive this message.
- **Usage** — recorded under a new `"tutor_chat"` `AIUsageCategory`
  (`lib/ai-usage.ts`), not the previously-hardcoded `"chat"`. Same quota
  pool as CHAT, separately visible in the ledger.

`AIChatPanel` gained a `kind` prop (`"CHAT" | "TUTOR"`, default `"CHAT"` —
every pre-8.4 call site is unaffected), which changes only the
conversation-fetch query string (`scopeToQuery`, exported and unit-tested
directly), the empty-state icon/copy, and adds a `blockedError` state for
the new 403 (`AI_TUTOR_NOT_ENABLED`)/409 (`TUTOR_INSUFFICIENT_MATERIAL`)
responses. The Topic page resolves `advancedFeatures.aiTutor` server-side
and passes `aiTutorEnabled` down to `TopicTabs`, whose Study Tools tab
renders a real `<AIChatPanel kind="TUTOR">` when entitled (replacing the
old "coming in a later update" placeholder) or a short upgrade message
when not — UX-only gating; the actual enforcement is server-side.

Not implemented: Subject/Chapter/Group Tutor entry points (Topic only,
matching flashcards/quizzes), a standalone tutor conversation-history/list
page beyond the inline panel, one-question-at-a-time Socratic tutoring
mode, correctness evaluation of student answers, and weak-area tracking.

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

Flashcard and quiz models are fully implemented with generation and study UI (Phases 8.2 and 8.3). As of Phase 8.1 they carry Material's own scope shape
(`workspaceId`/`groupId`/`subjectId`/`chapterId`/`topicId`) instead of a
bare `topicId`, plus a `FlashcardReview` table for private per-user study
activity and a `sources` JSON provenance column on `Flashcard`/
`QuizQuestion` — see §15. `UsageRecord` is actively used to record AI usage (e.g., `"chat"`, `"tutor_chat"`, `"flashcard_generation"`);
current storage and recording usage are computed from live
Material/subscription aggregates.

Tracked migrations include the initial schema, nullable Subject workspace
ownership for groups, group invitation/activity/notification changes,
`Material.extractedText`, `Material.extractedPages`, and the Phase 8.1
Learning System foundation.

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

## 13. Learning System scope (Phase 8.1), flashcards (Phase 8.2), quizzes (Phase 8.3), AI Tutor (Phase 8.4), and Study Progress (Phase 8.5)

`FlashcardDeck` and `Quiz` reuse Material's own scope shape rather than a
new resolver: `subjectId`/`chapterId`/`topicId` narrow within an owner,
`workspaceId`/`groupId` always identify the owner, and an unattached
deck/quiz falls back to the owner's personal workspace. `lib/
learning-scope.ts` re-exports `lib/materials-scope.ts`'s
`resolveMaterialScope` under learning-domain names (`resolveLearningScope`)
rather than duplicating it. `lib/access.ts`'s `getAccessibleFlashcardDeck`/
`getAccessibleQuiz` (plus `requireFlashcardDeck`, added in Phase 8.2 for
the new deck page) follow `getAccessibleMaterial`'s owner-or-scope-
membership shape. A bare group scope (no subject/chapter/topic underneath
a Group, the way `AIConversation` supports for group chat) is not
supported yet, matching Material's own current limitation.

Shared learning *content* (`Flashcard`, `QuizQuestion`, including a
`sources` JSON provenance column reusing `AIMessage.sources`'s shape) is
kept structurally separate from private per-user learning *activity*
(`QuizAttempt`, and `FlashcardReview`) — one group's shared deck can be
reviewed by every member without any member seeing another's review
history, matching the same privacy model Phase 6.5 already applies to
group AI conversations.

`lib/validation/learning.ts` defines Zod schemas
(`flashcardGenerationItemSchema`, `quizQuestionGenerationItemSchema`) for
validating AI-generated flashcard/quiz JSON before it's persisted.
`flashcardGenerationItemSchema` is wired in as of Phase 8.2 (below);
`quizQuestionGenerationItemSchema` is not — that's Phase 8.3.

**Phase 8.2 — flashcard generation.** `lib/services/flashcard-generation.ts`
implements the real pipeline: `getAccessibleAIScope` (re-authorizes the
Topic and produces the same `ResolvedAIScope` AI chat retrieval already
uses — chosen deliberately over `resolveLearningScope` for this call site,
since a topicId input resolves to structurally the same fields either
way; see that file's doc comment) → `retrieveRelevantChunks` (real,
scope-limited retrieval — no bypassing RAG with a raw query) →
`AIService.chat()` with a grounding-only system prompt (no new
AIService method or provider client) → parse/validate the JSON twice
(raw AI shape, then the complete persisted shape with real
`chunksToSources()` provenance attached) → one `$transaction` writing a
`FlashcardDeck` + its `Flashcard`s. A Topic with nothing indexed yet
fails with `InsufficientSourceMaterialError` before the AI is ever
called, rather than falling back to general knowledge; unusable AI output
fails with `FlashcardGenerationOutputError` and persists nothing.
`recordAIUsage` runs under a new `"flashcard_generation"`
`AIUsageCategory` (a value that category's own doc comment already
anticipated) after persistence succeeds, matching the AI chat route's
best-effort placement.

`POST /api/topics/[topicId]/flashcards` is synchronous, deliberately
*not* the fire-and-forget `ProcessingJob` pattern audio transcription
uses — a bounded retrieval-plus-one-chat-call operation is the same cost
class as a single AI chat turn, so it gets the same request/response
shape as `POST /api/ai/conversations/[id]/messages`. `GET
/api/flashcards/[deckId]` returns a deck and its cards via
`getAccessibleFlashcardDeck`, ordered `id ASC` (cuid's built-in time
ordering — cards are created sequentially inside one transaction, where
Postgres's `now()` is fixed for the whole transaction, so `createdAt`
can't distinguish insertion order the way it does for models created
one-per-request elsewhere in this app). As of Phase 8.6 (below), each
card also carries the requesting user's own latest `FlashcardReview`
(never anyone else's). The Topic "Study Tools" tab's `PhasePlaceholder`
was replaced with a functional `FlashcardsStudyToolsPanel` plus a
`/flashcards/[deckId]` page — a real Study/Overview tabbed experience as
of Phase 8.6; Phase 8.2 itself only shipped the Overview (browse-all-
cards) half.

**Phase 8.3 — quiz generation and quiz-taking.**
`lib/services/quiz-generation.ts` mirrors `flashcard-generation.ts`'s
pipeline exactly (`getAccessibleAIScope` → `retrieveRelevantChunks` →
`AIService.chat()` → validate → attach real `chunksToSources()`
provenance → validate again → one transaction), applied to `Quiz`/
`QuizQuestion` instead of `FlashcardDeck`/`Flashcard`, and reusing the
*existing*, unmodified `quizQuestionGenerationItemSchema` from the Phase
8.1 corrective pass. No schema change was needed — unlike `Flashcard`,
`QuizQuestion` already had an explicit `order` column, so question
ordering doesn't depend on cuid/createdAt behavior the way card ordering
does. A generated quiz's `quizType` is inferred from the actual question
composition (a single type if the batch is uniform, `MIXED` otherwise) —
never a new enum value. Any `sources` the model supplies anyway is
stripped before validation; only real retrieved-chunk provenance is ever
persisted.

`lib/quiz-serialization.ts` is the critical security boundary: `toPublicQuiz`/
`toPublicQuizQuestion` strip `correctAnswer`, `explanation`, and `sources`
from every question before it can reach a quiz-taking browser. This is
applied to **both** `GET /api/quizzes/[quizId]` and the generation
route's own response (`POST /api/topics/[topicId]/quizzes`) — the person
who just generated a quiz is still a quiz-taking client and must not see
answers before submitting. `lib/quiz-scoring.ts` (pure, DB-free, no
database or AIService dependency) is the sole place a `QuizAttempt`'s
score is computed: MCQ/TRUE_FALSE by exact match, SHORT_ANSWER by
trimmed case-insensitive match — no second AI call for grading, no
fuzzy/semantic matching, and a type-mismatched or missing answer scores
as incorrect rather than throwing. `POST /api/quizzes/[quizId]/attempts`
filters submitted answers down to the quiz's own real question ids
before scoring (an unknown id is silently dropped, never scored or
persisted), then creates a `QuizAttempt` for the authenticated user only
and returns the real score plus the post-submission reveal of each
question's answer/explanation/sources. Group privacy is unchanged by this
phase: a group-owned Topic's generated `Quiz`/`QuizQuestion` are shared
like any other group content, and no route in this phase ever reads
another user's `QuizAttempt` rows. The Topic Study Tools tab now shows a
`QuizStudyToolsPanel` alongside the flashcard panel, and a minimal
`/quizzes/[quizId]` page (`QuizTakingView`) handles answering and
displays the server's result — no timer, no adaptive difficulty, no
per-question flip flow.

**Phase 8.4 — AI Tutor.** See "AI Tutor (Phase 8.4)" under §8 above for the
full design — documented there, not duplicated here, because it extends
the existing `AIConversation`/`AIMessage`/`AIChatPanel` infrastructure in
place (one new `kind` discriminator column), unlike flashcards/quizzes
above which introduced their own models. In short: `AIConversation.kind`
(`CHAT` default | `TUTOR`) keeps a Topic's plain "Ask AI" thread and its
Tutor thread as separate, equally-private rows, requires a real `topicId`,
is gated by a genuinely-enforced `advancedFeatures.aiTutor` plan
entitlement (`lib/ai-quota.ts`'s `assertAiTutorEntitlement`), and gets its
own rate-limit bucket, system prompt (`TUTOR_SYSTEM_INSTRUCTION`), and
`tutor_chat` usage category in the messages route. An earlier commit
(`0182b54`) had added an unreachable version of the rate-limit branch
before the schema column existed — see the ground-truth note at the start
of §8's Tutor subsection.

**Phase 8.5 — Study Progress.** Real, private, per-user aggregation over
`QuizAttempt` and Tutor-kind `AIConversation`/`AIMessage` rows — no new
`StudyProgress` model. A read-only audit performed before implementation
found `FlashcardReview` has no write path anywhere in the codebase (no
route ever creates one, and `FlashcardDeckView` has no
flip/correct-incorrect interaction), so flashcard progress was excluded
from this phase entirely rather than shown as a permanently-empty state;
`QuizAttempt.weakTopics` was likewise confirmed schema-only and left
untouched. `src/lib/study-progress.ts` exports `getQuizProgress(userId,
scope?)` and `getTutorActivity(userId, scope?)`: every query starts
`WHERE userId = userId`, and an optional, already-authorized
`ResolvedAIScope` narrows which `Quiz`/`AIConversation` rows count via
`lib/retrieval-scope.ts`'s existing `materialWhereForScope` — reused
unchanged, since `Quiz` and `AIConversation` share `Material`'s exact
five-field scope shape, so no new scope-to-where helper was written. No
scope at all is the true global aggregate for that user. Multiple
attempts on one quiz are never collapsed (`attempts`/`latest`/
`bestScore`/`averageScore` all computed across the full set, history
capped at 20), and multiple quizzes under one scope roll up together
since the where-clause narrows by the quiz's scope field, not a single
`quizId`. Tutor activity counts only `kind = TUTOR` conversations,
reading `AIConversation`/`AIMessage` directly rather than the
best-effort `tutor_chat` `UsageRecord` ledger. `GET /api/progress`
follows the identical validate → `getAccessibleAIScope` → aggregate
shape as `GET /api/ai/conversations` — same scope-authorization path,
no second authorization system, an inaccessible scope returns 403 rather
than a misleadingly-empty 200. Privacy is unchanged/reused: group-owned
Quiz/Topic content is shared, but `QuizAttempt`/`AIConversation` rows
stay strictly per-`userId`, verified by a test asserting two group
members who both took the same quiz never see each other's attempts. UI:
a "Your progress" summary inside the existing Topic Study Tools tab
(`StudyProgressPanel`) and a separate dashboard "Study Activity" section
(`StudyActivityWidget`) kept visually and semantically distinct from the
existing chapter-completion `ProgressRow` — the two are never merged.
No schema change and no new index; `QuizAttempt.userId` and
`AIConversation`'s existing `(userId, kind)` index already cover this
phase's queries. Not implemented in Phase 8.5: flashcard review
recording (added in Phase 8.6, below) and flashcard progress/mastery
(still not surfaced anywhere), study streaks or daily-activity buckets
(and therefore no timezone handling), `weakTopics` population,
per-question weak-topic analytics, and any general analytics beyond
this.

**Phase 8.6 — Flashcard Study & Review.** Activates the `FlashcardReview`
model Phase 8.1 already defined but nothing wrote to — no schema change.
`POST /api/flashcards/[deckId]/reviews` mirrors `POST
/api/quizzes/[quizId]/attempts`'s authorization shape exactly:
`getAccessibleFlashcardDeck` (the same check the GET route already uses)
gates deck access, then `db.flashcard.findFirst({ where: { id:
flashcardId, deckId: deck.id } })` confirms the submitted `flashcardId`
actually belongs to *this* deck before any write — a real flashcard id
that belongs to a different (even accessible) deck is rejected with 400,
closing the flashcardId-IDOR path. `userId` is never accepted from the
request body (`submitFlashcardReviewSchema` only has `flashcardId` and
`wasCorrect`); every `FlashcardReview` is created for the authenticated
session user. Multiple reviews per card are allowed and never collapsed
— append-only history, same posture as `QuizAttempt` — and nothing here
implements SM-2/FSRS, due-date scheduling, streaks, or any other
spaced-repetition or gamification mechanic; those remain explicitly out
of scope.

`GET /api/flashcards/[deckId]` now includes each card's own-user latest
review via a Prisma `include` scoped with `where: { userId: user.id },
orderBy: { reviewedAt: "desc" }, take: 1` — structurally incapable of
returning another user's rows, the same "the query itself is the privacy
boundary" pattern Phase 8.5's progress aggregation and the quiz-attempts
route both already rely on. The raw plural `reviews` array is never
returned; the route maps it down to a single `review: {...} | null`
field. The deck page (`src/app/(app)/flashcards/[deckId]/page.tsx`) does
the same scoped `include` directly (mirroring how the quiz-taking page
already fetches via `db` rather than calling its own GET route
internally) and passes the result to a new client `FlashcardDeckPage`
wrapper (`src/components/flashcards/flashcard-deck-page.tsx`) that adds a
`Study` / `Overview` tab pair using the existing `Tabs` primitive — the
deck page had no tab structure before this phase, so this is the
smallest fitting addition, not a new navigation pattern.
`FlashcardStudyView` (`src/components/flashcards/flashcard-study-view.tsx`)
is the actual one-card-at-a-time loop: reveal → Known/Not Known → real
`POST` to the reviews endpoint → advance only after a successful response
→ completion state with a local, session-only studied/known count (never
persisted, never a global metric). Revisiting a deck re-derives
already-reviewed state entirely from the server's per-card `review`
field on each fresh page load — nothing about "was this reviewed" is
cached or inferred client-side across visits. Card order stays the
existing stable `id asc` order regardless of prior review outcomes; nothing
reorders, filters, or schedules cards by review state. `FlashcardDeckView`
(the Phase 8.2 static list) is unchanged and lives on as the `Overview`
tab's content.

## 14. Testing

The project uses Vitest with Node environment and tests live beside the
covered code in `__tests__` folders. Existing coverage includes:

- validation schemas;
- chunking and page/timestamp provenance;
- document extraction and extraction idempotency guards;
- mocked Gemini and OpenAI embedding provider behavior;
- MIME, material links, styles, invitations, groups, and crypto;
- retrieval scope selection and Subject/Chapter descendant fixtures;
- AI scope and stored-conversation authorization;
- audio-player utility behavior;
- FlashcardDeck/Quiz scope authorization and learning generation-output
  validation schemas (Phase 8.1);
- the flashcard generation service and both flashcard API routes, mocked
  at the service/AIService boundary (Phase 8.2);
- the quiz generation service, all three quiz API routes, and pure
  quiz-scoring logic, mocked at the same boundary (Phase 8.3);
- AI Tutor (Phase 8.4): the real (non-mocked) `aiConversationScopeSchema`
  validation, the real `assertAiTutorEntitlement`/`getPlanLimits`
  entitlement logic (only `db` mocked), real `getAccessibleAIConversation`
  privacy behavior for TUTOR-kind rows (only `db` mocked — proves the
  schema-backed production path, not an assumed shape), both
  `/api/ai/conversations` routes' kind-scoped behavior, the messages
  route's Tutor branch, `TUTOR_SYSTEM_INSTRUCTION` content, and
  `AIChatPanel`'s `scopeToQuery` contract;
- Study Progress (Phase 8.5): `lib/study-progress.ts`'s quiz-progress and
  Tutor-activity aggregation (multi-attempt/multi-quiz-under-one-topic
  rollups, TUTOR-vs-CHAT exclusion, zero-activity and zero-question
  edge cases, user-isolation on a shared group quiz) and `GET
  /api/progress`'s scope validation, `getAccessibleAIScope` resolution,
  and inaccessible-scope rejection;
- Flashcard Study & Review (Phase 8.6): `POST
  /api/flashcards/[deckId]/reviews`'s full authorization/validation
  surface (auth, deck access incl. group-owned decks, malformed/missing
  payload, flashcardId-not-in-this-deck IDOR rejection, client-supplied
  `userId` having no effect, multiple reviews per card), and `GET
  /api/flashcards/[deckId]`'s per-user latest-review scoping (the
  `include`'s `where: { userId }` argument, the singular `review` field
  replacing the raw `reviews` array, `review: null` for an unreviewed
  card, and a second user never seeing the first user's review).

The suite does not make live cloud-provider calls and does not replace
database-backed integration testing. Run:

```text
npm run test
npm run lint
npm run typecheck
```

## 15. Known limitations and next work

- Embedding provider registry activation is still required for real indexed
  RAG in this checkout.
- AI chat is non-streaming and has limited UX actions.
- No AI summaries, suggested prompts, or generated questions outside of
  flashcard/quiz generation.
- AI Tutor (Phase 8.4) is Topic-scoped only — no Subject/Chapter/Group
  entry point, no standalone conversation-history page, no Socratic
  one-question-at-a-time mode, no answer evaluation, no weak-area
  tracking.
- Processing is fire-and-forget and needs a persistent Node runtime.
- S3 read proxy buffers objects instead of true byte-range streaming.
- No OCR for scanned/image-only documents.
- No continuous Drive synchronization.
- Google-native Slides are not imported.
- No distributed rate limiting, usage ledger, or production observability.
- Real Quiz-progress and AI-Tutor-activity aggregation exist (Phase 8.5:
  `GET /api/progress`, Topic "Your progress" panel, dashboard "Study
  Activity" widget). Flashcard review recording now exists too (Phase
  8.6: `POST /api/flashcards/[deckId]/reviews`, `FlashcardStudyView`),
  but flashcard progress/mastery is still not surfaced anywhere (not
  added to `GET /api/progress` or either progress UI), and study streaks,
  daily-activity buckets, and spaced repetition (SM-2/FSRS, due-date
  scheduling, or any other scheduling algorithm) remain unimplemented by
  design. Phase 9 billing/production-hardening work is also not
  implemented.
