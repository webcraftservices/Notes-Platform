# ARCHITECTURE.md — Current Application Architecture

This describes the application **as it actually exists right now**, verified
against the code (not the plan). For the phase-by-phase history of *why*
each decision was made, see `docs/ARCHITECTURE.md` (a chronological
decision log — kept for context, not the primary reference anymore). For
what's implemented vs. not, see `PROJECT_STATE.md`. For rules on changing
any of this, see `CLAUDE.md`.

---

## Stack

Next.js 14 (App Router, TypeScript) · PostgreSQL + Prisma + pgvector ·
NextAuth · Tailwind CSS · Zod · Vitest.

One deployable unit — route handlers ARE the API, no separate backend
process. The one thing that will eventually need to split out is
background job execution (see "Audio recording & transcription" below).

## Frontend structure

```
src/app/
├── (auth)/              sign-in, sign-up — own layout, no sidebar
├── (app)/                the authenticated shell (sidebar + command palette)
│   ├── layout.tsx          fetches user/workspace/plan, renders Sidebar + MobileNavDrawer
│   ├── home/               dashboard
│   ├── subjects/            list → [subjectId] → chapters/[chapterId] → topics/[topicId]
│   ├── materials/           list + [materialId] detail/preview/transcript
│   ├── groups/               static placeholder (Phase 6 not built)
│   ├── assistant/             static placeholder (Phase 5 not built)
│   ├── search/                structural (name-only) search
│   └── settings/
├── onboarding/            two-step flow, NOT inside (app) — no sidebar during onboarding
└── api/                   see "Backend / API structure" below
```

Route groups `(auth)`/`(app)` don't affect URLs, only which layout wraps
the page. Middleware (`src/middleware.ts`) gates page routes by session
presence only — per-resource authorization always happens again inside
the page/route handler via `lib/access.ts`.

**Component organization** (`src/components/`): one folder per feature
area (`materials/`, `notes/`, `subjects/`, `chapters/`, `topics/`,
`shell/`, `dashboard/`, `settings/`, `search/`, `auth/`, `onboarding/`),
plus `ui/` for generic primitives (Button, Dialog, DropdownMenu, Tabs,
Input, Textarea, Badge, Skeleton, EmptyState, ConfirmDialog) and
`shared/` for cross-feature pieces (EditableHeader, PhasePlaceholder).

**State management**: mostly none — server components fetch data
directly via Prisma, client components use local `useState`. The one
global client store is `lib/stores/ui-store.ts` (Zustand) — used only for
UI state that needs to be triggered from more than one place (e.g. the
"create subject" dialog openable from both the command palette and the
Subjects page's empty state; the mobile nav drawer's open state).

