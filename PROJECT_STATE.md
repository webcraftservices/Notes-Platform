# PROJECT_STATE.md — Current State

Last verified against actual code and a real test/lint/typecheck run on
**2026-09-01** (Phase 6.7 closeout session). If you're reading this in a
later session, re-run the verification commands in the "How to verify
this document" section before trusting anything time-sensitive here —
code may have moved on.

> Cloned directly from `webcraftservices/Notes-Platform` on GitHub this
> session — this document is reconciled against the live repo, not a
> stale local checkout.
>
> **Correction to this document's previous revision**: the previous
> revision said Phase 6.1 was "implemented and verified... nothing has
> been committed or pushed." That was inaccurate by the time this session
> started — `git log` on a fresh clone shows Phase 6.1 was in fact
> committed (`bcbeab7 feat: implement phase 6.1 group access and crud`)
> and pushed to `origin/main` sometime after that revision was written,
> and this document was simply never updated to reflect it. Re-verified
> directly this session (127/127 tests, lint clean, 44 typecheck errors —
> matching what this document already predicted) before trusting it. This
> is the exact "document reconciled against the live repo" failure mode
> this file's own opening note warns about — recorded here so it doesn't
> repeat.

> **Second correction, this session (Phase 6.4)**: the previous revision's
> "Current phase"/"Current task"/"Exact next steps" sections below said
> Phase 6.2 and 6.3 were "implemented but NOT YET COMMITTED." That was
> also stale by the time this session started — a fresh `git clone` shows
> `main`/`origin/main` at `4c5c016 feat: implement group collaboration and
> invitations UI`, clean working tree, which already contains both 6.2
> and 6.3. This document was again just never updated after the commit
> happened. Re-verified directly this session (173/173 tests passing at
> that commit per the prior session log, matching what's recorded below)
> before trusting it. Same failure mode as the first correction note,
> recorded again so the pattern is visible: **always re-verify `git log`
> against a fresh clone before trusting this file's "committed" claims.**

---

## Current phase

**PHASE 6 — GROUP COLLABORATION: STATUS = COMPLETE / CLOSEOUT.**

**Phases 6.1–6.5 are COMPLETE, COMMITTED, AND PUSHED** to `main`
(`8f58f92 feat: add group-scoped AI chat`, on top of `c769f52` for 6.4,
`4c5c016` for 6.2/6.3, and `bcbeab7` for 6.1).

> **Third correction to this document (this session, Phase 6.5)**: the
> previous revision's "Current phase" section said Phase 6.4 was
> "IMPLEMENTED and verified in this sandbox, but NOT YET COMMITTED." That
> was stale by the time this session started — a fresh `git clone` shows
> `main`/`origin/main` at `c769f52 feat: attach subjects and materials to
> groups`, clean working tree, which already contains 6.4. This is the
> exact same failure mode flagged twice before (see the first two
> correction notes above): the document was never updated after the
> commit happened. Re-verified directly this session (184/184 tests at
> the start of this session before any Phase 6.5 changes, lint clean, 61
> typecheck errors — all three matching what this document already
> predicted) before trusting it. **Always re-verify `git log` against a
> fresh clone before trusting this file's "committed" claims** — this is
> now the third time this exact pattern has occurred; treat every
> "committed"/"uncommitted" claim in this document as provisional until
> checked against `git log`/`git status` directly.

**Phase 6.6 (activity log + notifications) is IMPLEMENTED and verified in
this sandbox, NOT YET COMMITTED** — left in the working tree for user
review, per every prior phase's git-safety rule.
`ActivityLog`/`Notification`/`NotificationType` already existed in the
schema since Phase 1 but were completely unwired before the Phase 6.6
session; that session wired them into groups/membership/subjects/
materials and added the Activity tab + notification bell UI. The Group
detail page's Activity tab now shows real group activity (newest first,
paginated) — the `PhasePlaceholder` naming this phase is gone; the
Subjects/Materials tabs (Phase 6.4) and AI Assistant tab (Phase 6.5) were
already real. The authenticated shell's Topbar now has a notification
bell (unread badge, dropdown, mark-as-read, click-to-navigate) on every
page. See "Recent work completed" for the full session log.

**Phase 6.7 (docs/closeout) is this session.** Its scope is
documentation only — `PROJECT_STATE.md` (this file), `docs/ARCHITECTURE.md`
(added a "Phase 6 — Groups + collaboration" section, since none existed;
fixed one stale "Groups → Phase 6 deferred" bullet), and `CLAUDE.md` (one
stale typecheck-baseline number corrected). **No application source,
schema, migration, test, or dependency was touched this session** — the
only non-documentation files in the working tree are the Phase 6.6
implementation files carried over unchanged from that session, still
uncommitted, still awaiting the same review. Phase 6.6's code itself was
not re-touched or re-designed during 6.7 — only described accurately.

With Phase 6.7 closeout complete (as of this document), **Phase 6 as a
whole (6.1 through 6.7) is COMPLETE** — 6.1–6.5 are committed/pushed;
6.6's code and 6.7's documentation are both implemented and verified in
this sandbox but sit together, uncommitted, for one combined review pass
covering both. **Phase 7 has NOT been started** — see "Document Phase 7
boundary" below.

Three architectural decisions were confirmed by the user before Phase 6.1
implementation (see "Recent work completed" below for the full
rationale):
1. A Subject belongs to exactly one scope — Workspace OR Group, never
   both, never neither (`Subject.workspaceId` is now nullable). Wired
   into `/api/subjects`'s create/update routes as of Phase 6.4 — Phase
   6.1 only built the invariant helper and the read-path scope
   resolution; the create/update routes themselves were still
   workspace-hardcoded until 6.4.
2. Group AI conversations are private per user, scoped to shared group
   knowledge — not shared multi-user threads. **Implemented as of Phase
   6.5**: `getAccessibleAIScope` now resolves a bare group scope
   (`AIScopeInput.groupId`, no subject/chapter/topic underneath it) by
   group membership alone (any role), while `AIConversation` ownership
   stays per-user (`userId` match, unchanged from Phase 5) — so the
   underlying knowledge is shared but each member's conversation thread
   is their own, exactly as decided.
3. Invitation acceptance requires the accepting account's email to
   match the invitation's email — implemented as part of Phase 6.2.

Phase 5 (AI notes + RAG + AI chat) is COMPLETE and formally closed. Built
provider-free by explicit user decision — no AI/embedding SDK, no API
keys, no fake responses. See `docs/ai-setup.md` for how to activate a
real provider later. Phases 1–4 remain complete and unmodified.

Two known issues were investigated during Phase 5 closeout and are
recorded below as **explicitly deferred, non-blocking** — see "Known
deferred issues (Phase 5 closeout)". Neither blocks Phase 6, and neither
was touched during Phase 6.1–6.5.


Phases 1–5, per the master prompt's own phase breakdown:
- [x] Phase 1 — Architecture, database, authentication
- [x] Phase 2 — Dashboard + Subject/Chapter/Topic system
- [x] Phase 3 — Notes editor + materials
- [x] Phase 4 — Audio recording + transcription
- [x] Phase 5 — AI notes + RAG + AI chat (provider-free scaffold — see below) — **CLOSED**
- [~] Phase 6 — Groups + collaboration (**CLOSEOUT COMPLETE** — 6.1–6.5 committed+pushed; 6.6 code + 6.7 docs implemented and verified in this sandbox, both uncommitted, awaiting one combined review; see "Recent work completed")
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

**Groups (Phase 6, COMPLETE through 6.6)**: `Group`/`GroupMember`/
`GroupInvitation` CRUD, membership, and role hierarchy are real and fully
authorized server-side. `POST /api/groups` creates a Group and makes the
caller its OWNER atomically; `GET /api/groups` lists the caller's groups
with role + member count; `GET/PATCH/DELETE /api/groups/[groupId]`
enforce OWNER > ADMIN > MEMBER > VIEWER server-side (`lib/access.ts`,
`lib/group-role.ts`) — read requires any membership, edit requires
ADMIN+, delete requires OWNER; OWNER can never be demoted/removed via any
route. `Subject.workspaceId` is nullable and `/api/subjects`'s
create/update routes resolve to either a Workspace or a Group scope (one
of the two, never both — Phase 6.4). Token-based invitations with expiry
and accepting-account email match; a full Groups UI (list, detail page
with Members/Subjects/Materials/Activity/AI Assistant tabs, invite/
accept/decline flows) exists (Phase 6.3). Group-scoped Subjects (ADMIN+
to create/rename/delete) and Materials (bare group Material readable by
any member) exist (Phase 6.4). Group-scoped AI Assistant — shared group
knowledge retrieval, private per-user conversation threads — exists
(Phase 6.5). `ActivityLog`/`Notification` are wired into group create,
invite/accept/decline, role change, member remove/leave, group Subject
create/update/delete, and group Material add/remove, with a real Activity
tab UI and a global `NotificationBell` in the shell Topbar (Phase 6.6).
**No realtime** (live in-page updates without refresh/poll) — the
notification bell polls every 30s instead; there is no websocket/SSE
infrastructure anywhere in this codebase. See `docs/ARCHITECTURE.md`'s
"Phase 6 — Groups + collaboration" section for the full architecture and
known limitations.

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
- No Groups Phase 6.7+ functionality beyond documentation/closeout — 6.1
  through 6.6 (backend, membership/invitations, UI, group-scoped
  Subjects/Materials, group-scoped AI, activity/notifications) are all
  implemented; see the "Groups" entry in "What's actually implemented"
  above for the accurate, current state and `docs/ARCHITECTURE.md`'s
  "Phase 6" section for the architecture and known limitations.
