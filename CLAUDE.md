# CLAUDE.md — Permanent Project Rules

Read this before making ANY change to this repository. It documents rules
that don't change phase-to-phase. For "what exists right now," read
`PROJECT_STATE.md`. For "how it's built," read `ARCHITECTURE.md`.

This file does not restate the master build prompt. It records the rules
that have emerged from actually building against it, including several
learned the hard way (see "Mistakes already made" below).

---

## The one rule everything else follows from

**Never fake a feature.** If a provider isn't configured, a service isn't
implemented yet, or content can't be understood/rendered, say so honestly
in the UI (a real empty state, a real "arrives in Phase N" label, a real
configuration error) — never a fabricated result, a silent no-op dressed
up as success, or invented data. This applies to AI output, transcription,
progress percentages, file previews, and everything else. When in doubt,
under-claim.

## Do not rebuild or "improve" working systems without being asked

This codebase has already been through multiple real debugging rounds
(see `PROJECT_STATE.md` → "Failed approaches / already-fixed issues").
Before touching a file, check whether the thing you're about to "fix" is
actually already correct and just unfamiliar. Concretely, do not:

- Rewrite `audio-player.tsx`'s rAF/transform-based progress animation.
  It is intentionally NOT using CSS transitions, NOT using React state
  for per-frame updates, and NOT using `setInterval`. This was arrived
  at after two rounds of debugging a real visual-stepping bug. If asked
  to touch it again, inspect first, form a specific hypothesis, and
  change only what the hypothesis requires — see the two prior fixes in
  `PROJECT_STATE.md` as the model for how to do this.
- Remove or "simplify" `webm-duration-fix` in `recorder-panel.tsx`. It
  fixes a real, specific bug (`MediaRecorder` WebM output has no duration
  metadata, so `audio.duration` is `Infinity` until patched).
- Remove the MIME-type normalization in `lib/mime.ts` (stripping
  `;codecs=...` params before matching). Browser-reported recorder MIME
  types include codec params; matching the raw string caused valid audio
  recordings to be silently rejected as an unsupported type.
- Change the storage-read proxy behavior for non-local backends (see
  `ARCHITECTURE.md` → Storage) without understanding why it exists: it's
  there specifically to avoid browser CORS failures against S3-style
  object storage for `<audio>`/`<video>` playback.
- Re-architect the `ProcessingJob` fire-and-forget execution model into a
  "proper queue" unless actually asked to. It's a documented, deliberate
  trade-off (see `ARCHITECTURE.md` → Audio/Transcription), not an
  oversight.

If you genuinely believe one of these needs to change, say so explicitly,
explain why the existing rationale no longer holds, and get confirmation
before proceeding — don't just silently replace it.

## AI/embedding provider constraints (permanent)

- **`MaterialChunk.embedding` is a pgvector `vector(1536)` column,
  migrated in Phase 1 before any AI/embedding provider was chosen.** Any
  `EmbeddingService` implementation MUST produce exactly 1536-dimensional
  vectors. This is not a registry-level swap decision — a provider that
  produces a different size requires a deliberate schema migration
  (change the column type, re-embed every existing chunk). See
  `docs/ai-setup.md` before implementing any concrete `EmbeddingService`.
- **Phase 5 was built explicitly provider-free**: no AI/embedding SDK
  dependency, no API key, `getAIService()`/`getEmbeddingService()` always
  throw `ServiceNotConfiguredError`. Adding a real provider later is
  expected and fine — follow the existing `speech.ts`/`storage.ts`
  registry pattern exactly (see `docs/ai-setup.md`) — but don't silently
  reach for a shortcut (e.g. calling a provider SDK directly from a route
  handler, bypassing the interface) just to get AI chat "working."

## Phase discipline

The project is built in the phases defined by the master prompt (Phase 1
through Phase 9). **Do not implement functionality from a later phase
while working on an earlier one, even if it would be convenient or "while
I'm in here anyway."** Check `PROJECT_STATE.md` for the current phase
before adding anything. If a task implies later-phase work (e.g., AI note
generation, RAG, group collaboration), flag that explicitly rather than
quietly building a partial version of it.

## Coding conventions actually in use

- **TypeScript strict mode**, including `noUncheckedIndexedAccess`. Any
  `Record<K, V>` accessed via a computed (non-literal) key returns
  `V | undefined` at the type level even if the record is exhaustively
  populated — this has caused real bugs before (see `PROJECT_STATE.md`).
  Prefer a small accessor function with an explicit fallback over raw
  bracket access on lookup tables.
