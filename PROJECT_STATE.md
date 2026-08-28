# PROJECT_STATE.md — Current State

Last verified against actual code and a real test/lint/typecheck run on
**2026-08-27**. If you're reading this in a later session, re-run the
verification commands in the "How to verify this document" section
before trusting anything time-sensitive here — code may have moved on.

> Cloned directly from `webcraftservices/Notes-Platform` on GitHub this
> session — this document is reconciled against the live repo, not a
> stale local checkout.

---

## Current phase

**Phase 5 (AI notes + RAG + AI chat) is COMPLETE and formally closed.**
Built provider-free by explicit user decision — no AI/embedding SDK, no
API keys, no fake responses. See `docs/ai-setup.md` for how to activate a
real provider later. Phases 1–4 remain complete and unmodified except for
one small, behavior-preserving refactor (see "Recent work completed"
below).

Two known issues were investigated during Phase 5 closeout and are
recorded below as **explicitly deferred, non-blocking** — see "Known
deferred issues (Phase 5 closeout)". Neither blocks Phase 6.

**The current codebase (as of this closure) is the baseline for Phase 6.**
Do not re-open or re-attempt either deferred issue as part of Phase 6 work
unless the user explicitly asks for it again.

Phases 1–5, per the master prompt's own phase breakdown:
- [x] Phase 1 — Architecture, database, authentication
- [x] Phase 2 — Dashboard + Subject/Chapter/Topic system
- [x] Phase 3 — Notes editor + materials
- [x] Phase 4 — Audio recording + transcription
- [x] Phase 5 — AI notes + RAG + AI chat (provider-free scaffold — see below) — **CLOSED**
- [ ] Phase 6 — Groups + collaboration (not started; page placeholders only)
- [ ] Phase 7 — Google Drive/Docs (not started)
- [ ] Phase 8 — Flashcards + quizzes + AI tutor (not started)
- [ ] Phase 9 — Security + performance + production polish (not started)

## Known deferred issues (Phase 5 closeout)

Both investigated this session. Both are **deferred, not blockers**. Do
not attempt to fix either without an explicit new request.

1. **Legacy recordings can be inaudible.** Recordings created before the
   WebM-duration finalization behavior existed can still fail to play in
   the browser. Transcripts for these recordings remain available and
   correct. New/current recordings are unaffected: preview, duration,
   playback, and refresh all work correctly.

   A targeted compatibility fix was already attempted: RFC 7233-compliant
   Range-header parsing (including suffix byte-ranges) in
   `/api/storage/read`, unit tests for that parser, and a duration
   fallback in `AudioPlayer` using the existing server-side
   `Material.durationSeconds`. This fix is real, tested, and merged (see
   "Recent work completed" below) — it corrects a genuine spec bug in
   Range handling and is expected to help in general — but manual browser
   testing after applying it still showed some old recordings remaining
   inaudible. The exact remaining cause for those specific files was not
   further isolated in this session.
   - Do NOT modify the recording system, storage system, WebM
     finalization, or `AudioPlayer` to chase this further without an
     explicit new request.
   - Do NOT delete or modify the old recordings.
2. **Audio progress bar visual polish.** Playback for current/new
   recordings works and the position tracking is correct, but the visual
   fill still doesn't read as a fully premium continuously-filling bar in
   all cases. Multiple rAF/transform iterations were already attempted
   (see "Recent work completed" and "Failed approaches" below).
   - Do NOT attempt another redesign of the progress animation without an
     explicit new request. The current implementation is frozen.

Both: new/current recordings are fully functional; the core
recording → transcription → playback pipeline works; only legacy files
and cosmetic polish are affected. Neither is a Phase 6 blocker.

## What's actually implemented (verified in code, not assumed)


**Auth**: email/password (bcrypt) + Google OAuth via NextAuth, JWT
sessions, `middleware.ts` route gating, real registration rate-limiting.

**Workspace/hierarchy**: one personal Workspace per user (auto-provisioned
at signup), Subject → Chapter → Topic CRUD with archive + soft-delete,
cascading soft-delete (Subject delete also soft-deletes its Chapters and
Topics).