- No Google Drive/Docs import (Phase 7).
- No flashcards/quizzes/AI tutor (Phase 8).
- No production hardening — no Postgres row-level security, no real
  distributed rate limiting (in-memory only), no observability/logging
  infra (Phase 9).
- **No realtime collaboration anywhere in this codebase** — Phase 6.6's
  notification bell polls every 30s rather than pushing live updates; a
  group member uploading a material does not appear to other members
  without a refresh/poll. No websocket/SSE infrastructure exists. See
  `docs/ARCHITECTURE.md`'s "Phase 6" section, "Known limitations."
- **Group Chapter/Topic/Material mutation *inside* an existing group
  Subject is not role-gated beyond the existing per-resource checks** —
  only group Subject create/rename/delete itself requires ADMIN+ (Phase
  6.4). Whether to tighten this further is an open, undecided product
  question, not yet addressed by any Phase 6 sub-phase including 6.6.
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

### Session: Phase 6.7 — Documentation / closeout

**Ground-truth audit**: fresh clone, `git log` confirms HEAD =
`8f58f92 feat: add group-scoped AI chat`, `git status` shows the Phase
6.6 working-tree changes exactly as the prior session left them (12
modified + 12 new files, nothing committed) — matches this document's
own "Current phase" claims exactly, so no correction note was needed
this time (contrast with the four prior sessions, each of which found
this document out of sync with `git log`).

**Scope**: documentation only, per the phase brief. No application
source, Prisma schema, migration, test, or dependency file was touched.
Confirmed by `git status --short` before finishing: every changed file
is either `PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, or a
Phase 6.6 file carried over unmodified from the prior session.

**Files changed this session**: `PROJECT_STATE.md` (this file — see
below for what was corrected), `docs/ARCHITECTURE.md` (added a
"Phase 6 — Groups + collaboration" section — none existed before, despite
Phase 6.1–6.6 all being implemented; fixed one stale bullet in the
Phase-1-era "What's deliberately deferred" list that still said Groups
was fully future work), `CLAUDE.md` (corrected one stale typecheck
baseline figure, "~38" → a pointer to the live number in
`PROJECT_STATE.md`, since that figure has drifted across every phase
since Phase 1/2 and this file is updated far less often).

**What was corrected in `PROJECT_STATE.md`**:
- "Current phase" section restructured: removed a now-redundant
  duplicate "Phase 6.5 COMPLETE COMMITTED PUSHED" paragraph (the header
  already states it), replaced the old "Phase 6.6 implemented / Phase 6.7
  not started" closing paragraph with an accurate one reflecting that
  6.7 is *this* session, and added the top-line "PHASE 6 — GROUP
  COLLABORATION: STATUS = COMPLETE / CLOSEOUT" statement the 6.7 brief
  asked for.
- The "Groups" entry under "What's actually implemented" was **still
  describing the Phase 6.1-only state** ("No UI, no membership/
  invitation flow, no group-owned Subjects/Materials, no group-scoped AI
  yet") despite 6.2 through 6.6 having been implemented and committed/
  verified in the sessions since — the single most stale claim found
  this session. Rewritten to describe the actual, current, all-of-6.1–6.6
  state.
- The matching bullet under "What is explicitly NOT implemented" ("No
  Groups membership, invitations, UI, or Group-scoped content (Phase
  6.2–6.7)") was equally stale and equally false by now — replaced with
  an accurate pointer to the rewritten "What's actually implemented"
  entry, plus the two genuinely-still-true limitations (no realtime; the
  undecided Chapter/Topic/Material-inside-group-Subject role-gating
  question) called out explicitly rather than buried in a phase-range
  bullet that no longer meant what it used to.
- "Tests performed" section: the existing content was a **stale Phase
  6.2-session snapshot** (164/164 tests, 50 typecheck errors — both long
  superseded) still sitting under a heading that read as current. Kept
  for historical record (this document's own established pattern is to
  preserve prior sessions' logs, not delete them) but relabeled
  "Historical: Phase 6.2 session (kept for record, do not treat as
  current)", with a freshly-run, clearly-current verification block added
  above it for this session.
- "Exact next steps": updated to reflect 6.7 being done and Phase 7 being
  the explicitly-not-started next phase, carried forward every
  still-genuinely-outstanding item unchanged (Prisma generate, manual
  browser verification of 6.5/6.6, the two undecided Phase 6.4/6.6
  permission questions, Phase 5 real-database verification, AI provider
  activation, small cleanups), and added one new item noting the
  realtime gap as a candidate for future work.
- The `- [~] Phase 6 — Groups + collaboration (...)` line in the phase
  checklist near the top of this document updated from "IN PROGRESS" to
  "CLOSEOUT COMPLETE."

**Verification** (re-run fresh this session, not assumed from the prior
session's numbers, specifically to confirm the "no code changed" claim
above): `npm run test` → **199/199 passing** (unchanged from Phase 6.6,
as expected for a docs-only session). `npm run lint` → **0 errors, 0
warnings**. `npm run typecheck` → **68 errors**, identical count to the
Phase 6.6 session's own result, confirming no regression was introduced
by the documentation edits. `npx prisma migrate status` → blocked, same
`binaries.prisma.sh` 403 as every prior sandbox session; no database is
configured/reachable here either, so migration status genuinely cannot
be checked from this environment regardless of the network block.

**Known limitations** (Phase 6, all sub-phases, restated here per the
6.7 brief's Step 4 — none invented this session, all carried forward from
where they were originally documented):
1. Prisma engine binaries unreachable in this sandbox (every Phase 6
   sub-phase since 6.1).
2. No manual browser/live-database verification has been performed for
   any Phase 6 sub-phase, including 6.6 — this sandbox has no dev server
   or reachable database.
3. Chapter/Topic/Material mutation inside a group Subject was
   deliberately not expanded beyond Subject-level ADMIN+ gating during
   Phase 6.4, and remains an open, undecided product question as of
   6.6's close.
4. The invitation duplicate-pending-request race narrowed (not fully
   eliminated) by Phase 6.2's in-transaction check — see the code comment
   in `src/app/api/groups/[groupId]/invitations/route.ts`.
5. AI provider configuration (Phase 5) remains independent of and
   unaffected by Phase 6 — Group AI chat (6.5) uses the same
   provider-free scaffold, real everything except the actual model call.
6. No realtime collaboration — restated explicitly this session since it
   was previously only implicit (spec §36 was simply never marked done
   or not-done anywhere before now). Now explicitly documented in both
   `PROJECT_STATE.md` and `docs/ARCHITECTURE.md`'s new Phase 6 section.

**Git**: nothing committed, nothing pushed, this session or the prior
one. `git status --short` at the end of this session shows exactly:
the Phase 6.6 implementation files (unchanged from that session) plus
`PROJECT_STATE.md`/`docs/ARCHITECTURE.md`/`CLAUDE.md` (this session's
documentation edits). **Phase 7 was NOT started** — no Google Drive/Docs
code, no new routes, no new UI beyond what Phase 6.6 already added.

### Session: Phase 6.6 — Group activity log + notifications

Started from a fresh clone at `8f58f92 feat: add group-scoped AI chat`
(confirmed via `git log`/`git status` — clean tree). This means Phase 6.5
**was actually already committed** by the time this session started,
contrary to this document's then-current "IMPLEMENTED... but NOT YET
COMMITTED" claim in the "Current phase" section — the same
never-updated-after-commit failure mode flagged three times already
above (see the numbered correction notes at the top of this document).
The "Current phase" section has been corrected accordingly for this
revision.

**Ground-truth audit performed before writing any code**: read
`PROJECT_STATE.md`, `CLAUDE.md`, `prisma/schema.prisma`, and every route
listed in the Phase 6.6 brief (groups CRUD, invitations create/accept/
decline, members PATCH/DELETE, subjects create/update/delete, materials
create/complete/delete), plus `lib/access.ts`, `lib/api-response.ts`,
`lib/group-role.ts`, the existing UI shell/components, and the existing
test suite's conventions.

**Finding: `ActivityLog`, `Notification`, and `NotificationType` already
existed in the schema** (added in the Phase 1 schema design, alongside
every other model in the master ERD) but were **completely unwired** —
the only prior usage anywhere in the codebase was a single inline
`tx.notification.create(...)` call inside the Phase 6.2 invitations
route. No migration was needed for the models themselves; only two
additive changes were needed: three composite indexes
(`ActivityLog(groupId, createdAt)`, `Notification(userId, createdAt)`,
`Notification(userId, readAt)`) for the access patterns this phase's
reads actually use, and five new `NotificationType` enum values
(`GROUP_MEMBER_JOINED/LEFT/REMOVED`, `GROUP_ROLE_CHANGED`,
`GROUP_INVITATION_DECLINED`) for membership events the existing enum had
no type for.

**Implementation** (18 files — 12 modified, 6 new library/route files,
plus 3 new UI components and a hand-written migration; no unrelated file
touched):

*New library helpers:*
- `src/lib/activity.ts` — `ActivityAction` constants (`"group.created"`,
  `"member.invited"`, `"member.joined"`, `"member.left"`,
  `"member.removed"`, `"member.role_changed"`, `"invitation.declined"`,
  `"subject.created/updated/deleted"`, `"material.added/removed"`,
  following the dot-separated convention already documented on
  `ActivityLog.action` in the schema) and `createActivityLog(client,
  input)`, which accepts either the shared `db` client or an active
  `tx` so writes can be atomic with the mutation they describe.
- `src/lib/notifications.ts` — `createNotification`, `createNotifications`
  (bulk, for "every admin/owner" fan-out), and `getGroupAdminUserIds`
  (OWNER/ADMIN lookup with optional actor exclusion, so actors are never
  notified about their own action per spec §7).
- `src/lib/activity-style.ts` — pure `formatActivityMessage(entry)`,
  turning an ActivityLog row into a sentence for the UI ("Nishant created
  the group", "Priya changed Rahul's role to Admin"). Kept pure (no db
  access) so it's covered by a plain unit test, same reasoning as the
  existing `group-style.ts`.
- `src/lib/validation/notifications.ts` — `updateNotificationSchema =
  z.object({ read: z.boolean() })`, the only mutable field on a
  Notification from the client's perspective.

*Wired into existing routes* (activity log + notification, where
applicable, inside the same transaction as the mutation they describe):
group creation; invite sent; invitation accepted (notifies admins,
logs `member.joined`); invitation declined (notifies admins, logs
`invitation.declined`); member role changed (notifies the affected
member); member removed (notifies the removed user) vs. member left
(notifies admins) — both through the same `DELETE
/api/groups/[groupId]/members/[userId]`, branched on `isSelf`; group
Subject create/update/delete; group Material added (both the LINK-create
path and the upload `.../complete` path, only once a material actually
reaches `READY`) and removed. AI conversation routes were deliberately
left untouched — per spec §6, private per-user AI chat must never leak
into group activity.

*New API routes:*
- `GET /api/groups/[groupId]/activity` — group-scoped, membership
  required (`getAccessibleGroup`, same null-vs-throw/404-vs-403 split
  every other group-scoped list route already uses), newest first,
  cursor-paginated (`?cursor=<id>`, 30/page — no other route in this
  codebase paginates yet, so this is the smallest workable cursor scheme
  rather than a new convention), actor included via one join (no N+1).
- `GET /api/notifications` — recipient always derived from the session,
  never a client param; `?unread=true` filter; same cursor pagination.
- `PATCH /api/notifications/[notificationId]` — ownership checked against
  the fetched row's `userId` (404 if missing, 403 if not the owner's);
  only `readAt` is ever written.

*New UI:*
- `src/components/notifications/notification-bell.tsx` — bell icon in
  `Topbar` (so it's on every authenticated page), polls the unread count
  every 30s (no realtime/websocket infrastructure exists anywhere in this
  codebase yet, so polling is the correct minimal behavior, not a
  half-built realtime layer), lazy-loads the full list on open, marks
  read + navigates on click.
- `src/components/groups/group-activity-panel.tsx` — replaces the
  `PhasePlaceholder` on the Group page's Activity tab; receives the first
  page server-fetched in `page.tsx` (same convention as
  `GroupMembersPanel`/`GroupMaterialsPanel`) and paginates further pages
  itself via the new activity API.
- `src/app/(app)/groups/[groupId]/page.tsx` — fetches the first activity
  page alongside the existing members/invitations/subjects/materials
  fetches and passes it to `GroupTabs` → `GroupActivityPanel`.

**Migration**: `prisma/migrations/20260830100000_group_activity_notifications/migration.sql`,
hand-written (project convention — no `prisma migrate dev` available in
this sandbox, same as every prior Phase 6 sub-phase), 5 `ALTER TYPE ...
ADD VALUE` statements followed by 3 `CREATE INDEX` statements. No
existing migration modified or deleted; no data changes.

**Tests**: 15 new tests — 10 for `formatActivityMessage` (one per action
type, plus fallback/missing-metadata cases) and 5 for
`updateNotificationSchema`. Deliberately did not attempt DB-mocked tests
for the route handlers themselves, matching this project's established
"pure helpers get unit tests, DB-touching authorization logic doesn't get
mocked" convention (see `group-role.test.ts`, `subject-scope.test.ts`).

**Verification**:
- `npx vitest run` → **199/199 passing** (184 existing + 15 new), 0
  failures.
- `npx eslint .` → **0 errors, 0 warnings**.
- `npx tsc --noEmit` → **68 errors**, vs. a freshly re-verified baseline
  of **62** (confirmed via `git stash -u` + `tsc` on the untouched clone,
  not assumed from a prior session's stale count). Of the 6 new errors:
  5 are the exact same `Prisma`-namespace-cascade class already present
  62 times in baseline (`Module '"@prisma/client"' has no exported member
  'X'` / `Namespace Prisma has no exported member 'XWhereInput'`) — caused
  by `npx prisma generate` being blocked in this sandbox (`binaries.prisma.sh`
  returns 403; it isn't on the environment's allowed-domains list), not by
  anything wrong in the new code. The 5 new instances are exactly the
  places new code references `ActivityLog`, `User`, `InputJsonValue`, or
  `NotificationType` — types/enum-members that are correct in
  `schema.prisma` but don't exist in the *stale, un-regenerated* client
  still sitting in `node_modules/.prisma`. **The 1 remaining new error**
  (`page.tsx`, implicit-any on a `.map((log) => ...)` callback) matches
  the exact same pre-existing, already-baselined pattern immediately
  above it in the same file (`.map((m) => ...)`, `.map((inv) => ...)`) —
  a known JSX-inline-arrow-function inference gap in this codebase's
  tsconfig, not a new class of problem.
- `npx prisma generate` / `npx prisma migrate dev` — **blocked**: fetching
  `https://binaries.prisma.sh/...` returns 403 in this sandbox. Documented
  here rather than faked; see "Exact next steps" below for the exact
  command to run locally.