**Design tokens**: `tailwind.config.js` — a warm paper/graphite palette
with a single amber "highlighter" accent color reserved for AI-flagged
importance (not yet used anywhere, since Phase 5's AI features that would
flag importance don't exist yet). Typography: Source Serif 4 (display) +
Inter (body/UI) + IBM Plex Mono (timestamps/code), loaded in
`src/app/layout.tsx`.

## Backend / API structure

24 route handlers under `src/app/api/`, grouped by resource:

| Area | Routes |
|---|---|
| Auth | `auth/[...nextauth]`, `auth/register` |
| Hierarchy | `subjects`, `subjects/[id]`, `subjects/[id]/chapters`, `chapters/[id]`, `chapters/[id]/topics`, `topics/[id]` |
| Notes | `topics/[id]/note` (get-or-create), `notes/[id]` (title), `notes/[id]/blocks` (bulk autosave), `notes/[id]/versions`, `notes/[id]/versions/[vid]/restore` |
| Materials | `materials`, `materials/upload-url`, `materials/[id]`, `materials/[id]/complete`, `materials/[id]/transcribe` |
| Storage | `storage/upload` (local-backend write sink), `storage/read` (proxied read, both backends) |
| Misc | `profile`, `onboarding`, `search`, `recording-usage`, `health` |

**Every route handler** starts with `getSessionUser()` (not just relying
on middleware — most of these routes aren't in `middleware.ts`'s matcher
at all) and resolves resource access through `lib/access.ts`, never an
inline `where` clause. Validation is Zod schemas from `lib/validation/`.
Errors go through `lib/api-response.ts`'s shared helpers.

**Notable non-obvious behavior**:
- `notes/[id]/blocks` diffs incoming block IDs against what's already in
  the DB for that note — it never blindly upserts by client-supplied ID
  (a real access-control bug was caught and fixed here: a client-supplied
  ID colliding with another note's block would otherwise let one user
  overwrite another user's content).
- `materials/[id]/transcribe` creates a `ProcessingJob` row and calls
  `runTranscriptionJob()` **without awaiting it** — the HTTP response
  returns immediately (202), the client polls `GET /materials/[id]` for
  status. See "Audio recording & transcription" below for why.

## Database / Prisma structure

Single `prisma/schema.prisma`, ~35 models. One migration currently exists
(`prisma/migrations/20260823142337_initial_schema/`) and matches the
current schema — no drift detected at last inspection.

**Core hierarchy** (all soft-deletable via `deletedAt`, archivable via
`archivedAt`): `Workspace` → `Subject` → `Chapter` → `Topic`. A `Material`
can attach at any level (`workspaceId` always set; `subjectId`/
`chapterId`/`topicId` optionally set, each implying the levels above it —
enforced by `lib/materials-scope.ts`, never trusted independently from
the client) or be "Unorganized" (workspace-level only).

**Notes**: `Note` (one per Topic by UI convention, though the schema
allows more — `topicId` is a plain nullable FK, not unique) →
`NoteBlock[]` (ordered, typed via `NoteBlockKind` enum) → `NoteVersion`
(full snapshots, not diffs).

**Materials/audio**: `Material` → `Transcript` (1:1) →
`TranscriptSegment[]` (ordered, with `speakerLabel` when the provider
diarized). `MaterialChunk` exists in the schema (for future RAG
embedding) but nothing writes to it yet — Phase 5 territory.

**Processing**: `ProcessingJob` (generic — `type` enum includes
`TRANSCRIPTION` and several Phase 5+ job types that don't have
implementations yet, e.g. `AI_NOTE_GENERATION`, `EMBEDDING`).

**Not yet used by any application code** (schema exists, nothing reads/
writes it): `Group`/`GroupMember`/`GroupInvitation`/`ActivityLog` (Phase
6), `FlashcardDeck`/`Flashcard`/`Quiz`/`QuizQuestion`/`QuizAttempt`
(Phase 8), `AIConversation`/`AIMessage` (Phase 5), `ConnectedAccount`
(Phase 7), `UsageRecord` (Phase 9 — usage is currently computed via live
aggregation in `lib/storage-usage.ts`/`lib/recording-usage.ts`, not a
ledger).

**Access pattern**: every model that needs authorization has a matching
pair in `lib/access.ts` — `getAccessibleX(id, userId)` (throws
`NotAuthorizedError` or returns `null`) for route handlers, and
`requireX(id, userId)` (calls Next's `notFound()` on either failure mode
— deliberately indistinguishable) for server components. Access resolves
through exactly one of: ownership (`ownerId`/`authorId` match), workspace
membership, or group membership.

## Authentication

NextAuth with JWT sessions (not database sessions — avoids a DB round
trip in middleware). Two providers:
- **Credentials** (email/password): bcrypt cost 12, validated via
  `lib/validation/auth.ts`, registration rate-limited via
  `lib/rate-limit.ts` (in-memory — see Known limitations).
- **Google OAuth**: sign-in-only scopes. Drive/Docs scopes (Phase 7) are
  a deliberately separate, later consent flow, not requested at login.

New-account provisioning (`lib/provision.ts`) is shared between both
signup paths (OAuth's `createUser` event and the credentials
`/api/auth/register` handler) so they can't drift: creates `Profile`,
`Subscription` (FREE plan), and exactly one personal `Workspace`.

`src/middleware.ts` gates page routes (not most API routes — see
"Backend / API structure") by session presence only.

## Storage

`lib/services/storage.ts` is a registry: `getStorageService()` returns
either `LocalStorageService` or `S3StorageService` based on
`STORAGE_PROVIDER` (or inferred from which S3 env vars are set; defaults
to local).

- **`LocalStorageService`** (`storage-local.ts`): real filesystem reads/
  writes under `STORAGE_LOCAL_DIR` (default `./.storage`, gitignored).
  "Upload URL" and "read URL" are both same-origin app routes
  (`/api/storage/upload`, `/api/storage/read`) that re-check session +
  material ownership on every request — there's no separate signed-token
  layer because the session cookie already IS the correct check.
- **`S3StorageService`** (`storage-s3.ts`): real AWS SDK v3, real
  presigned URLs for upload. Also exposes a non-interface method
  `getObjectBuffer(key)` used server-side by the transcription
  orchestrator and by the storage-read proxy (see below).

**Reads are proxied through `/api/storage/read` for BOTH backends** (this
changed after Phase 4 — originally only local was proxied, S3 returned a
direct presigned GET URL). The proxy avoids browser CORS failures against
object storage for `<audio>`/`<video>` playback. For the S3 path, this
means downloading the full object into memory on every read/range request
— no true byte-range streaming from S3 itself. Uploads remain direct
browser→S3 (efficient, standard, unaffected by the read-side change).

## Audio recording & transcription system

**Recording** (`components/materials/recorder-panel.tsx`): browser
`MediaRecorder` (WebM/Opus, MP4 fallback), a real amplitude-driven level
meter via Web Audio `AnalyserNode` (not decorative), device selection.
Before upload, `webm-duration-fix` patches the WebM container's duration
metadata — `MediaRecorder` output doesn't include it, which otherwise
leaves `HTMLAudioElement.duration` as `Infinity`.

**Upload**: shared with the drag-drop uploader via
`lib/hooks/use-material-upload.ts` (request signed URL → XHR PUT with
real progress events → call completion endpoint) — one upload pipeline
for both a picked `File` and a recorded `Blob`.

**Metadata extraction** (`lib/metadata-extraction.ts`): non-AI, runs
synchronously on upload completion — page count (`pdf-lib`), image
dimensions (`image-size`), audio/video duration (`music-metadata`). Only
implemented for the local storage backend (S3-backed materials skip
this — see `PROJECT_STATE.md`).

**Transcription** (`lib/transcription.ts` + `lib/services/speech*.ts`):
`SpeechService` interface, two real cloud implementations selected via
`SPEECH_PROVIDER`:
- `AssemblyAISpeechService` — recommended default, real speaker
  diarization, upload→create-transcript→poll REST flow, no practical
  file-size limit.
- `OpenAIWhisperSpeechService` — segment timestamps via `verbose_json`,
  no diarization, hard-checks the 25MB request limit before ever calling
  the API.

Neither is a local/on-device model — this is intentional (cloud-only, per
explicit project requirement).

`runTranscriptionJob(jobId)` is the orchestrator: resolves audio bytes
from whichever storage backend is active, calls the configured
`SpeechService`, writes real `Transcript`/`TranscriptSegment` rows, or a
real `FAILED` `ProcessingJob` with the provider's actual error — never a
fabricated transcript.

**Execution model**: fire-and-forget from the route handler (not
awaited), relying on the Node process staying alive after the HTTP
response — correct on `next dev`/`next start` on a persistent server,
**broken on request-scoped serverless platforms** (Vercel functions
freeze after the response completes). The client polls
`GET /api/materials/[id]` for job status. The documented upgrade path is
a real queue (BullMQ+Redis, SQS, etc.) consuming from the same
`ProcessingJob` table — the table was already modeled generically enough
in Phase 1 to support this without a schema change.

**Playback sync**: `AudioPlayer` (`components/materials/audio-player.tsx`)
exposes an imperative `seek`/`play` handle via `forwardRef`, letting the
transcript viewer jump playback to a clicked segment's timestamp. The
progress bar animation is `requestAnimationFrame`-driven with direct
`transform` DOM writes (no CSS transition, no React state per frame) —
see `CLAUDE.md` for why this must not be "simplified" back to something
that looks more conventional but visually stutters.

## Important service abstractions

All under `src/lib/services/`, all following the same shape: an
interface in `interfaces.ts`, one or more concrete implementation files,
and a registry function that throws `ServiceNotConfiguredError` (never
returns a fake-success stub) when required env vars are missing.

| Interface | Registry fn | Implementations | Status |
|---|---|---|---|
| `StorageService` | `getStorageService()` | Local, S3 | Both real |
| `SpeechService` | `getSpeechService()` | OpenAI Whisper, AssemblyAI | Both real |
| `AIService` | `getAIService()` | none | Registry throws `ServiceNotConfiguredError` (Phase 5, provider-free by explicit decision) |
| `EmbeddingService` | `getEmbeddingService()` | none | Registry throws `ServiceNotConfiguredError` (Phase 5, provider-free by explicit decision) |
| `VisionService` | — | none | Interface only, Phase 4/5 (unused) |
| `DocumentProcessingService` | — | none | Interface only, unused — no PDF/DOCX/PPTX text extraction yet, so those material types aren't chunkable/indexable in Phase 5's RAG pipeline |

Note: `interfaces.ts`'s own top comment references a `registry.ts` file
that doesn't exist — the registry functions live directly in per-area
files (`storage.ts`, `speech.ts`, and now `embedding.ts`/`ai.ts`) instead.
Phase 5 confirmed this is the actual established pattern (a stale
comment, not a structural issue) rather than "fixing" it toward a single
`registry.ts` that nothing else uses.

## Data flow (typical: record → transcribe → view)

1. Browser records audio → `RecorderPanel` → `useMaterialUpload` hook →
   `POST /api/materials/upload-url` (creates `Material` row, status
   `UPLOADING`, returns a signed/proxied upload target)
2. Browser PUTs bytes directly to that target (S3: real presigned PUT to
   S3; local: `PUT /api/storage/upload`)
3. Browser calls `POST /api/materials/[id]/complete` → server reads the
   file back, runs metadata extraction (local backend only), sets status
   `READY`
4. User clicks "Transcribe" (or the Recorder flow, once wired, will do
   this automatically — currently manual, see `PROJECT_STATE.md`) →
   `POST /api/materials/[id]/transcribe` → creates `ProcessingJob`,
   fires `runTranscriptionJob()` without awaiting, returns 202
   immediately
5. Client polls `GET /api/materials/[id]` every few seconds until the job
   is `SUCCEEDED`/`FAILED`
6. On success, `Transcript`+`TranscriptSegment` rows exist; the material
   detail page and the Topic's Transcript tab render them via
   `MaterialTranscribeSection`

## Key dependencies (why each is here)

- `@tiptap/*` — block-level rich text editing (notes)
- `@dnd-kit/*` — drag-to-reorder (note blocks)
- `@aws-sdk/client-s3` + `s3-request-presigner` — real S3 backend
- `pdf-lib`, `image-size`, `music-metadata` — non-AI metadata extraction
- `webm-duration-fix` — patches MediaRecorder's missing WebM duration
- `cmdk` — command palette
- `next-auth` + `@auth/prisma-adapter` — auth
- `zod` — validation (shared client/server schemas)
- `zustand` — the one small global UI store
- `sonner` — toast notifications
- `date-fns` — relative timestamps

## Relationships between major modules (safe-modification notes)

- `lib/access.ts` is a hard dependency of nearly every route handler and
  server component. Changing its function signatures has wide blast
  radius — grep for the function name before changing one.
- `lib/services/storage.ts` and `lib/transcription.ts` are coupled via
  duck-typing (`instanceof LocalStorageService` / `instanceof
  S3StorageService` checks, plus one `as any` cast to call
  `getObjectBuffer` on whichever backend is active from the storage-read
  route). This is intentional — `getObjectBuffer` is NOT part of the
  public `StorageService` interface because most callers never need raw
  bytes. If a third storage backend is ever added, it needs its own
  `getObjectBuffer`-equivalent and both call sites need updating.
- `components/materials/upload-material-dialog.tsx` bundles three
  concerns (file upload, recording, link-add) behind one uncontrolled
  dialog component. Anything that wants to open it pre-set to a specific
  tab from outside (e.g. the command palette) currently can't without a
  controlled-component refactor — noted as a known gap, not yet done.
- The Topic page's Transcript tab (`topic-transcripts-panel.tsx`) and the
  Material detail page's transcribe section
  (`material-transcribe-section.tsx`) both independently query
  transcript/job status — there's no shared data-fetching layer between
  them. Changing the shape of either query's response requires checking
  both call sites.

# Phase 5 — AI notes, RAG & AI chat

## What was built

**Provider-free by explicit decision.** No AI/embedding SDK
(Anthropic/OpenAI/Google) was added as a dependency, no API key is
required, and nothing fabricates a response. `getAIService()` and
`getEmbeddingService()` (`lib/services/ai.ts`, `lib/services/embedding.ts`)
always throw `ServiceNotConfiguredError` today — every feature below is
fully wired end-to-end against the real interfaces and fails honestly at
exactly that one point. See `docs/ai-setup.md` for how to activate a real
provider later without touching anything else in this list.

**Chunking** (`lib/chunking.ts`): deterministic, dependency-free —
whitespace word-splitting with a fixed word-count window (220) and
overlap (40), no tokenizer library. `chunkTranscriptSegments` is the
variant actually used today: it flattens `TranscriptSegment` rows to a
per-word list (each word remembering its segment's start/end seconds), so
each output chunk's timestamp span reflects exactly which segments its
words came from — not the segment boundaries themselves. Full limitations
(word-count ≠ token-count, no sentence-awareness, space-delimited-language
assumption) are documented in the file's own doc comment, not repeated
here.

**Indexing** (`lib/ingestion.ts`): `runEmbeddingJob(jobId)` mirrors
`runTranscriptionJob`'s exact shape (RUNNING → real work → SUCCEEDED/
FAILED). Triggered as a fire-and-forget `EMBEDDING` `ProcessingJob`
immediately after a transcription job SUCCEEDS (the one edit to
`transcription.ts` this phase made). Chunks are written via raw SQL
(`tx.$executeRaw`) because `MaterialChunk.embedding` is
`Unsupported("vector(1536)")` in the Prisma schema — the typed client can
neither read nor write that one column, everything else on the row still
goes through normal Prisma calls inside the same transaction. Only
audio/video materials (via their `Transcript`) are chunkable right now —
`DocumentProcessingService` has no implementation, so PDF/DOCX/PPTX
materials simply have nothing to index yet (the job SUCCEEDS with zero
chunks written for those, since "nothing to index" isn't a failure).

**Retrieval** (`lib/retrieval.ts`): real pgvector cosine-distance search
(`<=>` operator) via `db.$queryRaw`, restricted to materials in an
already-authorized scope that retrieval re-derives itself (never trusts a
caller-supplied material ID list). Skips the embedding call entirely
(returns `[]`) when nothing's indexed yet for the scope, rather than
tripping an avoidable configuration error on every message sent to a
freshly-created topic.

**Scope resolution** (`lib/access.ts`): `getAccessibleAIScope` mirrors
`resolveMaterialScope`'s cascade (narrowest-wins: topic > chapter >
subject > workspace) and reuses `materials-scope.ts`'s documented
guarantee that every `Material`'s narrower FKs are mirrored consistently
up to `workspaceId` — so filtering on one FK field is sufficient, no OR
across levels needed. `getAccessibleAIConversation` re-checks the
underlying scope's access on every read/write (not just conversation
ownership), since workspace/subject/chapter/topic membership can change
after a conversation was created.

**AI chat** (`/api/ai/conversations`, `/api/ai/conversations/[id]/messages`,
`AIChatPanel`): one active conversation per (user, scope) — mirrors Phase
3's "one note per topic" simplification. A message turn retrieves chunks,
builds a numbered context block (`lib/ai-chat.ts`), calls
`AIService.chat()`, and persists BOTH the user and assistant messages in
one transaction — **only if the AI call actually succeeds**. If
`AIService`/`EmbeddingService` aren't configured (always true today) or
the call otherwise fails, nothing is persisted and the route returns a
real 503; the UI shows a config-error banner rather than a fake assistant
bubble, and never leaves an orphaned user-only turn in history. Used at
two scopes: Topic (`TopicTabs`' AI Chat tab) and workspace/global (the
Assistant page) — Chapter/Subject-scoped UI isn't built yet even though
the backend supports it (see "Known limitations").

**AI note generation** (`lib/note-generation.ts`,
`/api/materials/[id]/generate-notes`): `AI_NOTE_GENERATION` job, same
orchestrator shape as transcription/embedding. Scoped per-Material (like
`runTranscriptionJob`), requires the material to be topic-attached with a
READY transcript. On success (once a provider exists), appends
`NoteBlock`s after the note's current highest `order` and writes a
`NoteVersion` snapshot first if blocks already existed — never deletes or
overwrites manual notes. `GenerateAINotesButton` +
`NotesTabPanel` wrap the existing `NoteEditor` (Phase 3) via a
remount-`key` trick rather than modifying its internals, since it has no
built-in refetch prop.

## Key decisions

- **pgvector kept exactly as migrated in Phase 1** — `vector(1536)`, no
  new migration. `EMBEDDING_DIMENSIONS = 1536` in `embedding.ts` is the
  single source of truth other code should reference; `runEmbeddingJob`
  asserts a configured `EmbeddingService.dimensions` matches it before
  ever calling `.embed()`, so a mismatched provider fails loudly at job
  start, not with a silently-wrong pgvector insert.
- **Chunking has no tokenizer dependency** — word-count-based, not a
  `tiktoken` (or similar) call. This was an explicit project constraint,
  not an oversight; a real tokenizer is documented future work in
  `docs/ai-setup.md`, tied to whichever provider gets chosen (different
  providers tokenize differently).
- **A failed AI chat turn persists nothing.** Considered persisting the
  user's message regardless and only failing the assistant reply, but
  that leaves orphaned user-only turns cluttering history for every
  message sent while unconfigured (which, in this codebase's current
  state, is every message). Persisting both-or-neither keeps retries
  clean and history meaningful once a provider is added.
- **Indexing is automatic, not a user action.** A successful transcription
  immediately queues an `EMBEDDING` job — consistent with spec's "RECORD →
  UNDERSTAND → ORGANIZE → SEARCH → ASK → LEARN" pipeline framing (indexing
  isn't a separate user-visible step, it's part of what "finishing"
  processing a lecture means). AI note generation, by contrast, IS a
  manual user action (`GenerateAINotesButton`) — an unsolicited rewrite of
  someone's notes is a very different kind of action than making them
  searchable, and the master prompt is explicit that AI organization is
  never forced on the user without a click.