**Notes**: one auto-created Note per Topic, Tiptap block editor
(bold/italic/heading/lists/links per block), `dnd-kit` drag-to-reorder,
autosave (800ms debounce), throttled version snapshots (max 1 automatic
snapshot per 10 minutes + one per explicit "Save version"), non-destructive
restore.

**Materials**: upload (drag-drop, real XHR progress), link-add, list with
filters (All/Unorganized/Archived) + search, rename, move (cascading
Subject→Chapter→Topic picker), tag, archive, soft-delete with real
storage-object cleanup. Server-side plan-limit enforcement (per-file size
+ total storage quota, checked against real usage aggregates, not
client-trusted). Non-AI metadata extraction on upload completion (PDF page
count via `pdf-lib`, image dimensions via `image-size`, audio/video
duration via `music-metadata`) — local backend only, see Known
issues/limitations.

**Previews**: PDF (native browser iframe), image (zoom toggle), video
(native controls), text (fetches and renders real content), audio (custom
player — see below), and an honest "no in-app preview" screen with a
working download button for DOCX/PPTX (never a fake render).

**Audio recording**: `MediaRecorder` (WebM/Opus, MP4 fallback), real
mic-level meter via `AnalyserNode` (not decorative), device selection,
pause/resume/cancel/stop, `webm-duration-fix` applied before upload (fixes
`audio.duration === Infinity` on freshly recorded WebM), monthly
recording-minutes usage check before allowing a new recording to start.

**Transcription**: `SpeechService` abstraction with two real (cloud-only,
no local model) providers — `AssemblyAISpeechService` (recommended,
real speaker diarization, no practical file-size limit) and
`OpenAIWhisperSpeechService` (cheaper, segment timestamps, no diarization,
25MB hard limit checked client-side before any request). `ProcessingJob`
architecture with fire-and-forget execution + client polling. Transcript
viewer with click-a-timestamp-to-seek, synced to the audio player via a
`forwardRef` imperative handle.

**Storage**: `LocalStorageService` (real filesystem, fully working,
zero-config default) and `S3StorageService` (real AWS SDK presigned
URLs). Uploads always go through `createUploadUrl()` (direct-to-S3 for
the S3 backend, app-proxied for local). **Reads/playback are proxied
through `/api/storage/read` for BOTH backends now** (see "Recent changes"
— this changed since Phase 4 was first built) to avoid browser CORS
issues against S3-style object storage.

**UI shell**: sidebar + mobile drawer, breadcrumbs, Cmd/Ctrl+K command
palette with live search, toast notifications, light/dark/system theme.

**AI/RAG (Phase 5, provider-free)**: deterministic word-based chunking
(`lib/chunking.ts`, no tokenizer dependency); `EMBEDDING` `ProcessingJob`s
auto-triggered right after a transcription succeeds
(`lib/ingestion.ts`) — chunks transcript segments (preserving
start/end-second spans), writes real `MaterialChunk` rows via `pgvector`
raw SQL, or fails honestly if no `EmbeddingService` is configured (always
true right now, see `docs/ai-setup.md`); real pgvector cosine-distance
retrieval scoped to authorized materials (`lib/retrieval.ts`); AI chat at
Topic scope and workspace (global Assistant) scope
(`/api/ai/conversations`, `/api/ai/conversations/[id]/messages`,
`AIChatPanel`) with clickable-source citations, honestly surfacing a 503
"not configured" state rather than a fake reply; "Generate AI Notes"
(`/api/materials/[id]/generate-notes`, `lib/note-generation.ts`) appends
real `NoteBlock`s from a material's transcript via `AIService`, versioning
existing blocks first, never overwriting manual notes. **All of this is
fully wired end-to-end but will always fail with a clear configuration
error today** — no `AIService`/`EmbeddingService` implementation exists,
by explicit Phase 5 scope decision.

## What is explicitly NOT implemented (don't assume otherwise)