- **Route handlers** (`src/app/api/**/route.ts`) always: get the session
  user via `getSessionUser()` (never assume auth from middleware alone —
  most API routes are NOT in `middleware.ts`'s matcher and self-protect),
  validate the body with a Zod schema from `lib/validation/`, resolve
  access via the matching `getAccessible*`/`requireX` helper in
  `lib/access.ts`, and return errors via the shared helpers in
  `lib/api-response.ts` (`jsonError`, `zodError`, `UNAUTHORIZED`,
  `FORBIDDEN`, `NOT_FOUND`) — never a raw `NextResponse.json({error...})`
  inline.
- **Server components** use `requireUser()` (redirects to `/sign-in`) and
  `requireSubject`/`requireChapter`/`requireTopic`/`requireMaterial`
  (call `notFound()` on missing-or-unauthorized — deliberately the same
  response for both, so existence isn't leaked to unauthorized users).
- **Every new Prisma model access pattern goes through `lib/access.ts`**,
  never an ad hoc `where` clause written inline in a route or page. If the
  resource type you need isn't in `access.ts` yet, add a function there
  following the existing `getAccessibleX`/`requireX` pair pattern.
- **Service abstractions live in `lib/services/`** behind an interface
  (`interfaces.ts`) and a registry function (`getStorageService()`,
  `getSpeechService()`) that throws `ServiceNotConfiguredError` — never
  returns a stub that pretends to work — when required env vars are
  absent. New AI/processing providers (Phase 5+) must follow this same
  pattern: interface + concrete implementation file(s) + registry.
- **Design tokens are in `tailwind.config.js`** (see the `paper`/`ink`/
  `graphite`/`accent` color scale and the amber "highlighter" accent used
  only for AI-flagged importance). Don't introduce ad hoc colors; extend
  the token set if a new semantic color is genuinely needed.
- **UI primitives live in `components/ui/`** (Button, Dialog,
  DropdownMenu, Tabs, Input, Textarea, Badge, Skeleton, EmptyState,
  ConfirmDialog). Reuse them; don't build one-off buttons/dialogs/badges
  in feature components.
- **Client vs. server**: default to server components for data fetching;
  mark `"use client"` only where interactivity is actually needed
  (forms, dialogs, anything with `useState`/`useEffect`/refs).

## Testing requirements

- Test runner is **Vitest**. Tests live in `__tests__/` folders next to
  the code they cover (not a separate top-level `tests/` tree).
- **Every new Zod validation schema needs tests** — this project has 100%
  coverage of its validation schemas by count of schema files, and that
  should not regress.
- **Pure functions (formatting, MIME resolution, size-limit guards, etc.)
  should be tested directly**, especially anything that can be tested
  without network/DB access — e.g. `speech-openai.test.ts` tests the
  Whisper 25MB guard without hitting the network, because the check runs
  before any `fetch` call. Look for this pattern before assuming
  something can't be tested.
- **Before considering any change done, run all three:**
  ```bash
  npm run test        # vitest run
  npm run lint         # eslint
  npm run typecheck    # tsc --noEmit
  ```
- **Typecheck currently has ~38 pre-existing errors — this is expected,
  not a regression to fix.** They all stem from `@prisma/client` not
  having been generated in whatever sandbox last ran `tsc` (no network
  route to `binaries.prisma.sh` in that environment) — every single one
  is either `Module '"@prisma/client"' has no exported member 'X'` or an
  implicit-`any` parameter cascading from that. Before treating a
  typecheck error as new, run `npx tsc --noEmit` and diff against this
  baseline; if the error references a Prisma-generated type/enum/model or
  is an implicit-any parameter whose type traces back to a Prisma query
  result, it's the same known issue. **In a real dev environment, run
  `npm run db:generate` first — this makes the cascade disappear.**
- Never claim "tests pass" or "lint is clean" without having actually run
  the commands in this session and read the output.

## Environment / secrets

- All configuration goes through `.env.local`, documented in
  `.env.example`. Never hardcode an API key, connection string, or
  bucket name anywhere in source.
- Every optional provider (storage backend, speech provider, future AI
  provider) must have a working "unconfigured" path — the app itself,
  and everything not depending on that specific provider, must run and
  be usable with zero provider keys set. Local dev should never require
  a paid API key just to `npm run dev`.

## Documentation upkeep

When you finish a unit of work, update `PROJECT_STATE.md` — not as an
afterthought, as part of the work. A session that ships code but leaves
`PROJECT_STATE.md` stale has left the next session worse off than if it
had documented nothing. `ARCHITECTURE.md` and this file only need
updates when something structural actually changes (new service, new
architectural decision, a rule gets superseded) — most sessions should
touch `PROJECT_STATE.md` only.