- **`getOrCreateTopicNote` extracted to `lib/notes.ts`** so the existing
  note route and the new note-generation job share one implementation
  (`CLAUDE.md`'s "every new Prisma model access pattern" rule) — a small,
  behavior-preserving refactor of Phase 3 code, not a redesign.
- **`ProcessingJob` polling gained a generic endpoint**
  (`GET /api/processing-jobs/[jobId]`) rather than teaching
  `/api/materials/[id]` a second job-type-specific response shape — AI
  note generation's result lives on a Topic's Note, not the Material
  itself, so there's no single natural "parent resource" to attach status
  to the way transcription attaches to its Material.

## Known limitations (by design, not oversights)

- **Everything in this phase currently fails with a real configuration
  error** — no `AIService`/`EmbeddingService` implementation exists. This
  is the entire point of "provider-agnostic scaffold only" as approved;
  see `docs/ai-setup.md` for activation.
- **Only audio/video materials are indexed/chat-able.** PDF/DOCX/PPTX
  text extraction (`DocumentProcessingService`) has no implementation —
  unrelated to Phase 5's scope, blocked on a Phase 3/4-era interface that
  was never filled in.
- **No streaming.** `AIService.chat()` stays Promise-based this phase, per
  explicit scope. `AIChatPanel` waits for the full response.
- **Chat UI exists at Topic and workspace scope only** — the backend
  (`getAccessibleAIScope`, the conversations routes) fully supports
  Chapter- and Subject-scoped conversations too, but Chapter/Subject pages
  are single-view (not tabbed) in this codebase and restructuring them
  into tabs to fit an "Ask AI" panel would be a Phase 2 UI redesign, which
  this phase's constraints explicitly ruled out. Adding it later is a
  small, additive change (reuse `AIChatPanel` with a different `scope`
  prop) once/if those pages grow tabs for another reason.
- **Group-scoped AI conversations are schema-only.**
  `AIConversation.groupId` exists but `getAccessibleAIScope` still
  doesn't resolve it. A group membership/role model *does* now exist
  (`lib/access.ts`'s `getGroupRole`/`requireGroupRole`, Phase 6.1), but
  wiring it into `getAccessibleAIScope`/`ResolvedAIScope` and
  `lib/retrieval.ts`'s `materialWhereForScope` is explicitly Phase 6.5
  work, not done yet.
- **`db.aIConversation`/`db.aIMessage` property names are unverified
  against a real generated Prisma client** in the session that wrote
  this code (no network access to `binaries.prisma.sh` — same limitation
  documented for the rest of the Prisma-cascade typecheck errors). They
  follow Prisma's documented "lowercase only the first character" model
  naming rule, matching existing patterns like `db.processingJob`, but
  this should be the first thing checked if Phase 5 doesn't compile after
  a real `prisma generate`.

## Phase 5 verification checklist

- [ ] `npm run db:generate` succeeds (needs real network access to
      `binaries.prisma.sh` — did not succeed in the session that wrote
      this code) — confirms `db.aIConversation`/`db.aIMessage` and the
      rest of the Prisma-derived types actually compile
- [ ] With no `AI_PROVIDER`/`EMBEDDING_PROVIDER` configured (or set but no
      implementation added): open a Topic's AI Chat tab, send a message —
      see a real "AI chat isn't configured yet" banner, not a fake reply;
      confirm nothing was persisted (`AIMessage` table stays empty for
      that attempt)
- [ ] Transcribe an audio material to completion — confirm an `EMBEDDING`
      `ProcessingJob` was auto-created and ends `FAILED` with a real
      `ServiceNotConfiguredError` message (proves the integration hook
      fired, even though it can't succeed without a provider)
- [ ] Click "Generate AI Notes" on a topic with a transcribed lecture —
      confirm the job ends `FAILED` with a real error, and that the
      topic's existing manual notes are completely untouched
- [ ] Once a real `AIService`/`EmbeddingService` is added (see
      `docs/ai-setup.md`): re-run the above and confirm real indexed
      chunks, a real AI reply with clickable sources that jump to the
      correct audio timestamp, and real appended `NoteBlock`s