- No concrete `AIService`/`EmbeddingService` implementation (Phase 5 was
  explicitly scoped provider-free) — the full RAG/chat/note-generation
  pipeline exists and is wired end-to-end, but always fails with
  `ServiceNotConfiguredError` until a real provider is added. See
  `docs/ai-setup.md`.
- No document text extraction (PDF/DOCX/PPTX) — `DocumentProcessingService`
  still has zero implementation, so only audio/video materials (via their
  transcripts) get chunked/indexed/embedded right now. A PDF can be
  uploaded, previewed, and manually noted, but not yet asked-about by AI
  chat or included in "Generate AI Notes."
- No real streaming for AI chat — `AIService.chat()` is Promise-based; the
  chat UI waits for the full response. Documented as future work in
  `docs/ai-setup.md`, not faked with a client-side typing effect.
- No Groups/collaboration (Phase 6) — `/groups` is a static placeholder
  page, no group data model usage beyond the schema existing. Group-scoped
  AI conversations (`AIConversation.groupId`) are in the schema but
  intentionally unresolved in `access.ts` until Phase 6 exists.
- No Google Drive/Docs import (Phase 7).
- No flashcards/quizzes/AI tutor (Phase 8).
- No production hardening — no Postgres row-level security, no real
  distributed rate limiting (in-memory only), no observability/logging
  infra (Phase 9).
- No client-side audio chunking for the Whisper provider (AssemblyAI
  doesn't need it; Whisper-path long files just fail with a clear error
  telling the user to switch providers).
- No search over materials or transcript content — `/api/search` only
  covers Subject/Chapter/Topic names (string match, not semantic). AI
  Chat's retrieval is real semantic search, but it's scoped to a
  conversation (Topic/workspace), not exposed as a general search feature.
- Command palette's "Record Lecture"/"Go to Materials" entries navigate
  to `/materials` rather than deep-linking into the Recorder tab
  specifically — `UploadMaterialDialog` is an uncontrolled component and
  wasn't refactored to support that.

## Recent work completed (most recent first)

### Session: Legacy-recording playback investigation + Phase 5 closure
Two issues investigated per user request: old/legacy recordings being
inaudible, and audio progress-bar visual polish. Full root-cause
investigation done via code inspection (this sandbox has no real browser
to reproduce Chromium's media pipeline against — flagged honestly, not
glossed over).

**Diagnosed root cause (legacy recordings)**: `/api/storage/read` parsed
the `Range` header with `/bytes=(\d+)-(\d*)/`, which only handles 2 of the
3 valid RFC 7233 forms. It silently failed on the suffix form
(`bytes=-N`, "last N bytes") — exactly what Chromium requests when
probing a WebM file whose container header doesn't state a finite
duration — and on a failed match fell back to serving the *entire file*
while still responding `206` with a mismatched `Content-Range`. This is
spec-invalid and can make Chromium's media pipeline abort the load
outright. New recordings never trigger this (their WebM header already
has a finalized duration via `webm-duration-fix`, so no probe is ever
issued); old recordings (predating that fix) always did. The underlying
file bytes were never affected — confirmed by the fact that transcription
(which reads the file directly server-side, bypassing this endpoint)
always worked.