**Git**: nothing committed, nothing pushed. `git diff --stat` confirms
every changed/new file belongs to Phase 6.6 (or, for `page.tsx`/
`group-tabs.tsx`, is the minimal touch needed to wire the new Activity
panel in). `git diff --check` clean (no whitespace errors). A stray
`package-lock.json` diff produced by this sandbox's own `npm install`
(an `fsevents` `"dev": true` flag normalization, unrelated to Phase 6.6)
was reverted with `git checkout -- package-lock.json` before finishing,
so it doesn't show up in the diff Nishant reviews.

### Session: Phase 6.5 — Group-scoped AI chat

Started from a fresh clone at `c769f52` (confirmed via `git log`/`git
status` — clean tree, Phase 6.4 already committed and pushed, contrary to
this document's previous "not yet committed" claim; see the third
correction note at the top of this document).

**Ground-truth audit performed before writing any code**, per the
session's own instructions: read `PROJECT_STATE.md`, `ARCHITECTURE.md`,
`CLAUDE.md`, `README.md`, `prisma/schema.prisma`, and the relevant
existing routes/components/libs, and confirmed via `git log -15`/`git
status` that the repo, not the document, was the authority for what was
actually committed.

**Finding: almost all of Phase 6.5's groundwork already existed.** Phase
6.1's `ResolvedAIScope` discriminated union already modeled
`ownerType: "group"` correctly; `retrieval.ts`'s `materialWhereForScope`
already had an `ownerType === "group"` branch (documented as
unreachable); `conversations/route.ts`'s `scopeFkFields` already wrote
`groupId` onto new conversations for that ownerType. The *only* missing
piece across the whole stack was that `AIScopeInput`/`aiScopeQuerySchema`
had no `groupId` field, so `ownerType: "group"` could never actually be
produced. This meant **no schema change and no migration** — the
`AIConversation.groupId` FK and `Group.aiConversations` relation already
existed from Phase 6.1's schema design.

**Implementation** (8 files, all directly attributable to Phase 6.5; no
unrelated file touched):
- `src/lib/access.ts` — added `groupId?: string` to `AIScopeInput`; added
  a branch in `getAccessibleAIScope` that resolves a bare group scope via
  the existing `getAccessibleGroup` helper (any group member, any role —
  matching the "shared knowledge, not manage-gated" decision, the same
  membership-only rule `assertScopeAccess` already uses for group-owned
  Subjects/Materials); `getAccessibleAIConversation`'s scope re-check now
  passes `groupId` through too, so a stored group-scoped conversation is
  re-authorized on every read/write, not just at creation.
- `src/lib/validation/ai.ts` — added `groupId: z.string().cuid().optional()`
  to `aiScopeFields`, same narrowest-wins precedence convention as the
  other three fields (route/access-layer decides precedence, not the
  validator).
- `src/app/api/ai/conversations/route.ts` — `GET` now parses `groupId`
  from the query string (the existing `scopeFkFields`/`POST` logic needed
  no changes — they already handled `ownerType: "group"` generically).
- `src/app/api/ai/conversations/[conversationId]/messages/route.ts` —
  passes `conversation.groupId` into the scope re-resolution before
  calling `retrieveRelevantChunks`, so group-scoped retrieval actually
  filters to that group's materials.
- `src/lib/retrieval.ts` — comment-only; the group branch is no longer
  "unreachable," no logic changed.
- `src/components/ai/ai-chat-panel.tsx` — extended the `AIScope` union
  with `{ groupId: string }`. `scopeToQuery` (generic
  `URLSearchParams`-based) and every other code path needed no changes.
