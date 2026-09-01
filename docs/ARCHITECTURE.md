# Architecture — Phase 1

## Stack decisions

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router, TypeScript) | Server components for data-heavy pages (dashboard, materials), route handlers double as the API layer, one deployable unit for MVP velocity. Split into a separate backend later only if worker/API scaling demands it (see "When to split the backend" below). |
| Database | PostgreSQL + Prisma | Relational integrity for the Subject→Chapter→Topic tree, group permissions, and billing; Prisma gives typed queries and migrations. |
| Vector search | pgvector extension on the same Postgres instance | Avoids a second database for MVP. `MaterialChunk.embedding` is a `vector(1536)` column. If retrieval latency/scale later demands it, swap to a dedicated vector DB (Pinecone/Qdrant) behind the same `EmbeddingService`/retrieval interface — see Phase 5 notes. |
| Auth | NextAuth.js — JWT sessions, Credentials + Google providers, Prisma adapter | JWT sessions avoid a DB hit per request in middleware. Prisma adapter persists `Account`/`Session` for OAuth linking and future admin tooling. |
| Styling | Tailwind CSS, custom design tokens | See `tailwind.config.js` for the full token system and rationale. |
| Validation | Zod | Shared schemas between client forms and API route handlers — one source of truth per input shape. |
| AI/Storage/Speech | Interface-first (`src/lib/services/interfaces.ts`) | No provider SDK is imported outside its concrete implementation file. Swapping Anthropic ↔ OpenAI ↔ Google, or S3 ↔ R2, never touches call sites. |

## Why not split frontend/backend from day one

Section 106 of the brief asks for separation of concerns, which this
architecture honors at the *code* level (route handlers contain business
logic, components stay presentational, services are isolated) without
paying the operational cost of two deployables before there's a reason to.
Next.js route handlers are the API; background workers (Phase 4 transcription,
Phase 5 embedding) are the first thing that will actually need to live in a
separate process, because they're long-running and shouldn't share a
request/response lifecycle with the web server. That's the natural split
point — a `worker/` service reading from `ProcessingJob` — not before.

## Multi-tenancy model

- Every `User` can own multiple `Workspace`s (§60 isolation boundary).
- A `Workspace` has `WorkspaceMember` rows with `MemberRole` (OWNER/ADMIN/MEMBER/VIEWER).
- `Group` is a *separate* collaboration boundary from `Workspace` — a group
  can contain its own `Subject`/`Chapter`/`Material` rows (see `groupId` on
  those models) so shared study-group content doesn't have to live inside
  any one member's personal workspace.
- **Every query that lists or fetches Subject/Chapter/Topic/Material/Note
  data must filter by a resolvable owner: `workspaceId` the requesting user
  is a member of, OR `groupId` the requesting user is a member of.** This is
  enforced in the data-access layer (`src/lib/access/*`, added in Phase 2)
  as a single `assertCanAccess(...)` helper used by every route handler —
  never ad hoc per-route checks.
- Postgres row-level security policies are the Phase 9 hardening layer on
  top of this — application-level checks are the primary defense during
  Phases 1–8, RLS is defense-in-depth before production.

## Auth flow implemented in Phase 1

- Email/password: `POST /api/auth/register` (rate-limited, bcrypt cost 12)
  → `signIn("credentials", ...)` on the client.
- Google OAuth: sign-in-only scopes at login. Drive/Docs scopes (Phase 7)
  are requested separately through a Connected Accounts flow so users
  aren't asked for file access just to create an account.
- `middleware.ts` gates all app and data-API routes behind a valid session;
  per-resource authorization still happens server-side per request.
- New users get a `Profile` and a `FREE` `Subscription` row created
  transactionally with the account (see `authOptions.events.createUser`
  and the `/api/auth/register` handler) — nothing downstream needs to
  null-check for their absence.

## Plan / limits configuration

`src/lib/plans.ts` centralizes storage caps, AI credits, recording minutes,
group size, and feature flags per `PlanTier`. No limit should ever be
hard-coded elsewhere — Phase 9 wires enforcement into upload, recording,
and AI-chat endpoints against this single source.

## Folder structure (Phase 2 state)