**Fix implemented and merged**: new `src/lib/http-range.ts` —
`parseRangeHeader()`, a pure, unit-tested function handling all 3 RFC
7233 forms correctly — wired into both branches (local + proxied
backends) of `/api/storage/read/route.ts`, replacing the broken inline
regex in both places. Also threaded the existing, already-computed
`Material.durationSeconds` (from `music-metadata` at upload time) into
`AudioPlayer` as an optional `fallbackDurationSeconds` prop, used only
when the live `HTMLAudioElement.duration` is non-finite, so old
recordings' time display/progress fill don't stay stuck at 0 even if the
browser never resolves the container's own duration. `currentTime`
remains 100% sourced from the real audio element throughout — no faked
playback timing. Also fixed a real, separately-discovered layout bug: the
12px progress-bar thumb was being clipped by the 8px-tall track's
`overflow-hidden` (needed only to clip the fill's rounded corners) —
scoped `overflow-hidden` to just the fill so the thumb renders uncropped
at 0%/100%.

Files touched: `src/lib/http-range.ts` (new), `src/lib/__tests__/http-range.test.ts`
(new), `src/app/api/storage/read/route.ts`,
`src/components/materials/audio-player.tsx`,
`src/components/materials/material-preview.tsx`,
`src/components/materials/material-transcribe-section.tsx`,
`src/app/(app)/materials/[materialId]/page.tsx` (last three only to pass
`durationSeconds` down). No DB/schema change, no re-encoding of stored
files, no changes to recording/`MediaRecorder`/AssemblyAI/storage-backend
selection.

**Verified**: 102/102 tests pass (92 baseline + 10 new for
`http-range.ts`); lint clean (one real `react-hooks/exhaustive-deps`
warning fixed properly via the dependency array, not suppressed);
typecheck diffed **line-for-line** against a stashed, untouched checkout
of the same commit and confirmed **byte-for-byte identical** — 38 errors,
zero added/removed/changed, same Prisma-generation-cascade baseline as
before.

**Outcome**: the Range-parsing fix is real, tested, and correct on its
own terms, and is expected to help in general — but manual browser
testing after applying it still showed some old recordings remaining
inaudible; the exact remaining cause for those specific files wasn't
further isolated this session. Per explicit user instruction, this is now
recorded as a **deferred, non-blocking** issue rather than pursued
further — see "Known deferred issues (Phase 5 closeout)" above. The
progress-bar visual-polish issue is deferred for the same reason; the
current implementation is frozen as-is.

### Session: Phase 5 — AI notes + RAG + AI chat (provider-free scaffold)
Built per explicit user approval with 13 numbered constraints (see git
history / conversation for the exact list) — most importantly: pgvector
`vector(1536)` schema kept as-is (no migration), zero AI/embedding SDK
dependencies, zero API keys, zero fake responses/embeddings/streaming,
deterministic chunking without a tokenizer dependency, integrate with
existing Phase 1-4 patterns rather than duplicate them.

**Built**: `lib/services/embedding.ts` + `ai.ts` (registries, always throw
`ServiceNotConfiguredError`, same shape as `speech.ts`/`storage.ts`);
`lib/chunking.ts` (deterministic word-based chunking + transcript-segment
timestamp-aware variant, fully unit tested); `lib/ingestion.ts`
(`EMBEDDING` job, hooked in as fire-and-forget right after a transcription
succeeds in `transcription.ts`); `lib/note-generation.ts`
(`AI_NOTE_GENERATION` job, appends `NoteBlock`s non-destructively with a
version snapshot first); `lib/retrieval.ts` (real pgvector cosine-distance
search via raw SQL, scope re-derived server-side rather than trusting
caller-supplied material IDs); `lib/ai-chat.ts` (pure context/citation
formatting helpers, unit tested); `lib/access.ts` additions
(`getAccessibleAIScope`, `getAccessibleAIConversation`,
`getAccessibleProcessingJob`); `lib/validation/ai.ts` (unit tested);
routes `/api/ai/conversations`, `/api/ai/conversations/[id]/messages`,
`/api/materials/[id]/generate-notes`, `/api/processing-jobs/[id]`; UI —
`AIChatPanel` (used at both Topic scope and the workspace Assistant page),
`NotesTabPanel` + `GenerateAINotesButton` (wraps `NoteEditor` via a
remount-key rather than touching its internals). `docs/ai-setup.md`
written for future provider activation.

**Refactor** (small, behavior-preserving): extracted
`getOrCreateTopicNote` from the existing `GET /api/topics/[topicId]/note`
route into `lib/notes.ts` so the new note-generation job can reuse it
instead of duplicating the get-or-create logic.

**Verified**: 92/92 tests pass (62 pre-existing + 30 new — chunking,
ai-chat helpers, AI validation schemas), lint clean, typecheck shows 38
errors — same Prisma-generation-cascade root cause as the pre-existing 30
(this sandbox's `binaries.prisma.sh` is still unreachable; the +8 are new
instances of the identical cascade pattern in the new files that call
`db.<model>`, not new bug categories — see "Known bugs/issues" below).

**Not yet verified against a real database** (no Postgres available in
this session) — flagged explicitly, not glossed over:
- `db.aIConversation` / `db.aIMessage` as the Prisma client property names
  for the `AIConversation`/`AIMessage` models. This follows Prisma's
  documented "lowercase only the first character" naming rule (so
  `AIConversation` → `aIConversation`), matching how `db.processingJob`
  etc. already work in this codebase, but could not be confirmed against
  a real generated client here. **Run `npm run db:generate` and
  `npm run typecheck` after pulling this — if these property names are
  wrong, it'll be an immediate, obvious compile error, not a silent bug.**
- The raw SQL in `ingestion.ts`/`retrieval.ts` (pgvector inserts and
  `<=>` cosine-distance queries) is standard, well-documented pgvector
  syntax, but has not been run against a live Postgres+pgvector instance
  in this session.

### Session: AudioPlayer progress-bar smoothness, round 2
User reported the progress bar still didn't look "premium" after round 1's
CSS-transition fix. Re-inspected the full event/render chain (not
assumed). Found two real, narrow gaps:
1. The rAF loop only started on the `"playing"` event, not `"play"` —
   with `preload="metadata"`, there's a real buffering gap between
   `"play"` (fires instantly) and `"playing"` (fires once data is
   available), during which the bar didn't move yet.
2. Neither the imperative `seek()` (used by transcript-click-to-jump) nor
   the component-scope `seek()` called `updateVisual()` directly — the
   bar only caught up on the next rAF frame, which doesn't exist if
   paused.

**Fix**: `startRaf`/`stopRaf` hoisted from effect-local functions to
component-scope `useCallback`s (empty deps — they only touch stable
refs) so `togglePlay()` and the imperative `play()` handle can start the
loop *synchronously in the same tick as the click*, not waiting for any
event round-trip. Both seek paths now call `updateVisual()` immediately.
Listens to both `"play"` and `"playing"` (idempotent, so harmless to
double-listen). File touched: only `src/components/materials/audio-player.tsx`.

**Verified**: 62/62 tests pass, lint clean (fixed one real
`react-hooks/exhaustive-deps` warning introduced by the hoist, properly,
via `useCallback` — not suppressed), typecheck shows the same 30
pre-existing Prisma-cascade errors as baseline, zero new/changed.

### Session: AudioPlayer progress-bar smoothness, round 1
Diagnosed and removed a CSS `transition-transform` Tailwind class that was
present on the progress-fill element while a `requestAnimationFrame` loop
was simultaneously writing `transform` to it 60×/sec — the CSS transition
was perpetually easing toward a target that went stale every ~16ms,
producing visible stepping/lag. Removed the transition class, moved
`transform-origin`/`will-change` to static classes instead of per-frame
reassignment. File touched: only `audio-player.tsx`.

### Session (by the user, locally, before being handed back to Claude)
Real bugs found and fixed outside a Claude session, confirmed via diff
against Claude's last-known state:
- **MIME normalization bug**: `lib/mime.ts` did exact-string matching, so
  `audio/webm;codecs=opus` (what browsers actually report) never matched
  `audio/webm` in the lookup table — recordings were rejected as
  unsupported. Fixed by stripping MIME parameters before lookup, in both
  `mime.ts` and the upload-url route; the **normalized** type (not the
  raw browser string) is what's persisted to `Material.mimeType`.
- **`Infinity`/`NaN` duration bug**: `formatDuration` didn't guard against
  non-finite numbers (`!Infinity` is `false` in JS). Root cause fixed via
  `webm-duration-fix` (patches WebM container duration metadata after
  recording, since `MediaRecorder` output omits it).
- **AudioPlayer hydration robustness**: finite-value guards throughout,
  `durationchange` listener + forced `.load()` fallback when duration
  isn't available yet (fixes the direct-page-refresh case).
- **Dashboard bug**: `recentSubjects` query in `lib/dashboard.ts` was
  missing `materials` in its `_count` select, which `SubjectCard` expects.
- **Storage read proxying extended to S3**: `/api/storage/read` and the
  material-detail read-URL logic now proxy ALL backends (not just local)
  through the app server, to avoid CORS issues with `<audio>`/`<video>`
  playback against object storage directly.
- Added tests: `mime.test.ts`, `audio-player-utils.test.tsx`, an extra
  `formatDuration` non-finite case in `material-style.test.ts`.
- Added dependency: `webm-duration-fix`.

## Important implementation details worth knowing before touching related code

- **`useImperativeHandle`'s factory function runs after the full render,
  not at the point it's called in source.** React implements it via an
  internal `useLayoutEffect`, so it's safe for the callback (defined near
  the top of `AudioPlayer`) to reference `const`s and `function`s
  declared later in the component body — this looks like a forward
  reference but isn't actually a bug. Don't "fix" this by reordering.