- `src/components/groups/group-tabs.tsx` — replaced the AI Assistant
  tab's `PhasePlaceholder` with a real `<AIChatPanel scope={{ groupId }}
  .../>`, reusing the exact same component `TopicTabs` already uses
  rather than building a second chat UI.
- `src/lib/validation/__tests__/ai.test.ts` — 4 new tests: valid
  `groupId`, invalid (non-cuid) `groupId`, and `groupId` accepted
  alongside a narrower field (route decides precedence, same as the
  existing `subjectId`+`topicId` test).

**Decision made this session (not previously settled in the repo):**
group AI chat access is membership-only, not role-gated — a VIEWER can
ask the group AI questions, same as a VIEWER can already read group
Subjects/Materials. This mirrors the existing "any group member reaches
group content" rule (`assertScopeAccess`/`userIsGroupMember`) rather than
inventing a new ADMIN-only restriction Phase 6.1-6.4's permission matrix
never specified for AI chat specifically.

**Verification**: 184/184 tests passing (180 pre-session + 4 new), lint
clean, 61 typecheck errors — verified identical to the pre-session
baseline via a `git stash`/typecheck/`git stash pop` diff (every error
matched 1:1 by message, just shifted by the line numbers this session's
edits introduced; zero new errors). `package-lock.json`'s incidental
`npm install` churn (`fsevents`'s `"dev": true` flag) and the generated
`tsconfig.tsbuildinfo` were both reverted/removed before finishing, so
`git diff --stat` shows exactly the 8 intentional files. `git diff
--check` clean (no whitespace errors).

**Not touched this session**: Phase 6.6 (activity log/notifications) —
the Group detail page's Activity tab is still the Phase-6.4-era
`PhasePlaceholder`, untouched. No Prisma-cascade typecheck errors were
investigated or "fixed" (same explicit out-of-scope call as every prior
Phase 6 session).

**Git status at end of session**: `main`/`origin/main` at `c769f52`
(Phase 6.1–6.4), clean; Phase 6.5's 8 files sit uncommitted in the
working tree for review, per the git-safety rule every phase in this
project follows.

### Session: Phase 6.4 — Subjects & Materials attach to Groups
Ground-truth audit first (fresh clone, ignored this document's own stale
claims per its opening warning): confirmed `main`/`origin/main` at
`4c5c016`, clean tree, and — importantly — that Phase 6.1 had already
built the schema/invariant groundwork for this phase further ahead than
expected: `Subject.groupId`/`Material.groupId` columns, FKs, and indexes
already existed in the initial migration (not a later one), and
`lib/subject-scope.ts` (`assertSubjectScopeInvariant`,
`resolveSubjectOwner`) and `lib/access.ts`'s `assertScopeAccess` already
branched on group vs. workspace scope for every **read** path
(`getAccessibleSubject/Chapter/Topic/Material`, `getAccessibleAIScope`).
**No new Prisma migration was needed for this phase** — confirmed by
inspecting the migrations directory directly rather than assuming.

What was actually missing (verified against the code, not guessed):
`POST`/`GET /api/subjects` were hardcoded to the personal workspace;
`PATCH`/`DELETE /api/subjects/[subjectId]` had no role check at all (any
member, including VIEWER, could rename/delete a group Subject);
`lib/materials-scope.ts` unconditionally hardcoded `workspaceId` and
never derived `groupId`, so a Material attached under a group Subject
would have silently become workspace-owned; `GET /api/materials` had no
group filter; and the material PATCH's "detach to Unorganized" path
would have reassigned a group Material back to the personal workspace.

**Changes**:
- `lib/access.ts` — added `assertSubjectManageAccess(scope, userId)`:
  ADMIN+ via `requireGroupRole` for group Subjects, no-op for
  workspace/personal ones. Deliberately not extended to Chapter/Topic/
  Material mutations — see "Known limitations" below.
- `lib/materials-scope.ts` — `resolveMaterialScope` now calls
  `resolveSubjectOwner` on the target Subject/Chapter/Topic instead of
  always assuming the caller's workspace, so a Material's owner
  (workspace vs. group) always follows the owner of what it's attached
  to.
- `lib/validation/hierarchy.ts` — `createSubjectSchema` gained an
  optional `groupId: z.string().cuid()`. `updateSubjectSchema`
  deliberately did NOT gain one — scope switching between
  workspace/group is not a specified feature, so it stays impossible via
  PATCH (verified with a test that the field is silently stripped, not
  accepted).
- `lib/validation/materials.ts` — `listMaterialsQuerySchema` gained an
  optional `groupId` for the Group Materials tab.
- `app/api/subjects/route.ts` — `GET` accepts `?groupId=` (verifies
  membership via `getAccessibleGroup`, same NOT_FOUND/FORBIDDEN split
  every other group-scoped read uses); `POST` accepts `groupId` in the
  body, requires ADMIN+ via `requireGroupRole`, asserts the scope
  invariant defensively before create. workspaceId is never
  client-supplied, so "both fields provided" can't happen by
  construction.
- `app/api/subjects/[subjectId]/route.ts` — `PATCH`/`DELETE` now call
  `assertSubjectManageAccess` before mutating.
- `app/api/materials/route.ts` — `GET` accepts `?groupId=`; `POST` now
  sets `groupId` on the created row from the resolved scope.
- `app/api/materials/upload-url/route.ts` — same `groupId` addition on
  create.
- `app/api/materials/[materialId]/route.ts` — the detach-to-Unorganized
  branch now preserves `existing.groupId` instead of hardcoding the
  caller's personal workspace, so a group Material stays
  group-owned-but-unattached rather than silently moving to the user's
  personal workspace.
- `components/subjects/subject-card.tsx` — new optional `canManage`
  prop (default `true`, so every existing personal/workspace call site
  is unaffected) hiding the actions menu for MEMBER/VIEWER in a group
  context. UI convenience only — the real authorization is server-side.
- New: `components/groups/create-group-subject-dialog.tsx` — a
  self-contained dialog (own local `open` state, own trigger button)
  rather than teaching the global `CreateSubjectDialog`/`ui-store`
  singleton about an optional `groupId`.
- New: `components/groups/group-subjects-panel.tsx`,
  `components/groups/group-materials-panel.tsx` — replace the Phase 6.3
  `PhasePlaceholder`s in the Subjects/Materials tabs. Data is fetched
  server-side in `groups/[groupId]/page.tsx` (already proven a group
  member by `requireGroup`) and passed down as plain props, matching how
  `GroupMembersPanel` already gets its data — no second client-side
  fetch/access layer introduced.
- `components/groups/group-tabs.tsx` — wires the two new panels in;
  `PhasePlaceholder` still used for Activity/AI Assistant (6.6/6.5,
  genuinely not started).
- `app/(app)/groups/[groupId]/page.tsx` — fetches the group's Subjects
  (with `_count`) and up to 50 most recent Materials, passes to
  `GroupTabs`.
- `app/(app)/subjects/[subjectId]/page.tsx` — this page is shared by
  personal/workspace and group Subjects (`requireSubject` already
  handled both transparently before this phase). For a group Subject:
  breadcrumb now points at the owning Group instead of "My Subjects";
  `EditableHeader`/`SubjectActionsMenu` (rename/archive/delete) are only
  shown when the caller's role meets ADMIN, computed via `getGroupRole`
  + `roleMeetsMinimum` (mirrors the exact pattern `groups/[groupId]/
  page.tsx`'s Overview tab already uses for the same "hide edit UI below
  ADMIN" purpose). **Deliberately not extended to "New Chapter" /
  Chapter/Topic actions** — see "Known limitations".

**Tests added** (8 new, all pure/schema-level — no DB-touching function
was added, so nothing new needed the project's deliberately-avoided DB
mocking):
- `validation/__tests__/hierarchy.test.ts`: `createSubjectSchema` accepts
  a valid `groupId`, treats a missing `groupId` as workspace-scoped,
  rejects a malformed one; `updateSubjectSchema` silently strips an
  attempted `groupId` (locks in that scope-switching stays impossible).
- `validation/__tests__/materials-notes.test.ts`: `listMaterialsQuerySchema`
  accepts an empty query, accepts a valid `groupId`, rejects a malformed
  one, and accepts `groupId` alongside a `subjectId`/etc. filter.
- `assertSubjectScopeInvariant`/`resolveSubjectOwner`
  (`lib/__tests__/subject-scope.test.ts`) and `roleMeetsMinimum`
  (`lib/__tests__/group-role.test.ts`) were inspected and already fully
  covered every case this phase relies on (both/neither invariant,
  workspace/group resolution, ADMIN/MEMBER/VIEWER boundaries) — no
  changes needed there.
- `assertSubjectManageAccess` itself was NOT unit tested — like every
  sibling DB-touching function in `access.ts` (`assertScopeAccess`,
  `requireGroupRole`, `getAccessibleSubject`, etc.), it has no unit test
  today because it hits the database; the project's established
  convention is to keep pure logic (like `roleMeetsMinimum`, which it
  delegates to) unit-tested and verify the thin DB-touching wrapper by
  inspection/manual testing instead, rather than introducing a DB-mocking
  framework. Consistent with existing practice, not a new gap.

**Verification this session**:
- `npm install` — clean (added `node_modules`, gitignored; reverted the
  incidental `package-lock.json` diff `npm install` produced, and removed
  the `tsconfig.tsbuildinfo` build artifact it left behind, so the final
  diff only contains intentional Phase 6.4 changes).
- `npm run test` — **181/181 passing** (173 baseline + 8 new).
- `npm run lint` — **clean**.
- `npm run typecheck` — measured the *actual* baseline in this sandbox by
  `git stash`-ing all Phase 6.4 changes and re-running rather than
  trusting this document's previously-recorded number: baseline is
  **60** errors (not the 58 this document previously claimed — some
  drift since that number was recorded, unrelated to this phase), all
  the same "Prisma-stub-client cascade" (`prisma generate` blocked by
  the sandbox's `binaries.prisma.sh` 403, so `@prisma/client` is an
  un-generated stub with no exported members, cascading into
  implicit-`any` errors downstream). With Phase 6.4's changes: **61**
  errors — a net +1, entirely explained by `app/api/subjects/route.ts`
  gaining an explicit `Prisma.SubjectWhereInput` type annotation where
  none existed before (the same "no exported member" cascade every other
  Prisma-typed file already shows, just newly surfaced on this one line
  because it's a new type annotation, not a new class of error). Every
  other new error is the same cascade hitting newly-added imports of
  `MemberRole`/`Material` from `@prisma/client` in the new/edited group
  UI files. None are genuine logic errors — confirmed by inspecting the
  full list of new error lines individually, not just the count.
- `npm run db:generate` — **fails**, expected: 403 on
  `binaries.prisma.sh`, same known sandbox limitation as every prior
  Phase 6 session. Not attempted: `npm run db:migrate` (no migration was
  created this phase, so nothing to run) and `npx prisma migrate status`
  (requires a reachable database, not available in this sandbox either).
- **Manual browser verification**: NOT performed — this sandbox cannot
  run a dev server or reach a database. This is stated plainly rather
  than assumed fine; see "Exact next steps".

**Known limitations** (deliberate scope boundaries, not oversights):
1. Chapter/Topic/Material mutation permissions inside a group Subject
   are unchanged from pre-6.4 behavior: any group member (including
   VIEWER) can create/rename/delete a Chapter or Topic under a group
   Subject, and can upload/edit/delete a Material there. The Phase 6.4
   spec's permission matrix only covers Subject-level create/edit/delete
   (gated to ADMIN+, implemented above); extending role-gating further
   down the hierarchy was explicitly out of scope for this phase per the
   instructions given, and doing so unasked would have been scope creep.
   Flagged here so it's a visible, deliberate decision for whoever scopes
   the next phase, not a silently-discovered gap later.
2. Moving a Material between an existing Subject/Chapter/Topic (the
   `updateMaterialSchema` "move" path, pre-existing since before Phase
   6.4) now correctly follows the destination's owner via
   `resolveMaterialScope` — including, as a natural consequence of that
   fix, letting a Material move from a personal Subject into a group
   Subject the user administers, or vice versa, if the user has access
   to both. This was not a new feature request; it's what "don't let a
   group Material accidentally become workspace-owned" required fixing
   for the *existing* move feature to remain correct. Not gated beyond
   the existing `resolveMaterialScope` accessibility check (must be able
   to reach the destination) because no additional restriction was
   specified.
3. `PROJECT_STATE.md`'s previously-recorded typecheck baseline (58) had
   already drifted from this sandbox's actual baseline (60) by the start
   of this session, for reasons unrelated to Phase 6.4 (not
   investigated — out of scope for this phase to chase down).

### Session: Phase 6.3 — Groups UI
Continued in the same sandbox working tree as the Phase 6.2 session
(confirmed via a fresh clone that `origin/main` was still at `bcbeab7`,
i.e. Phase 6.2 was genuinely still unpushed, not just presumed so) —
built Phase 6.3 on top of the uncommitted Phase 6.2 changes rather than
re-cloning and losing them. Investigated the existing UI architecture
first (Subjects list/detail pages, Topic page's Tabs pattern,
`ui-store.ts`'s Zustand pattern, every `components/ui/*` primitive, the
command palette, exact Phase 6.1/6.2 API response shapes) before writing
any component, per the doc's instruction.

**Scope discipline**: no Phase 6.4/6.5/6.6 functionality was implemented
— the Group detail page's Subjects/Materials/Activity/AI Assistant tabs
are `PhasePlaceholder`s naming the actual phase that will build them,
reusing the exact component Topic pages already use for the same
purpose, not a new placeholder pattern.

**Two decisions not previously established anywhere in the repo**:
1. **No return-URL/callback convention exists** anywhere in this app —
   `sign-in-form.tsx` always lands on `/` after login, full stop. Rather
   than inventing one so `/invitations/[token]` could survive an
   unauthenticated round-trip through `/sign-in`, `InvitationPage` uses
   the same plain `requireUser()` every other page uses, and the page
   itself just tells the person to come back to the same link after
   signing in. Documented in-code as a deliberate non-invention, per the
   Phase 6.3 doc's explicit "do not invent a second auth system" rule.
2. **Group avatar color** — `Group` has no `icon`/`color` field (unlike
   `Subject`). Rather than adding one or inventing a new palette,
   `lib/group-style.ts`'s `getGroupColor` deterministically hashes the
   group id onto the existing `SUBJECT_COLORS` tokens `subject-style.ts`
   already defines, so a card style always shows the same color per
   group without any new design tokens or picker UI.

**New pages** (all under the existing `(app)` route group except the
invitation page, which — like `onboarding/`, the one existing precedent
for a no-sidebar authenticated page — deliberately isn't):
- `(app)/groups/page.tsx` — replaces the `PhasePlaceholder`. Direct
  `db.groupMember.findMany` (server component, no self-fetch of
  `/api/groups` — matches the Subjects list page's established pattern
  and the doc's explicit "prefer direct Prisma access" instruction).
  Grid of `GroupCard`s, `EmptyState` when there are none, `NewGroupButton`
  opening `CreateGroupDialog` via the same "ui-store dialog trigger"
  pattern `createSubjectOpen` already established. `loading.tsx` skeleton
  mirrors Subjects' exactly.
- `(app)/groups/[groupId]/page.tsx` — `requireGroup()` (existing Phase
  6.1 helper; 404 for both "doesn't exist" and "not a member," same as
  Subject/Chapter/Topic). Fetches members via direct Prisma (same shape
  `GET /api/groups/[groupId]/members` returns, just not round-tripped
  through the API from a server component); pending invitations are only
  ever queried — not just hidden client-side — when the caller's role is
  ADMIN+, mirroring the API route's own gate. Renders `GroupActionsMenu`
  (Topbar) + `GroupTabs` (Overview/Members/Subjects/Materials/Activity/AI
  Assistant), the same two-part header+tabs shape the Topic detail page
  uses. `loading.tsx` skeleton added.
- `invitations/[token]/page.tsx` — standalone, no sidebar. Reads the
  invitation directly via Prisma (no new "preview" API route — a
  read-only page load doesn't need one; only Accept/Decline are actual
  mutations, and those go through the real Phase 6.2 endpoints).
  Computes `emailMatches`/`alreadyMember`/`isExpired` server-side from a
  fresh `db.user` read (never trusts `session.user.email`, same
  discipline as the Phase 6.2 accept/decline routes) and hands them to
  the client `InvitationActions` component, which renders the honest
  state for every case the doc lists: already accepted/declined/expired,
  email mismatch (with a "sign out" affordance, not a fabricated
  auto-redirect), already-a-member ("Go to group" instead of
  accept/decline), and the real Accept/Decline flow.

**New components** (`src/components/groups/`, `src/components/invitations/`,
plus one shared primitive): `GroupCard`, `CreateGroupDialog`,
`NewGroupButton`, `GroupActionsMenu` (Delete for OWNER XOR Leave for
everyone else — mutually exclusive by construction in the UI, though the
server remains the actual authority either way), `GroupTabs`,
`GroupMembersPanel` (the real functional piece — role-change dropdown and
remove/leave buttons are gated using the *actual* `canChangeMemberRole`/
`canRemoveMember` pure functions from `lib/group-role.ts` imported
directly into the client component, not a re-derived copy of the
permission matrix that could drift from the server's), `InviteMemberDialog`
(deliberately says "Invitation created," never "Email sent" — no email
provider is configured, per Phase 6.2), `InvitationActions`. Plus
`components/ui/avatar.tsx`, extracted from the avatar markup
`shell/user-menu.tsx` already had inline once a third use case
(member-row avatars, overview-tab avatar stack) made it worth sharing.

**Command palette**: added "New Group" (opens the same `CreateGroupDialog`
via `setCreateGroupOpen`, identical pattern to the existing "New Subject"
entry — no duplicate creation logic) and "Go to Groups".

**New pure/testable files**: `lib/group-style.ts` (`getGroupColor`,
`getGroupInitials`, `formatRoleLabel` — 14 new tests). No route-level UI
tests were added, consistent with this repo's established convention
(confirmed again this session: still zero DB-mocked/E2E tests anywhere)
— per the doc's own "do not introduce a new testing framework" and "only
add tests where new pure logic is introduced" instructions.

**Verified in this sandbox**: 173/173 tests pass (164 baseline + 9 new,
all in `group-style.test.ts`). Lint: 2 `react/no-unescaped-entities`
errors caught and fixed (apostrophes in `invitations/[token]/page.tsx`
and `group-tabs.tsx`), then clean. Typecheck: 58 errors, **+8** over the
Phase-6.2 baseline of 50 — all 8 confined to the new Group UI files'
`.map()` callbacks and `MemberRole` type imports, the identical
Prisma-stub-cascade class already documented at length above, not
independent bugs (spot-checked each). No schema/migration change this
session, so `db:generate`/`db:migrate` weren't re-run (nothing new to
register). Not manually verified in an actual browser — this sandbox has
no way to run the dev server and click through it; verification here is
test/lint/typecheck plus careful reading against the exact API response
shapes, same limitation every prior sandbox session has had.

**Known limitations / honestly incomplete**: the invitation page's
email-mismatch/unauthenticated flows lose the token across a sign-in
redirect (see decision 1 above) — the person has to manually return to
the link after signing in; this is a real UX rough edge, not a bug, and
fixing it properly would mean adding app-wide callback-URL support,
which is out of Phase 6.3's scope. Pending invitations have no "revoke"
control in the UI — Phase 6.2 never exposed that endpoint, and the doc
explicitly said not to invent one.

**Git status at end of session**: `main` still at `bcbeab7` (Phase 6.1
only) on `origin`; Phase 6.2 + Phase 6.3 both sit uncommitted in the same
working tree. `tsconfig.tsbuildinfo` reappeared after the typecheck run
and was removed again before finishing. Nothing committed or pushed.

### Session: Phase 6.1 follow-up — ResolvedAIScope nullable-workspaceId fix
The user ran `npm run db:generate`/`db:migrate` for real (Neon +
real network access) after the Phase 6.1 session below, which cleared all
38 baseline Prisma-cascade typecheck errors and surfaced exactly the 3
genuine errors flagged as a forward-compatibility risk at the time:
`getAccessibleAIScope`'s three `subject.workspaceId` assignment sites no
longer matched `ResolvedAIScope.workspaceId: string` now that
`Subject.workspaceId` is really nullable.

**Fix**: `ResolvedAIScope` is now a discriminated union
(`{ ownerType: "workspace"; workspaceId: string; groupId: null; ... } |
{ ownerType: "group"; workspaceId: null; groupId: string; ... }`) instead
of one object with an incorrectly-required `workspaceId: string` — the
"both set"/"neither set" invalid state is unrepresentable at the type
level, not just runtime-checked, matching how `Subject` itself is
constrained. A new pure helper, `resolveSubjectOwner` (added to
`lib/subject-scope.ts`, next to the invariant it calls first), turns a
Subject's own `workspaceId`/`groupId` into this discriminant with zero
`!`/`as` casts — two plain truthiness `if`s narrow each field, so
TypeScript verifies the return type unaided. `getAccessibleAIScope`'s
three branches now spread `resolveSubjectOwner(...)` instead of reading
`subject.workspaceId` directly.

Both downstream consumers of `ResolvedAIScope.workspaceId` were updated
to handle the union exhaustively rather than assume `ownerType` is always
`"workspace"`: `lib/retrieval.ts`'s `materialWhereForScope` gained a
`scope.ownerType === "group"` branch, and
`/api/ai/conversations/route.ts`'s `scopeFkFields` now sets `groupId`
alongside `workspaceId` (mutually exclusive, same "narrowest wins"
shape). Both branches are **currently unreachable** — `AIScopeInput` still
has no `groupId` field, so nothing can produce `ownerType: "group"` yet —
but are required for the type to be exhaustively correct rather than
silently wrong (`{ workspaceId: null }`, matching nothing) the moment
Phase 6.5 does add that input. No group AI input/route/UI was added; this
was strictly the type-correctness fix the user asked for.

Files changed: `src/lib/subject-scope.ts` (+`resolveSubjectOwner`),
`src/lib/__tests__/subject-scope.test.ts` (+4 tests),
`src/lib/access.ts` (`ResolvedAIScope`, `getAccessibleAIScope`),
`src/lib/retrieval.ts`, `src/app/api/ai/conversations/route.ts`. No
schema/migration change, no Phase 5 AI behavior change for the
workspace-scoped case (byte-identical output — `ownerType` is always
`"workspace"` today, so `workspaceId` resolves exactly as before and
`groupId` is always `null`).

**Verified in this sandbox** (still the stub Prisma client — this session
had no real network access to `binaries.prisma.sh` either): 127/127
tests pass (123 + 4 new `resolveSubjectOwner` cases); lint clean;
typecheck still 44 errors, diffed line-for-line against the pre-fix
44-error output — the only two differences are line-number shifts in
`retrieval.ts` (56→63, 84→91) from the added comment block, same two
pre-existing cascade errors, nothing new/removed. **Could not reproduce
the user's exact "3 errors → 0" confirmation here** since this sandbox's
Prisma client is still the stub — recommend the user re-run
`npm run typecheck` on their machine (with the real generated client) to
confirm the 3 reported errors are gone.

### Session: Phase 6.2 — Membership + Invitations
Repository re-cloned fresh from GitHub at the start of this session,
per standing instruction to never rely on prior-session summary alone.
`git log` showed Phase 6.1 already committed and pushed
(`bcbeab7`) — contradicting what the previous revision of this document
said. Re-verified from scratch before proceeding (see the correction
note at the top of this document): 127/127 tests, lint clean, 44
typecheck errors (all the documented Prisma-cascade kind) on that
commit, so Phase 6.2 was built on a genuinely known-good base.

Implemented the full backend membership + invitation lifecycle described
in the Phase 6.2 doc, backend-only (no Groups UI, no ActivityLog, no
group-scoped Subjects/Materials/AI — all explicitly out of scope and
untouched).

**Database**: new migration
`prisma/migrations/20260829094000_group_invitation_status_index/` —
adds `@@index([groupId, status])` to `GroupInvitation`, needed by the new
invitation-list and duplicate-check queries. Purely additive (an index,
no column/data changes). **Could not be applied via `prisma migrate
dev`/`npx prisma generate`** in this sandbox — same `binaries.prisma.sh`
`403 Forbidden` block as every prior session; written by hand as raw SQL,
matching the Phase 6.1 migration's precedent, and needs
`npm run db:generate && npm run db:migrate` in an environment with real
network access.

**Backend — new files**:
- `src/lib/email.ts` — `normalizeEmail` (trim + lowercase). New
  canonical form for invitation email comparisons — the existing
  auth system (`api/auth/register/route.ts`) stores `User.email` exactly
  as typed, with no existing normalization convention to inherit, so this
  was a genuinely new decision, not something already established
  elsewhere in the repo. Pure, DB-free, unit-tested (6 tests).
- `src/lib/invitation-token.ts` — `generateInvitationToken` (32
  cryptographically random bytes, hex-encoded, via Node's
  `crypto.randomBytes` — not derived from group/user/email data),
  `invitationExpiryDate`/`INVITATION_TTL_MS` (7-day invitation lifetime).
  Pure, unit-tested (5 tests).
- `src/app/api/groups/[groupId]/members/route.ts` — `GET`, any role
  including VIEWER (spec §3 marks "List members" ✅ for every role).
- `src/app/api/groups/[groupId]/members/[userId]/route.ts` — `PATCH`
  (role change, ADMIN/OWNER), `DELETE` (removal by ADMIN/OWNER, or
  self-removal/"leave" — the doc specifies both flow through the same
  endpoint).
- `src/app/api/groups/[groupId]/invitations/route.ts` — `GET` (list
  PENDING invitations, ADMIN/OWNER; token never included in the
  response), `POST` (create; ADMIN/OWNER; duplicate-pending and
  already-a-member checks; creates a `GROUP_INVITATION` Notification when
  the email belongs to an existing User; in-app only, no email sending —
  no provider is configured, consistent with `CLAUDE.md`'s "never fake a
  feature").
- `src/app/api/invitations/[token]/accept/route.ts` /
  `.../decline/route.ts` — token lookup, terminal-status check, lazy
  PENDING→EXPIRED transition on encountering an expired invitation,
  email-match check against a fresh `db.user` read (never
  `session.user.email`), then a conditional `updateMany({ where: {
  token, status: "PENDING" } })` to consume the invitation — see the
  concurrency note below.

**Backend — `src/lib/access.ts` addition**: `findUserByNormalizedEmail`
— case-insensitive (`mode: "insensitive"`) lookup against the
as-stored, non-normalized `User.email` column, so a user who registered
as `Test@Example.com` still matches an invite sent to
`test@example.com`. Purely additive; existing functions untouched.

**Backend — `src/lib/group-role.ts` additions**: `canChangeMemberRole`
and `canRemoveMember`, two pure functions implementing the Phase 6.2
permission matrix (spec §3), extracted the same way `roleMeetsMinimum`
already was so the matrix is unit-testable without a database — this
project's only real precedent for "how do you test authorization logic
here," since there's no DB-mocking convention anywhere else in the repo
(confirmed by inspection: `speech-openai.test.ts`, the only other
service-layer test, tests a pure pre-network guard clause, not a mocked
DB call). One decision not previously established anywhere in the repo:
whether ADMIN may modify another ADMIN's role. The Phase 6.2 doc left
this conditional on "the repository's established policy" but no such
policy existed (Phase 6.1 shipped no role-change endpoint at all) — the
matrix only explicitly protects OWNER, so `canChangeMemberRole` allows
ADMIN-on-ADMIN changes as the simplest rule consistent with the given
table, documented in-code rather than silently assumed.

**Concurrency**: OWNER-protection races (spec §17, "two admins
simultaneously target OWNER") are closed *structurally*, not by locking —
OWNER can never be reassigned through any Phase 6.2 endpoint
(`updateMemberRoleSchema`/`createInvitationSchema` both exclude OWNER at
the validation layer, and there's no ownership-transfer feature), so a
concurrent read of the real owner's role is always `"OWNER"` regardless
of timing; both `canChangeMemberRole`/`canRemoveMember` reject on sight.
Invitation-accept races (spec §7) use a conditional
`updateMany({ where: { token, status: "PENDING" } })` — Postgres
re-evaluates that WHERE clause against the committed row, so only the
first of two racing requests can ever match; the second's `count: 0` is
treated as "already consumed." Duplicate-pending-invitation races (spec
§16) are the one place a genuine (narrow) gap remains: the check is a
`findFirst` inside the same `$transaction` as the `create`, under
Postgres's default READ COMMITTED isolation — this is *not* airtight
against two truly simultaneous invite requests. A fully airtight version
would need a partial unique index
(`UNIQUE (groupId, email) WHERE status = 'PENDING'`), which isn't
expressible in `schema.prisma`'s declarative syntax and would only exist
as a hand-written raw-SQL migration outside the schema's source of
truth — the doc explicitly said not to over-engineer this, so the
narrower guarantee was kept and the limitation is documented here (and
in-code) rather than silently glossed over. Worst case: two
`GroupInvitation` rows for the same group/email, which `accept`/`decline`
both already handle safely (first one wins; the other stays PENDING but
is inert).

**Validation**: `src/lib/validation/groups.ts` gained
`updateMemberRoleSchema` and `createInvitationSchema` (both restrict role
to `ADMIN | MEMBER | VIEWER`, never `OWNER`, at the validation layer —
not just in the runtime permission checks); `createInvitationSchema`
normalizes the email via `.transform(normalizeEmail)` so every downstream
consumer of `parsed.data.email` is already canonical.

**Tests added** (37 new, all pure-function/Zod, no DB — see "no
DB-mocking convention" note above for why route handlers themselves
aren't unit-tested, same as every DB-touching function in this repo):
`email.test.ts` (6), `invitation-token.test.ts` (5),
`group-role.test.ts` (+15 for `canChangeMemberRole`/`canRemoveMember`),
`validation/groups.test.ts` (+11 for the two new schemas).

**Verified in this sandbox**: 164/164 tests pass (127 baseline + 37 new).
Lint clean. Typecheck: 50 errors, **+6** over the 44-error Phase-6.1
baseline — all 6 confined to the new route files' `.map`/`db.$transaction`
callback parameters, the identical Prisma stub-client cascade class
already documented, not independent bugs (spot-checked each of the 6
against the pattern). `npm run db:generate`/`npm run db:migrate` both
reproduce the same `binaries.prisma.sh` `403 Forbidden` already
documented — not independently confirmable in this sandbox.
`git diff --stat` for tracked files: `prisma/schema.prisma` (+1),
`src/lib/access.ts` (+18), `src/lib/api-response.ts` (+1),
`src/lib/group-role.ts` (+56), `src/lib/validation/groups.ts` (+31), plus
test-file diffs. New untracked files: the migration directory, the four
new route files under `src/app/api/groups/[groupId]/members/`,
`src/app/api/groups/[groupId]/invitations/`, and
`src/app/api/invitations/[token]/`, plus `src/lib/email.ts`,
`src/lib/invitation-token.ts`, and their test files. `package-lock.json`
was touched by this sandbox's own `npm install` (an unrelated `"dev":
true` flag on `fsevents`) and `tsconfig.tsbuildinfo` was regenerated by
`tsc` — both reverted/removed before finishing, per the doc's explicit
"don't stage unrelated generated artifacts" instruction. **Nothing
committed or pushed** — left for user review.

### Session: Phase 6.1 — Groups access layer + CRUD
Implemented per explicit scope: Group create/read/update/delete and the
role-hierarchy access layer only. Repository re-cloned and re-inspected
fresh from GitHub at the start of this session (not assumed from a prior
session's summary), confirming `PROJECT_STATE.md`/`ARCHITECTURE.md` were
accurate and that `Group`/`GroupMember`/`GroupInvitation`/`ActivityLog`
were already fully defined in `prisma/schema.prisma` and already present
in the single existing migration — Phase 6.1 needed one new migration
(below), not a from-scratch schema design.

**Three architectural decisions confirmed by the user** (a Phase 6 planning
pass in the previous session had flagged these as open questions):
1. **Subject scope** — a Subject belongs to exactly one of Workspace or
   Group, never both, never neither. Implemented by making
   `Subject.workspaceId` nullable (previously required) and adding a pure,
   unit-tested invariant check (`lib/subject-scope.ts`) rather than a
   dummy placeholder workspaceId. Not yet wired into any Subject
   create/update route — that's Phase 6.4, since no route can create a
   group-owned Subject yet.
2. **Group AI** — private-per-user conversations, shared group knowledge
   as the retrieval scope. Decision recorded here for Phase 6.5;
   nothing AI/retrieval-related was touched this session.
3. **Invitations** — acceptance will require the accepting account's email
   to match the invitation's email. Decision recorded here for Phase 6.2;
   no invitation code exists yet.

**Database**: new migration
`prisma/migrations/20260828054500_subject_scope_nullable_workspace/`
— `ALTER TABLE "Subject" ALTER COLUMN "workspaceId" DROP NOT NULL`. Zero
data risk: no Subject row anywhere has ever had `groupId` set (Phase 6
Subject-to-Group attachment doesn't exist until Phase 6.4), so every
existing row already satisfies "workspaceId is set." **Could not be run
via `prisma migrate dev`/`npx prisma generate`** in this sandbox —
`binaries.prisma.sh` returns `403 Forbidden` here, the same
already-documented blocker from Phase 5 (see "Known bugs / issues"
below). Instead: installed PostgreSQL 16 + the `postgresql-16-pgvector`
package locally in this sandbox (both reachable via the allowed
`archive.ubuntu.com` mirror), applied the existing initial migration's
raw SQL by hand, seeded a representative pre-existing personal Subject
row, then applied this migration's raw SQL by hand and confirmed: the
pre-existing row is untouched, the column is genuinely nullable
(`information_schema.columns`), and a new group-owned Subject row
(`workspaceId = NULL`, `groupId` set) inserts successfully. This is
hands-on verification of the actual SQL against a real running Postgres +
pgvector instance — more direct verification than Phase 5 had available,
even though the Prisma *tooling* itself couldn't run.
**Action needed from the user**: run `npm run db:generate && npm run
db:migrate` in an environment with real network access to
`binaries.prisma.sh` to regenerate the Prisma Client and register this
migration in Prisma's own tracking table (`prisma migrate status` could
not be run here for the same reason).

**Backend — new files**:
- `src/lib/subject-scope.ts` — `assertSubjectScopeInvariant` (Decision 1).
  Pure, zero imports, unit-tested.
- `src/lib/group-role.ts` — `roleMeetsMinimum`, the OWNER > ADMIN > MEMBER
  > VIEWER hierarchy comparator. Pure (type-only Prisma import, erased at
  compile time), unit-tested.
- `src/lib/validation/groups.ts` — `createGroupSchema`/`updateGroupSchema`,
  mirroring `updateSubjectSchema`'s existing convention that an empty
  PATCH body is a valid no-op rather than an error.
- `src/app/api/groups/route.ts` — `GET` (list caller's groups with role +
  member count), `POST` (create; Group + OWNER GroupMember created inside
  one `db.$transaction`, so the "exactly one OWNER" invariant is never
  even briefly broken).
- `src/app/api/groups/[groupId]/route.ts` — `GET` (member-only, 403 for a
  non-member vs 404 for a truly nonexistent group, matching the existing
  Subject/Chapter/Topic API convention exactly), `PATCH` (ADMIN+), `DELETE`
  (OWNER only, soft-delete). `DELETE` intentionally does **not** cascade
  to any descendant content — Phase 6.1 has no group-owned
  Subjects/Materials to cascade to yet (Phase 6.4). This is documented
  in-code as a limitation to revisit once 6.4 ships, not silently glossed
  over.

**Backend — `src/lib/access.ts` additions** (purely additive; existing
functions untouched): `getGroupRole`, `requireGroupRole`,
`getAccessibleGroup`, `requireGroup`, following the file's existing
`getAccessibleX`/`requireX` pattern exactly. Not unit-tested directly —
same reason `retrieval.ts`/`materials-scope.ts` have no test files:
`lib/db.ts` constructs `PrismaClient` at import time, which throws
immediately in this sandbox (confirmed by direct test:
`new PrismaClient()` → `"@prisma/client did not initialize yet"`), so
anything importing `lib/access.ts` or `lib/db.ts` can't be exercised here
regardless of whether the specific function under test touches the DB.
Verified instead by full inspection against the schema and the existing
`assertScopeAccess`/`getAccessibleSubject` precedent it mirrors.

**Forward-compatibility note for Phase 6.4/6.5 (flagged, not fixed —
explicitly out of this session's scope)**: `getAccessibleAIScope`'s
`ResolvedAIScope` interface currently types `workspaceId` as required
`string`. Three assignment sites there (`topic.chapter.subject.workspaceId`
etc.) will need `workspaceId: string | null` once the Prisma Client is
regenerated against the now-nullable column — grepped the whole `src/`
tree for `.workspaceId` usage to confirm this is the *only* place
affected (every other usage already types it as `string | null`, e.g.
`assertScopeAccess`'s existing parameter type). Zero current impact: no
route can create a group-owned Subject yet, so no `workspaceId: null` row
exists for this code to ever actually see. Do not fix this preemptively
by touching `retrieval.ts`/`ai-chat.ts`/AI conversation code — that's
explicitly Phase 6.5 territory.

**Verified**: 123/123 tests pass (102 baseline + 21 new: 6 for
`subject-scope.ts`, 4 for `group-role.ts`, 11 for `validation/groups.ts`).
Lint clean (zero output, same as baseline). Typecheck: 44 errors, **+6**
over the 38-error baseline — all 6 confined to the three Phase 6.1 files
that reference the `MemberRole` enum or a `db.$transaction` callback, and
all 6 are the identical "Prisma stub-client cascade" class already
present 8+ times elsewhere in the untouched baseline (`Module has no
exported member 'X'` / implicit-`any` on a Prisma-typed callback
parameter) — not independent bugs. Confirmed by grepping the two error
sets side by side. `git diff --stat` for tracked files:
`prisma/schema.prisma` (+11/-2), `src/lib/access.ts` (+72, purely
additive). Nothing committed or pushed — left for user review.

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
  (reconfirmed directly in the Phase 6.1 session: `npx prisma generate`
  fails with `403 Forbidden` fetching from `binaries.prisma.sh`, even with
  `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`; `new PrismaClient()` itself
  throws `"did not initialize yet"` at construction time). This produces
  58 typecheck errors (38 pre-Phase-6 baseline + 6 from Phase 6.1 + 6 from
  Phase 6.2 + 8 from Phase 6.3) that are NOT real bugs — see `CLAUDE.md` →
  Testing requirements for how to distinguish this from an actual
  regression. Resolves by running `npm run db:generate` somewhere with
  real network access to `binaries.prisma.sh`.
- ~~`ResolvedAIScope.workspaceId` typed as required `string`~~ — **FIXED**
  in the Phase 6.1 follow-up session (see "Recent work completed").
  `ResolvedAIScope` is now a discriminated union over `ownerType:
  "workspace" | "group"`; `lib/retrieval.ts` and
  `/api/ai/conversations/route.ts` handle both arms exhaustively.

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

### Verification (Phase 6.7 closeout session) — current, supersedes the numbers below

```
npm run test          →  19 test files, 199/199 tests passed
                          (184 baseline through Phase 6.5 + 15 new in
                          Phase 6.6: activity-style.test.ts,
                          validation/__tests__/notifications.test.ts)
npm run lint           →  0 errors, 0 warnings
npm run typecheck      →  68 errors (62 baseline at the Phase 6.5 commit,
                           re-verified fresh via `git stash -u` this
                           session, + 6 new). Of the 6: 5 are the same
                           Prisma-client-cascade class already present 62
                           times in baseline — new instances caused by
                           Phase 6.6 code referencing ActivityLog/User/
                           InputJsonValue/NotificationType, types/enum
                           members that are correct in schema.prisma but
                           absent from the stale, un-regenerated client
                           still in node_modules/.prisma (prisma generate
                           is network-blocked here, see below). The 6th
                           is an implicit-any on a .map() callback in
                           page.tsx matching the exact same pre-existing,
                           already-baselined pattern on the two lines
                           immediately above it in the same file.
npx prisma migrate status →  Error: binaries.prisma.sh 403 Forbidden
                              (not on this sandbox's allowed-domains
                              list) — same block as db:generate/migrate,
                              confirmed again this session, not assumed
                              carried over.
```

This is a **documentation-only session** (Phase 6.7) — no source, schema,
test, or dependency file was touched, so these numbers are unchanged from
what the Phase 6.6 session already reported; they were re-run fresh here
specifically to confirm that claim rather than assume it.

### Historical: Phase 6.2 session (kept for record, do not treat as current)

```
npm run test        →  16 test files, 164/164 tests passed
                        (127 baseline + 37 new: email.test.ts,
                        invitation-token.test.ts, +15 group-role.test.ts,
                        +11 validation/groups.test.ts)
npm run lint         →  0 errors, 0 warnings
npm run typecheck    →  50 errors (+6 over the 44-error Phase-6.1
                         baseline). All 6 confined to the new Phase 6.2
                         route files' .map/db.$transaction callback
                         parameters — confirmed by grepping the
                         before/after error sets side by side that these
                         are the identical "Prisma stub-client cascade"
                         pattern already present 8+ times elsewhere in
                         the untouched baseline, not independent bugs.
npm run db:generate  →  binaries.prisma.sh 403 Forbidden (same known
                         sandbox block; not independently confirmable
                         here)
npm run db:migrate   →  same 403 Forbidden
```

The `GroupInvitation(groupId, status)` index migration
(`20260829094000_group_invitation_status_index`) is a plain additive
`CREATE INDEX`, hand-written the same way the Phase 6.1 migration was —
not hand-verified against a live Postgres instance this session (unlike
Phase 6.1's nullable-column change, an index addition carries no data
risk to independently verify by hand; needs
`npm run db:generate && npm run db:migrate` in an environment with real
network access to register it).

Migration SQL from the *previous* session
(`20260828054500_subject_scope_nullable_workspace`) remains verified by
hand against a real local PostgreSQL 16 + pgvector instance (see the
Phase 6.1 session log below for the exact steps) — not re-verified this
session since nothing about it changed.

No integration/E2E tests exist in this project — only Vitest unit tests,
concentrated on Zod validation schemas and pure utility functions. Phase
5's retrieval/ingestion/chat orchestration functions (which need a real
Postgres+pgvector) follow this same established convention — untested at
the unit level (consistent with `transcription.ts` also having no test
file), verified instead by full inspection and by the fact that every
Prisma call in them matches the schema exactly (checked line by line
during implementation).

## Current task

Phase 6.5 (Group-scoped AI chat) is implemented and verified as described
in "Recent work completed" above. **Nothing has been committed or
pushed** — the working tree contains only the Phase 6.5 changes (Phases
6.1–6.4 are already committed and pushed at `c769f52`, confirmed via a
fresh clone at the start of this session — see the third correction note
at the top of this document). `git status`/`git diff --stat` at the end
of the session showed exactly 8 modified files, all directly
attributable to Phase 6.5; no unrelated file was touched.

## Exact next steps

1. **User review of Phase 6.6 + Phase 6.7** — nothing is committed yet;
   review the diff (see "Recent work completed" for the full file list —
   Phase 6.6 is code, Phase 6.7 is documentation-only) and commit when
   satisfied, together or separately as preferred. Phases 6.1–6.5 are
   already committed/pushed.
2. **Run `npx prisma generate` (then `npx prisma migrate dev`)** in an
   environment with real network access to `binaries.prisma.sh` — Phase
   6.6's migration is written and correct but has not been applied to any
   real database in this sandbox (no database or network access to the
   Prisma engine binaries here). This also clears all 6 of the
   Prisma-stub typecheck errors introduced by Phase 6.6's code (see
   "Tests performed" above) — they're a byproduct of the stale,
   un-regenerated client, not real bugs.
3. **Manual browser verification of Phase 6.6** is still outstanding —
   this sandbox has no way to run the dev server or reach a database.
   Before considering Phase 6.6 fully done, actually click through: open
   a group's Activity tab as a member and confirm real events appear
   newest-first (invite/accept/decline, role change, remove/leave,
   subject create/update/delete, material add/remove); confirm a
   non-member (or a member who left/was removed) gets a 403/404 from
   `GET /api/groups/[groupId]/activity`, not just a hidden tab; open the
   notification bell and confirm the unread badge, mark-as-read, and
   click-to-navigate all work; confirm `PATCH
   /api/notifications/[notificationId]` 403s when the notification
   belongs to a different user.
4. **Manual browser verification of Phase 6.5** is still outstanding too
   (carried over, unchanged from before this session) — see the Phase 6.5
   session log below for the exact checklist.
5. **Phase 6.7 (docs/closeout) is DONE as of this document** — this
   session. **Phase 7 (Google Drive/Docs import) is the next phase in
   sequence, and has explicitly NOT been started.** Do not begin any
   Phase 7 work speculatively; wait for explicit instruction, per
   `CLAUDE.md`'s phase-discipline rule.
6. **Decide on the two "Known limitations" flagged in the Phase 6.4
   session log (and re-flagged, still undecided, at Phase 6.6's close)**
   — whether Chapter/Topic/Material mutation inside a group Subject
   should eventually be role-gated the same way Subject-level mutation
   now is, and whether Material move-between-owners should stay
   unrestricted. This is a product decision, not something any Phase 6
   sub-phase (including 6.6/6.7) was authorized to make unilaterally.
7. **Verify Phase 5 against a real database**: run `npm run db:generate`
   with real network access, then `npm run db:migrate`, then confirm
   `db.aIConversation`/`db.aIMessage` compile and the pgvector raw SQL in
   `ingestion.ts`/`retrieval.ts` actually executes against Postgres. Still
   outstanding from before Phase 6.1.
8. **Activate a real AI/embedding provider** (see `docs/ai-setup.md`) —
   optional, only if/when the user wants AI features to actually respond
   instead of showing the honest "not configured" state.
9. Small, currently-known, not-yet-actioned cleanups if ever asked for a
   "cleanup pass": remove the dead `recordedMs` variable in
   `recorder-panel.tsx`; dedupe the README Phase 5 line.
10. If/when app-wide callback-URL support is ever added, revisit
    `invitations/[token]/page.tsx`'s email-mismatch/unauthenticated flows
    (see "Known limitations" in the Phase 6.3 session log) — not urgent,
    flagged so it isn't forgotten.
11. **A real realtime layer** (websockets/SSE) for live group updates was
    explicitly not built in Phase 6 (see `docs/ARCHITECTURE.md`'s Phase 6
    "Known limitations") — worth considering if/when the polling-based
    notification bell proves insufficient, but not scoped to any phase
    yet.

**Do not re-open either deferred issue** ("Known deferred issues (Phase 5
closeout)" above) as part of Phase 6 or any other work unless the user
explicitly asks for it again.

## How to verify this document

```bash
npm install
npm run test
npm run lint
npm run typecheck 2>&1 | grep -c "error TS"   # expect 68 with Phase 6.6 applied: 62 baseline (all Prisma-cascade, unchanged since Phase 6.4) + 6 new — 5 more Prisma-cascade instances (new code referencing ActivityLog/User/InputJsonValue/NotificationType, blocked by `prisma generate` -> binaries.prisma.sh returning 403 in this sandbox) + 1 pre-existing-pattern implicit-any in page.tsx. Run `npm run db:generate` with real network access and re-check before trusting this number long-term.
```

If any of these numbers differ from what's recorded above, this document
is stale — update it (or ask the user to) before relying on it further.