```
notes-platform/
├── prisma/
│   ├── schema.prisma        # full data model, §58
│   └── seed.ts               # demo user + two sample subjects
├── src/
│   ├── app/
│   │   ├── (auth)/            # sign-in, sign-up — shared layout
│   │   ├── (app)/              # authenticated shell — sidebar + command palette
│   │   │   ├── home/            # dashboard
│   │   │   ├── subjects/        # list, detail, chapter detail, topic detail
│   │   │   ├── groups/          # honest Phase 6 placeholder
│   │   │   ├── materials/       # honest Phase 3 placeholder
│   │   │   ├── assistant/       # honest Phase 5 placeholder
│   │   │   ├── search/          # structural search
│   │   │   └── settings/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/, auth/register/
│   │   │   ├── subjects/, chapters/, topics/   # hierarchy CRUD
│   │   │   ├── profile/, onboarding/, search/
│   │   │   └── health/
│   │   ├── onboarding/         # real two-step flow (not gated behind (app))
│   │   ├── globals.css, layout.tsx, page.tsx, error.tsx, not-found.tsx
│   ├── components/
│   │   ├── auth/, shell/ (sidebar, topbar, breadcrumbs, command palette)
│   │   ├── subjects/, chapters/, topics/, dashboard/, settings/, search/,
│   │   │   onboarding/, shared/ (EditableHeader, PhasePlaceholder)
│   │   └── ui/                # Button, Input, Dialog, DropdownMenu, Tabs,
│   │                            Textarea, Badge, Skeleton, EmptyState, ConfirmDialog
│   ├── lib/
│   │   ├── auth.ts, db.ts, provision.ts, access.ts, dashboard.ts
│   │   ├── plans.ts, rate-limit.ts, utils.ts, subject-style.ts
│   │   ├── api-response.ts
│   │   ├── stores/ui-store.ts
│   │   ├── validation/        # auth, hierarchy, profile schemas + tests
│   │   └── services/          # provider-agnostic interfaces, §64
│   └── middleware.ts
├── docs/
├── .env.example
└── README.md
```

## What's deliberately deferred

Per §92 ("no fake features"), each of these has a real nav entry and page
that plainly states which phase implements it — never a fake working UI:

- Materials upload, storage, previews → **Phase 3**
- Recording, transcription, timestamps → **Phase 4**
- AI chat, RAG, structured notes, semantic search → **Phase 5**
- Groups, invitations, realtime → ~~Phase 6~~ **done as of Phase 6.6 — see the "Phase 6 — Groups + collaboration" section below** (realtime is the one sub-item still deferred; see that section's Known limitations)
- Google Drive/Docs import → **Phase 7**
- Flashcards, quizzes, AI tutor → **Phase 8**
- Row-level security, production rate limiting, observability → **Phase 9**

## Phase 1 verification checklist

- [ ] `npm install`
- [ ] `docker run` (or managed) Postgres with `pgvector` available
- [ ] `npm run db:migrate` creates all tables cleanly
- [ ] `npm run db:seed` creates `demo@example.com` / `Password123`
- [ ] `npm run dev`, visit `/`, redirected to `/sign-in`
- [ ] Sign up with a new email → redirected to `/onboarding` → `/home`
- [ ] Sign out → redirected to `/sign-in`
- [ ] Sign in with the seeded demo account works
- [ ] `GET /api/health` returns `{ status: "ok", database: "connected" }`
- [ ] Visiting `/home` while signed out redirects to `/sign-in` (middleware)

---

# Phase 2 — Dashboard + Subject/Chapter/Topic system

## What was built

- **AppShell**: `Sidebar` (Home, My Subjects, Groups, Materials, AI
  Assistant, Search, Settings + user menu with plan badge and sign-out),
  `Topbar` (breadcrumbs + Cmd/Ctrl+K trigger), and a `CommandPaletteProvider`
  wrapping every authenticated route via `src/app/(app)/layout.tsx`.
- **Command palette** (`cmdk`): static actions (New Subject, navigation,
  sign out) plus live search over subjects/chapters/topics, debounced
  against `/api/search`.
- **Dashboard** (`/home`): greeting, Quick Actions (only "New Subject" is a
  real action — the rest are visibly disabled and labeled with the phase
  that implements them, never faked as working), Continue Learning (most
  recently updated topics), Recent Subjects, Study Progress (computed live
  from `Chapter.status`, not estimated), and honest placeholders for AI
  Processing (Phase 4–5) and Groups (Phase 6).
- **Subject → Chapter → Topic CRUD**: full create/read/update/archive/
  soft-delete for all three levels, each with its own route handlers under
  `src/app/api/{subjects,chapters,topics}/`, all funneled through
  `src/lib/access.ts`.
- **Structural search**: `/search` page and `/api/search` — string matching
  on names/descriptions only. Deliberately **not** semantic search; that
  needs the RAG pipeline and is explicitly Phase 5 (see the note rendered
  on the search page itself so this isn't a silent gap).
- **Real onboarding** (`/onboarding`): two-step flow (usage intent → first
  subject), replacing the Phase 1 stub that just redirected. Sets
  `Profile.usageIntent`, `Profile.onboardedAt`, and `Workspace.mode`.
- **Settings** (`/settings`): editable name, theme (light/dark/system, via
  `next-themes`, persisted to `Profile.theme`), and read-only plan info
  pulled from `lib/plans.ts`.
- **UI primitives added**: `Dialog`, `DropdownMenu`, `Tabs` (all Radix-based
  for accessibility — focus trapping, keyboard nav, ARIA out of the box),
  `Textarea`, `Badge`, `Skeleton`/`CardGridSkeleton`, `EmptyState`,
  `ConfirmDialog`, `PhasePlaceholder` (the "arrives in Phase N" pattern used
  everywhere a later-phase feature is referenced from the nav or a tab).
- **New dependencies**: `cmdk` (command palette), `sonner` (toast
  notifications on every create/update/delete), `next-themes` (theme
  persistence without a flash-of-wrong-theme), `date-fns` (relative
  timestamps), `@radix-ui/react-{dialog,dropdown-menu,tabs,tooltip}`,
  `tailwindcss-animate`.

## Key decisions

- **One workspace per user, for now.** `getPrimaryWorkspace()` in
  `lib/access.ts` is the single place this assumption lives. Every new
  account (`lib/provision.ts`, shared by both the OAuth and email/password
  signup paths so they can't drift apart) gets exactly one personal
  `Workspace` at signup. Multi-workspace support is a matter of extending
  this one function later, not a schema change.
- **Soft-delete cascades explicitly.** Deleting a Subject soft-deletes its
  Chapters and Topics in the same transaction; deleting a Chapter
  soft-deletes its Topics. This keeps Trash/Recovery (spec §100 — not yet
  built, but the data supports it) from orphaning rows. Full trash-browsing
  UI is deferred; only the data layer is ready for it.
- **The "no fake features" rule (spec §92) shaped the dashboard and nav
  directly.** Materials, Groups, and AI Assistant nav items go to real
  pages that state plainly which phase implements them — never a dead
  button or a "Coming soon" toast. The same pattern (`PhasePlaceholder`)
  is reused in the Topic page's Notes/Materials/Transcript/AI Chat/Study
  Tools tabs.
- **Command palette state is shared via a tiny Zustand store**
  (`lib/stores/ui-store.ts`), not React context — the "open create-subject
  dialog" action needs to be triggered from both the command palette and
  the Subjects page's empty state, and a store is the simplest thing that
  lets both do that without prop-drilling.

## Phase 2 verification checklist

- [ ] Sign up with a new account → onboarding asks for usage intent, then
      an optional first subject
- [ ] Skipping the first-subject step still lands on `/home` with an empty
      state and a working "Create Subject" button
- [ ] `Cmd/Ctrl+K` opens the command palette from any page; typing a
      subject/chapter/topic name returns live results that navigate
      correctly
- [ ] Create a subject → chapter → topic; breadcrumbs update correctly at
      each level
- [ ] Archive and restore a subject; delete a chapter and confirm its
      topics are also gone from the UI
- [ ] Change a chapter's status on the Subject page; the dashboard's Study
      Progress bar reflects it after refresh
- [ ] Toggle theme in Settings; it persists across a reload and across
      sign-out/sign-in
- [ ] Visit `/materials`, `/groups`, `/assistant` — each clearly states
      which phase adds it, nothing pretends to work
- [ ] `npm run test` and `npm run lint` both pass clean

---

# Phase 3 — Notes editor + materials

## What was built

- **Storage layer, for real.** `StorageService` (defined in Phase 1 as an
  interface with an "unconfigured" stub) now has two working
  implementations: `LocalStorageService` — actual filesystem reads/writes
  under `STORAGE_LOCAL_DIR`, zero setup, works out of the box for `npm run
  dev` — and `S3StorageService` — real AWS SDK presigned URLs, for
  anything deployed. `getStorageService()` picks between them via
  `STORAGE_PROVIDER` (or infers it from which env vars are set).
- **Materials system**: upload (drag-and-drop, multi-file, real XHR
  progress — not simulated), link-add, list/search/filter (All /
  Unorganized / Archived), rename, move (cascading Subject → Chapter →
  Topic picker), tag, archive, soft-delete with real storage cleanup.
  Enforced server-side against `lib/plans.ts` limits (per-file size AND
  total storage quota) — never just a client-side check.
- **Non-AI metadata extraction**: PDF page count (`pdf-lib`), image
  dimensions (`image-size`), audio/video duration (`music-metadata`) — all
  real, deterministic, and explicitly *not* AI understanding. Runs
  synchronously right after upload for the local backend; the S3 backend
  skips it for now (see Known Limitations) rather than pretending to do it.
- **Material previews**: PDF via the browser's native renderer (iframe,
  no added deps), images with zoom, a from-scratch audio player
  (play/pause/seek/speed/volume — real HTML5 `<audio>` under custom
  controls, not just the browser default), video, and plain text. DOCX/PPTX
  get an **honest "no preview available" screen with a working download
  button** instead of a faked render — per spec §92, not rendering
  something is more honest than pretending to.
- **Materials wired into every scope**: Subject and Chapter pages show
  materials attached directly at that level; the Topic page's Materials
  tab is fully live; the Dashboard's Recent Materials section and "Upload
  Material" quick action are real.
- **Block-based notes editor**: Tiptap (bold/italic/heading/lists/links)
  per block, `dnd-kit` drag-to-reorder, a kind selector covering every
  `NoteBlockKind` from the schema, add/delete sections, autosave (800ms
  debounce), and a version history panel with non-destructive restore.
  One note per topic, auto-created on first visit (see Known Limitations
  for why that's a deliberate scope cut, not a missing feature).
- **Mobile nav drawer**: the desktop sidebar is now `lg:`-only; a
  Radix-Dialog-based slide-in drawer (`MobileNavDrawer`) covers the same
  nav on narrow viewports, triggered by a hamburger button in the Topbar.

## A real bug this phase caught (and fixed) before shipping

The notes bulk-save endpoint (`PUT /api/notes/[noteId]/blocks`) originally
used `noteBlock.upsert({ where: { id: block.id }, ... })` keyed on the
client-supplied block id. Since block ids are generated client-side (so
the editor has stable keys before the first save), a malicious or buggy
client could send an id that happens to belong to a block on a *different*
note — Prisma would run the `update` branch against that row without any
ownership check, since the endpoint only verified access to the note in
`params`, not to each individual block's actual current owner. Fixed by
splitting into "update only ids already confirmed to belong to this note
(from our own prior read)" vs. "always insert everything else as a
brand-new row with a server-generated id" — no incoming id is ever trusted
enough to drive an update. This is documented inline in the route handler,
not just here.

## Key decisions

- **One note per topic.** The schema (`Note.topicId` is a plain nullable
  FK, not unique) allows several; the UI deliberately exposes only a
  get-or-create single note per topic. A notes-list UI is a small addition
  later if it's ever needed — not a schema change.
- **Local storage buffers uploads in memory**, not true streaming-to-disk.
  Fine for dev/demo; the documented fix for production-scale files is
  exactly what the S3 backend already does (direct browser-to-object-store
  upload, this server never sees the bytes).
- **Version snapshots are throttled, not per-keystroke**: at most one
  automatic snapshot every 10 minutes of active editing, plus one on every
  explicit "Save version now" click. A snapshot on every autosave would
  make the version list noise, not history.
- **Link materials don't fetch anything.** Saving a link just saves the
  URL and title — no server-side fetch, no content extraction. Real link
  import (fetch, extract, index) needs the RAG pipeline and is Phase 5
  work; doing a partial version now would mean either faking the
  "understanding" part or building throwaway fetch logic that Phase 5
  replaces anyway.

## Known limitations (by design, not oversights)

- **S3-backed materials skip metadata extraction.** The completion route
  only extracts page count/dimensions/duration when the local backend is
  active, because getting the bytes back from S3 just to extract a page
  count is a real cost (a full object download) this phase chose not to
  pay. S3-backed materials go straight to `READY` with no `metadata`.
  Fixing this later means either downloading a byte range server-side or
  moving extraction into a background worker — both are reasonable, but
  out of scope here.
- **Local storage upload buffers the whole file in memory** before writing
  to disk (see `/api/storage/upload/route.ts`). Not a concern at
  dev/demo scale; would need to switch to a real streaming write (or just
  use the S3 backend, which sidesteps this entirely) before handling large
  files in production.
- **DOCX/PPTX have no in-app preview.** This is the honest "we don't fake
  it" choice, not a bug — see spec §92. Download always works.
- **Undo/redo is block-scoped, not whole-note.** Tiptap's built-in
  undo/redo works within each block's text; undoing a block *add/delete/
  reorder* isn't tracked step-by-step — the coarser version history
  (restore a snapshot from N minutes ago) is the mechanism for that,
  documented as a deliberate scope trade-off rather than a missing feature.
- **A newly-created block's editor can lose focus once**, right when its
  very first autosave completes, if the user is still actively typing in
  that exact block at that moment — because the server assigns it a real
  id in place of the client's temp id, and React remounts on key change.
  Every subsequent edit to that block is unaffected.

## Phase 3 verification checklist

- [ ] Drag-and-drop a PDF, an image, and an audio file onto the Materials
      page — real progress bars, all three land in `.storage/` on disk
- [ ] Open the PDF — renders in an iframe; open the image — zoom toggle
      works; open the audio file — custom player plays, seeks, and its
      speed/volume controls work
- [ ] Rename a material, move it into a Topic via the cascading picker,
      add a tag, then archive and restore it
- [ ] Delete a material — it disappears immediately and its file is gone
      from `.storage/` on disk
- [ ] Try uploading a file larger than your plan's per-file limit (see
      `lib/plans.ts`) — rejected with a clear error, not a silent failure
- [ ] Open a Topic's Notes tab — add a few sections, reorder them by drag,
      change a block's kind, add a heading and some bold/italic text —
      autosave indicator flips through saving → saved
- [ ] Wait (or click "Save version now"), make another edit, then open
      Version History and restore the earlier version — confirm content
      reverts and a fresh snapshot of the pre-restore state now exists too
- [ ] Shrink the browser to a phone width — sidebar disappears, hamburger
      button opens the mobile drawer with the same nav
- [ ] Re-verify Phase 1 (sign up/in/out) and Phase 2 (create Subject →
      Chapter → Topic, command palette, dashboard) still all work
- [ ] `npm run test`, `npm run lint` both pass clean

---

# Phase 4 — Audio recording + transcription

## What was built

- **Real browser recording**: `RecorderPanel` uses `MediaRecorder` +
  `getUserMedia` + an `AnalyserNode`-driven level meter (real amplitude
  data, not a decorative pulse) — mic device selection, pause/resume,
  cancel, and a live elapsed-time counter that correctly accounts for
  paused time. On stop, the recorded `Blob` goes through the exact same
  upload pipeline as a dragged-in file (see "shared upload hook" below).
- **Speech-to-text abstraction, two real providers**: `SpeechService`
  (defined in Phase 1, implemented for real now) has `AssemblyAISpeechService`
  (recommended default — real speaker diarization via `speaker_labels`,
  upload→create→poll against their REST API, no practical file-size limit)
  and `OpenAIWhisperSpeechService` (simpler/cheaper, segment-level
  timestamps via `verbose_json`, no diarization, hard-capped at 25MB per
  spec of the actual Whisper API — checked and rejected client-side before
  ever making the request). Selected via `SPEECH_PROVIDER`; unset or
  misconfigured surfaces as a real `ProcessingJob` failure with an
  actionable message, never a fake transcript (spec §92).
- **Transcription orchestrator** (`lib/transcription.ts`): resolves audio
  bytes from whichever `StorageService` backend is active (local disk or
  S3 — added a `getObjectBuffer` method to `S3StorageService` for this),
  calls the configured `SpeechService`, and writes real
  `Transcript`/`TranscriptSegment` rows — or a real `FAILED` job with the
  provider's actual error message.
- **Processing job architecture**: `POST /api/materials/[id]/transcribe`
  creates a `ProcessingJob` (using the `ProcessingJob`/`JobType.TRANSCRIPTION`
  schema already defined in Phase 1) and kicks off the orchestrator
  fire-and-forget, returning immediately; the client polls
  `GET /api/materials/[id]` for live status. No fabricated progress
  percentage — cloud STT providers don't report granular progress, so the
  UI honestly shows "Transcribing… this can take a few minutes" instead.
- **Transcript UI**: `MaterialTranscribeSection` combines the audio/video
  player with the transcript state machine (not-yet-transcribed → queued
  → running → done/failed) in one place, so there's never more than one
  player rendered for a given material. Clicking a segment's timestamp
  seeks the audio player there (via a new `AudioPlayer` `forwardRef`
  handle) — real sync, not just static text. The Topic page's Transcript
  tab lists that topic's recordings with live status pills, linking into
  the full experience on each material's detail page.
- **Recording-minutes usage tracking** (`lib/recording-usage.ts`): sums
  this calendar month's AUDIO/VIDEO material durations against
  `plan.recordingMinutesPerMonth` (already defined in `lib/plans.ts` since
  Phase 1, unused until now) and blocks starting a *new* recording once
  exhausted — a real, working limit, not a decorative note. Uploaded
  (not recorded) audio files aren't blocked by this, since "recording
  minutes" is specifically about the in-app Recorder feature; general
  audio storage is already governed by the separate storage quota from
  Phase 3.
- **Shared upload hook** (`lib/hooks/use-material-upload.ts`): extracted
  the request-URL → XHR-PUT-with-progress → complete pipeline out of
  `MaterialUploader` so the Recorder could reuse it exactly, rather than
  duplicating upload logic for a `Blob` vs. a `File`.

## Key decisions

- **Fire-and-forget, not a real queue — deliberately, and documented.**
  `runTranscriptionJob()` is called without `await` from the route
  handler so the HTTP response returns immediately. This works correctly
  on a persistent Node process (`next dev`, `next start` on a normal
  server/container) because the event loop keeps running after the
  response is sent. It does **not** work on request-scoped serverless
  platforms (Vercel functions freeze the process once the response
  completes) — the production upgrade path there is a real queue
  (BullMQ+Redis, SQS, etc.) consuming from the same `ProcessingJob` table,
  which is exactly why that table was already modeled generically back in
  Phase 1 rather than as a transcription-specific structure.
- **AssemblyAI over Whisper as the recommended default**, specifically
  because it diarizes and doesn't need chunking for long lectures — both
  directly serve spec §14/§15 (timestamps, speaker detection) and §13
  (long audio) without extra client-side complexity. Whisper stays
  available as the cheaper/simpler option for anyone who doesn't need
  speaker labels.
- **No client-side audio chunking was built.** AssemblyAI doesn't need it
  (server-side, no practical size limit). For Whisper's 25MB cap, a real
  chunk-transcribe-and-stitch pipeline is a meaningfully sized feature on
  its own (splitting audio, offsetting timestamps, merging boundary
  words) — rather than half-build it, oversized files fail with a clear,
  actionable error telling the user to switch providers. Documented as a
  known limitation, not silently missing.
- **Manual transcription trigger for uploaded/imported audio, automatic
  intent for the Recorder flow's "seamless" UX.** Spec §11's pipeline
  narrative (stop → "Processing your recording…") describes the live
  Recorder specifically; a plain audio *upload* (spec §12) doesn't carry
  the same implied consent to immediately spend API credits, so it gets a
  manual "Transcribe" button instead. (The Recorder flow still requires
  one click today rather than truly zero — see Known Limitations.)

## Known limitations (by design, not oversights)

- **Untestable from this sandbox.** Neither `api.assemblyai.com` nor
  `api.openai.com` is reachable from this environment's network allowlist
  — the same category of limitation as the S3 storage backend in Phase 3.
  Both providers are written against their published REST API contracts
  and are ready to run wherever real network access and an API key exist;
  I could not exercise a live transcription end-to-end here.
- **The Recorder flow doesn't auto-trigger transcription after upload.**
  It saves the recording and navigates to the material page, where
  transcription is one click away — fully automatic chaining (record →
  upload → immediately transcribe with zero further clicks) was cut for
  time in favor of getting the harder pieces (real diarization, real
  polling, real usage limits) right. This is a small, contained follow-up.
- **No client-side chunking for the Whisper provider** — see "Key
  decisions" above. AssemblyAI doesn't have this limitation.
- **Command palette integration is navigation-only.** "Record Lecture" in
  the palette goes to `/materials` rather than deep-linking straight into
  the Recorder tab of the upload dialog — doing the latter cleanly would
  have meant refactoring `UploadMaterialDialog` from an uncontrolled to a
  controlled component, which felt like an unnecessary risk this late in
  the phase for a nice-to-have. The real buttons on that page work fully.
- **Global search doesn't index materials or transcripts.** `/api/search`
  still only covers Subject/Chapter/Topic names (from Phase 2) — searching
  transcript content is explicitly semantic/RAG territory and belongs in
  Phase 5, not bolted on here as string matching.
- **Speaker labels are provider-assigned identifiers ("Speaker A",
  "Speaker B"), never names.** Nothing in this phase guesses or infers who
  a speaker actually is — that would be fabricating information the audio
  alone can't supply.

## Phase 4 verification checklist

- [ ] Grant mic permission and record a short clip — level meter reacts to
      actual sound, pause/resume preserves elapsed time correctly, cancel
      discards it, stop uploads it and lands on the material page
- [ ] With `SPEECH_PROVIDER` unset, click "Transcribe" on an audio file —
      job fails immediately with a clear "not configured" message, not a
      hang or a fake result
- [ ] With a real `SPEECH_PROVIDER` + API key configured (outside this
      sandbox), transcribe a short recording — segments appear with
      timestamps (and speaker labels, if using AssemblyAI); clicking a
      segment seeks the audio player there
- [ ] Try to start a new recording after (simulated) exhausting your
      plan's monthly recording minutes — blocked with a clear message
- [ ] Upload an audio file directly (not via the Recorder) — it does
      *not* auto-transcribe; the manual "Transcribe" button is there
- [ ] Open a Topic's Transcript tab with a couple of recordings in
      different states — status pills (queued/running/done/failed) match
      each material's actual state
- [ ] Re-verify Phase 1–3 all still work: auth, Subject/Chapter/Topic
      CRUD, command palette, notes editor autosave/versioning, material
      upload/preview/move/archive/delete
- [ ] `npm run test`, `npm run lint` both pass clean

---

# Phase 6 — Groups + collaboration

> Note: this file has no dedicated Phase 5 section (a pre-existing gap,
> not something Phase 6.7 closeout is scoped to fix — see
> `PROJECT_STATE.md` for the authoritative Phase 5 record). This section
> covers Phase 6 only, added during Phase 6.7 closeout to bring this file
> in line with the actually-implemented Groups architecture, sub-phases
> 6.1 through 6.6.

## What was built

- **Group as a second collaboration boundary alongside Workspace**
  (6.1): `Group`, `GroupMember` (with `MemberRole` — the same
  OWNER/ADMIN/MEMBER/VIEWER enum `WorkspaceMember` already used),
  `GroupInvitation`. A `Group` is created with the creator as `OWNER`
  inside one transaction, so the "exactly one OWNER" invariant is never
  briefly broken by a partial write.
- **Subject/Material ownership made mutually exclusive between Workspace
  and Group** (6.1 invariant, wired into the create/update routes as of
  6.4): `Subject.workspaceId` became nullable; every Subject and Material
  resolves to exactly one owning scope, asserted defensively at the point
  of creation (`assertSubjectScopeInvariant`), not just implied by
  which fields happen to be set.
- **Membership + invitations** (6.2): role changes and member removal/
  leave through one shared pure authorization function each
  (`canChangeMemberRole`, `canRemoveMember` in `lib/group-role.ts`) so the
  OWNER-protection rule lives in one place, not duplicated per route.
  Invitations are token-based, expire, and require the accepting
  account's email to match the invitation's email (checked against a
  fresh `db.user` read, not the session) — token possession alone is
  never sufficient to join.
- **Groups UI** (6.3): group list, group detail page with tabs
  (Overview/Members/Subjects/Materials/Activity/AI Assistant), invite/
  accept/decline flows, member role management UI.
- **Group-scoped Subjects and Materials** (6.4): the Subjects/Materials
  tabs list a group's own content; creating/renaming/deleting a group
  Subject requires ADMIN+ (`assertSubjectManageAccess`); a bare group
  Material (no subject/chapter/topic) requires only membership to read,
  mirroring the existing `assertScopeAccess` rule for bare workspace
  scope.
- **Group-scoped AI Assistant** (6.5): a group's AI Assistant tab
  retrieves from everything the group has shared (`ResolvedAIScope`'s
  `ownerType: "group"` branch), but each member's conversation thread is
  their own (`AIConversation.userId`, unchanged from Phase 5) — shared
  knowledge, private threads, never a multi-user shared conversation.
- **Activity log + notifications** (6.6): `ActivityLog` (group-scoped,
  actor + stable `action` string + optional metadata) and `Notification`
  (per-user, typed, with read state) — both models existed in the schema
  since Phase 1 but were unwired until this sub-phase. Now wired into
  group creation, invite/accept/decline, role change, member remove/
  leave, group Subject create/update/delete, and group Material add/
  remove. `NotificationBell` in the shell Topbar (global, every
  authenticated page) and a real `GroupActivityPanel` on the group page's
  Activity tab (paginated, newest first) replaced the Phase 6.3
  `PhasePlaceholder`.

## Key decisions

- **Membership-gated vs. management-gated, applied consistently.** Bare
  group access (viewing the group, its Members/Subjects/Materials/
  Activity lists, its AI Assistant) requires only membership — any role,
  including VIEWER. *Mutating* group-owned structure (creating/renaming/
  deleting a group Subject, changing a member's role, removing a member,
  sending an invitation) requires ADMIN or OWNER. Removing yourself
  ("leave") is the one exception allowed at any role below OWNER, since
  self-removal isn't a privilege escalation risk the way removing someone
  else is. OWNER can never be removed or have their role changed by
  anyone, including themselves via this path.
- **Activity/notification writes are atomic with the mutation they
  describe wherever both happen in the same transaction** (e.g. removing
  a member and logging `member.removed` either both commit or both roll
  back) — `lib/activity.ts`/`lib/notifications.ts`'s helpers accept
  either the shared `db` client or an active `tx` for exactly this
  reason.
- **Notification recipients are always derived server-side**, never from
  a client-supplied `userId` — invite/role-change/removal notifications
  go to the specific affected user; join/leave/decline notifications go
  to the group's current OWNER/ADMIN members (looked up fresh at write
  time), excluding the actor so nobody is notified about their own
  action.
- **No realtime layer was built for Phase 6** (spec §36's "Rahul uploaded
  Lecture.mp3" live-update behavior). `NotificationBell` polls
  `GET /api/notifications?unread=true` every 30 seconds instead of using
  websockets/SSE — there is no realtime infrastructure anywhere in this
  codebase yet, and building one for Phase 6 alone would have been a
  parallel subsystem rather than a continuation of the existing
  request/response architecture. Polling is the honest minimal behavior;
  a real realtime layer is a standalone follow-up, not scoped to any
  Phase 6 sub-phase.

## Known limitations (by design, not oversights)

- **No realtime collaboration** — see "Key decisions" above. Group state
  (members, activity, notifications) updates on navigation/refresh/poll,
  not instantly.
- **Chapter/Topic/Material mutation inside a group Subject was
  deliberately not expanded beyond Subject-level ADMIN+ gating during
  Phase 6.4**, and this remains undecided as of Phase 6.6's close. Group
  Subject creation/rename/delete requires ADMIN+; mutating a Chapter,
  Topic, or Material *inside* an already-existing group Subject currently
  follows the narrower existing per-resource access checks, not a
  blanket ADMIN+ gate. Whether it should be tightened is an open product
  decision, not yet made by any Phase 6 sub-phase.
- **Material move-between-owners stays unrestricted**, same open decision
  as above — not yet addressed.
- **One documented, narrow invitation race**: the duplicate-pending-
  invitation check (6.2) runs inside the same transaction as the create,
  narrowing but not fully eliminating two truly simultaneous invite
  requests both passing the check before either commits. Worst case is
  two `GroupInvitation` rows for the same group/email, which
  accept/decline both handle safely — see the code comment in
  `src/app/api/groups/[groupId]/invitations/route.ts` for the full
  reasoning on why a stricter guarantee (a partial unique index) wasn't
  pursued.
- **AI provider configuration is independent of Phase 6.** Group AI chat
  (6.5) uses the same provider-free scaffold as Phase 5 — real retrieval
  and scoping, no fabricated responses, but no actual model call happens
  until a real `AI_API_KEY`/provider is configured per `docs/ai-setup.md`.
  This was true before Phase 6 and nothing in Phase 6 changes it.
- **Prisma engine binaries are unreachable in this sandbox**
  (`binaries.prisma.sh` returns 403 — not on the environment's allowed-
  domains list), which blocks `npx prisma generate`/`migrate dev`/
  `migrate status` here. This is an environment limitation carried across
  every Phase 6 sub-phase, not something introduced by or specific to
  Phase 6 — see `PROJECT_STATE.md`'s "How to verify this document" for
  the exact typecheck-error-count consequence and the local command to
  clear it.
- **No manual browser/live-database verification has been performed for
  any Phase 6 sub-phase**, including 6.6 — this sandbox has no dev server
  or reachable database. All verification below is `test`/`lint`/
  `typecheck` only; see `PROJECT_STATE.md`'s "Exact next steps" for the
  manual click-through checklist still outstanding.

## Phase 6 verification checklist

- [ ] As a group OWNER, invite a new member by email, then accept from
      that account — role, activity log entry, and admin notification
      all appear correctly
- [ ] As a VIEWER, confirm you can read the group's Subjects/Materials/
      Activity/AI Assistant tabs but every mutating action (invite, role
      change, remove, create Subject) is hidden/rejected
- [ ] Remove a member as ADMIN — the removed user's next session shows a
      `GROUP_MEMBER_REMOVED` notification; a member leaving voluntarily
      instead notifies the group's admins, not the leaver
- [ ] Open the notification bell — unread badge count matches, clicking a
      notification marks it read and navigates to the linked page
- [ ] Confirm a non-member gets 403/404 from
      `GET /api/groups/[groupId]/activity`, not just a hidden tab
- [ ] `npm run test`, `npm run lint`, `npm run typecheck` — see
      `PROJECT_STATE.md` for the exact currently-expected numbers