- **`startRaf`/`stopRaf`/`updateVisual` in `audio-player.tsx` must stay
  functions that only close over stable refs** (no props/state) — that's
  what makes it safe for them to be redefined every render (or wrapped in
  `useCallback` with empty deps) without correctness issues.
- **The storage-read proxy for non-local backends downloads the ENTIRE
  object into memory on every request** (`getObjectBuffer`, called via
  `(storage as any).getObjectBuffer(key)` — a duck-typed cast, not part
  of the `StorageService` interface) and slices it in memory for Range
  requests. There is no true S3 byte-range streaming. Fine at demo scale;
  a real cost/latency concern for large files in production — flagged in
  `ARCHITECTURE.md`, not yet fixed.
- **Uploads and reads are asymmetric for S3**: uploads still go directly
  browser→S3 via a real presigned PUT (efficient, standard); only reads
  are proxied through the app server (for CORS reasons). Don't assume
  both directions work the same way.
- **`ProcessingJob` execution is fire-and-forget, not a real queue.**
  Works correctly on a persistent Node process (`next dev`/`next start`);
  will silently fail to complete on request-scoped serverless platforms
  (e.g. Vercel functions) because the process freezes after the response
  is sent. This is a known, accepted limitation — not yet fixed.

## Known bugs / issues (not yet fixed)

- **`recordedMs` in `recorder-panel.tsx` is computed but never used.**
  Dead code left over from the WebM-duration-fix work. Doesn't cause any
  runtime problem, doesn't fail lint (not flagged by the current ESLint
  config), just untidy. Safe to remove in a future small cleanup pass.
- **README.md has a duplicated line** in the Status checklist — "Phase 5
  — AI notes + RAG + AI chat" appears twice (lines 115–116). Cosmetic
  only. Not fixed as part of this documentation task (out of scope —
  README wasn't part of the requested changes).
- **Doc/code drift in a few source comments**:
  - `lib/services/interfaces.ts`'s top comment references
    `src/lib/services/registry.ts`, which doesn't exist — the actual
    registry functions are `getStorageService()` in `storage.ts` and
    `getSpeechService()` in `speech.ts`.
- **Legacy WebM recordings can still be inaudible** — see "Known deferred
  issues (Phase 5 closeout)" at the top of this document. Deferred, not
  blocking Phase 6. Do not attempt to fix without an explicit new request.
- **Audio progress-bar visual polish** — see "Known deferred issues (Phase
  5 closeout)" at the top of this document. Deferred, not blocking Phase
  6. Do not attempt another redesign without an explicit new request.
- **`Prisma.MaterialWhereInput` and other Prisma-generated types don't
  resolve in whatever sandbox last ran `tsc`** because `prisma generate`
  couldn't reach `binaries.prisma.sh` from that environment's network
  (confirmed directly in the Phase 5 session: `npx prisma generate` fails
  with `403 Forbidden` fetching from `binaries.prisma.sh`, even with
  `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`). This produces 38 typecheck
  errors (30 pre-existing + 8 new in Phase 5's files) that are NOT real
  bugs — see `CLAUDE.md` → Testing requirements for how to distinguish
  this from an actual regression. Resolves by running `npm run db:generate`
  somewhere with real network access to `binaries.prisma.sh`.

## Failed approaches / things already tried and rejected

- **CSS transitions on rAF-animated elements** — tried, caused visible
  stepping (transition fights the 60fps imperative write). Do not
  reintroduce a `transition-*` Tailwind class on the progress fill or
  thumb wrapper in `audio-player.tsx`.
- **Waiting only for the `"playing"` event to start the animation loop**
  — technically correct but perceptibly laggy due to `preload="metadata"`
  buffering delay. Superseded by starting the loop synchronously on
  click + listening to both `"play"` and `"playing"`.
- **Relying on the rAF loop alone to keep the visual in sync after a
  seek** — breaks when paused, since the loop isn't running. Every seek
  path must call `updateVisual()` directly now.

## Tests performed and their results (this session, verified live)

```
npm run test        →  11 test files, 102/102 tests passed
npm run lint         →  0 errors, 0 warnings
npm run typecheck    →  38 errors, diffed line-for-line against a stashed
                         untouched checkout of the same commit and
                         confirmed byte-for-byte identical — zero
                         added/removed/changed. Same Prisma-generation
                         cascade described above (confirmed by grepping
                         for "@prisma/client", "Prisma.", and "implicitly
                         has an 'any' type"; every error line matches one
                         of those patterns; zero unexplained errors).
```

Also noted for this session: the user reported `npx prisma generate` and
`npx prisma migrate status` were already run successfully (in an
environment with real database/network access), with the database
reporting "Database schema is up to date!" This was **not** independently
re-run in this sandbox — attempting `npx prisma generate` here reproduces
the same `binaries.prisma.sh` `403 Forbidden` network restriction already
documented in "Known bugs / issues" above, so it can't be confirmed from
here. Recorded as user-reported, not sandbox-verified — flagged
explicitly rather than presented as something this session confirmed
directly.

No integration/E2E tests exist in this project — only Vitest unit tests,
concentrated on Zod validation schemas and pure utility functions. Phase
5's retrieval/ingestion/chat orchestration functions (which need a real
Postgres+pgvector) follow this same established convention — untested at
the unit level (consistent with `transcription.ts` also having no test
file), verified instead by full inspection and by the fact that every
Prisma call in them matches the schema exactly (checked line by line
during implementation).

## Current task

Phase 5 is formally closed as of this session. No new application
behavior was introduced during closure — this task only updated
documentation, verified the working tree, and committed/pushed the
already-implemented and already-verified changes described in "Recent
work completed" above.

## Exact next steps

Nothing is queued. The next piece of work is whatever the user requests
next. Likely candidates based on the master prompt's phase order:

1. **Phase 6** (Groups + collaboration) is the next unstarted phase in
   sequence — but do not start it speculatively; wait for explicit
   instruction, per `CLAUDE.md`'s phase-discipline rule.
2. **Verify Phase 5 against a real database**: run `npm run db:generate`
   with real network access, then `npm run db:migrate`, then confirm
   `db.aIConversation`/`db.aIMessage` compile and the pgvector raw SQL in
   `ingestion.ts`/`retrieval.ts` actually executes against Postgres. This
   is the one thing Phase 5 could not be verified against in this session
   (see "Not yet verified against a real database" above).
3. **Activate a real AI/embedding provider** (see `docs/ai-setup.md`) —
   optional, only if/when the user wants AI features to actually respond
   instead of showing the honest "not configured" state.
4. Small, currently-known, not-yet-actioned cleanups if ever asked for a
   "cleanup pass": remove the dead `recordedMs` variable in
   `recorder-panel.tsx`; dedupe the README Phase 5 line.

**Do not re-open either deferred issue** ("Known deferred issues (Phase 5
closeout)" above) as part of Phase 6 or any other work unless the user
explicitly asks for it again.

## How to verify this document

```bash
npm install
npm run test
npm run lint
npm run typecheck 2>&1 | grep -c "error TS"   # expect 38, all Prisma-cascade
```

If any of these numbers differ from what's recorded above, this document
is stale — update it (or ask the user to) before relying on it further.
