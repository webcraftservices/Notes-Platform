# Production Readiness Audit — Phase 9.6

Evidence-driven audit against the actual code at checkpoint `aaf3804`
(fresh clone, clean `git status`). Findings only — no speculative
hardening. Phases 9.1–9.5 (security hardening, Datadog observability,
security boundary, reliability, performance) are treated as already
correct and are not redesigned here; this pass verifies they still hold
and fills the concrete operational gaps that remained.

## Summary of changes

| Finding | Severity | Change |
|---|---|---|
| `tsconfig.tsbuildinfo` (a generated TypeScript incremental-build artifact) was accidentally committed in commit `55210db` and has stayed tracked ever since — `.gitignore` lists it, but an ignore rule doesn't untrack a file already in the index, so every `tsc` run keeps producing local diff noise against a committed binary-ish file | P1 | `git rm --cached tsconfig.tsbuildinfo` — untracked only; the local file and the `.gitignore` entry are both left in place, so future builds are unaffected |
| No operational runbook existed for database/storage backup, restore, or secret recovery — `README.md` covers first-run setup only, and `ARCHITECTURE.md`'s "restore" references are all in-app version-history/soft-delete features, not infrastructure backups | P2 | This document |

Everything else audited below was found **not** to need a change, with
the evidence for that conclusion.

---

## A. Repository / baseline state

- `git log --oneline -10` confirms `HEAD` is `aaf3804 perf: optimize
  production runtime and storage access`, matching the expected Phase 9.5
  checkpoint. `git status --short` was clean on a fresh clone.
- `npm test` (Vitest): 81 test files, 821 passed, 4 skipped — the same
  pre-existing skip set documented in `PROJECT_STATE.md`/`CLAUDE.md`
  (native `require()` of aliased `.ts` paths fails at Vitest test time in
  provider registries).
- `npm run lint` (ESLint): 0 errors.
- `npm run typecheck` (`tsc --noEmit`): every single error is one of two
  known, pre-existing patterns — either the `@prisma/client`-generation
  cascade (`TS2305`/`TS2694`, "no exported member" on Prisma model/enum
  types, `Prisma.InputJsonValue`, `Prisma.DbNull`, etc. — resolved by a
  real `prisma generate`, which this sandbox cannot run) or the three
  specific lines already named as historical in this project's memory
  (`study-progress.test.ts:150,215`, `study-progress.ts:110`). No new
  error shapes appeared.
- `npm run db:generate`: fails with `403 Forbidden` fetching the Prisma
  engine checksum from `binaries.prisma.sh` — this sandbox's network
  allowlist has no route to that host. Documented sandbox limitation, not
  a code defect; works in any environment with normal network egress.
- `npm run build`: fails during the Google Fonts fetch step in
  `app/layout.tsx` (`next/font/google` resolving `fonts.googleapis.com`)
  — same pre-existing, unrelated, network-allowlist limitation recorded
  against every prior phase since Phase 8.4. Never reached the point of
  exercising application build logic.

None of the above are Phase 9.6 regressions; all match previously
documented, environment-specific sandbox constraints.

## B. Environment variable / startup safety

Audited every `process.env.*` read under `src/lib` that participates in
security- or availability-critical behavior:

- `lib/crypto.ts` (Google OAuth token encryption): requires
  `GOOGLE_TOKEN_ENCRYPTION_KEY` or falls back to `NEXTAUTH_SECRET`; throws
  immediately if neither is set. No insecure default key.
- `lib/auth.ts`: `secret: process.env.NEXTAUTH_SECRET` — NextAuth's own
  documented behavior is to hard-fail at request time in production when
  unset, and `checkRequiredConfig()` in `/api/health` independently
  reports `"misconfigured"` (503) for exactly this case outside of
  development, so a missing secret cannot silently serve requests.
- `lib/db.ts`: relies on Prisma's own `DATABASE_URL`-missing failure
  (immediate connection error), no silent fallback.
- Optional integrations (Redis, S3 vs. local storage, AI provider,
  transcription provider, Google OAuth) all have documented
  not-configured states that degrade functionality rather than crashing
  the process — verified against `/api/health`'s three-state model
  (`ok` / `degraded` / `error`) below.

## C. Health / readiness endpoints

`GET /api/health` (readiness) and `GET /api/health/live` (liveness) were
re-read in full.

- `dynamic = "force-dynamic"` is set on both, so Next 14 evaluates them
  per-request rather than serving a build-time snapshot — correct for a
  readiness probe.
- Each dependency check (`database`, `redis`, `storage`, `ai`) is wrapped
  or is inherently non-blocking; the database check has an explicit
  3-second timeout via `withTimeout`, so a hung database cannot hang the
  probe itself.
- Status semantics are: `error`/503 only for the database (the one
  dependency nothing works without) or missing required production
  config; `degraded`/200 for a configured-but-unreachable Redis or
  misconfigured storage; `ok`/200 otherwise. This is a correct
  load-balancer-usable contract — an orchestrator won't cycle a healthy
  instance over a non-critical dependency blip.
- The response body only ever contains fixed enum-like strings
  (`"connected"`, `"unreachable"`, `"not_configured"`, `"s3"`, `"local"`,
  `"misconfigured"`, `"configured"`) — no credentials, connection
  strings, env var names, or stack traces are exposed, and the route is
  unauthenticated by design (verified no secret leakage path exists).
- `/api/health/live` touches no dependency at all, so a database or Redis
  outage can never cause an orchestrator to restart an otherwise-healthy
  process.

No change needed — this was already correctly implemented in Phase 9.4.

## D. Error response / logging privacy

`lib/api-response.ts`'s `logServerError` and `INTERNAL_ERROR` were
re-read in full: the client always receives a fixed generic message
(never the caught error's own `.message`, which could contain stack
details, file paths, or provider/DB internals); the server-side log line
carries only `err.message` (not the stack) plus caller-supplied safe
context, and is forwarded to Datadog fire-and-forget (`sendDatadogLog`
never throws/rejects, and the call site additionally defends with
`.catch(() => {})`). This matches the Phase 9.1–9.2 design and needed no
change.

## E. Migration safety

`prisma/migrations/` contains 10 applied migrations. One (
`20260912100000_learning_system_foundation`) drops three columns from
`Flashcard` (`timesReviewed`, `timesCorrect`, `nextReviewAt`) as part of
moving per-user review state onto the dedicated `FlashcardReview` table —
this is a historical, already-applied migration from the Phase 8.6-era
schema change, not something introduced or touched by this phase. Per
this phase's explicit rule, historical migrations are not rewritten.
No new migration was required for any Phase 9.6 finding.

## F. Git hygiene / secret exposure

- `.gitignore` covers `.env`, `.env.local`, `.env*.local`, `node_modules`,
  `.next`, build output, and `.storage/`.
- `git log --all --full-history -- .env .env.local` returns no history —
  no real secret file has ever been committed.
- `.env.example` contains only variable names (`DATABASE_URL=`,
  `NEXTAUTH_SECRET=`, etc.), no values.
- `tsconfig.tsbuildinfo` was found tracked despite being gitignored (see
  Finding table above) — fixed by untracking only.

---

## Operational runbook (new — Finding P2)

This section is the concrete gap identified in §17 of the Phase 9.6
scope: none of the existing docs described how an operator restores this
application's state after data loss. It documents what to configure and
verify; it does not implement a specific backup provider, since none is
mandated by the current architecture.

### PostgreSQL (primary data store)

- The application has no built-in backup mechanism — this is the
  responsibility of whichever managed Postgres provider hosts
  `DATABASE_URL` (e.g. point-in-time recovery / automated daily snapshots
  on a managed provider, or `pg_dump`/WAL archiving on a self-managed
  instance).
- Before restoring a snapshot, confirm the target Postgres has the
  `vector` extension available (`CREATE EXTENSION IF NOT EXISTS vector;`
  — see `README.md`'s quick start) — a restore onto a fresh instance
  without this extension will fail on any table/index touching
  `Embedding`.
- After restoring, run `npx prisma migrate deploy` (not `migrate dev`) to
  confirm the restored schema matches `prisma/migrations/` history before
  serving traffic; `migrate deploy` is non-interactive and safe for this
  use and does not attempt to generate new migrations.

### Object storage (materials, audio, generated files)

- Governed by `STORAGE_PROVIDER` (`local` or `s3`, see `.env.example`).
  In `local` mode, files live under the path configured by
  `STORAGE_LOCAL_DIR` — this directory is not covered by any database
  backup and must be backed up separately (or avoided in production,
  where `s3` mode is expected).
- In `s3` mode, enable the bucket's own versioning/replication as
  provided by the storage vendor; the application has no
  application-level object backup and relies entirely on the bucket's
  durability guarantees.
- There is no automated reconciliation between a restored database and a
  restored bucket — a Postgres restore to an earlier point in time than
  the object store (or vice versa) will leave `Material` rows pointing at
  missing or renamed keys. Restore both stores to the same point in time
  where possible.

### Environment secrets

- `NEXTAUTH_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` (or its
  `NEXTAUTH_SECRET` fallback — see §B above), and all provider API keys
  are supplied purely via environment variables and are never persisted
  to the database or object storage. Recovering them after loss means
  re-provisioning them at the hosting platform's secret-configuration
  layer — there is nothing to "restore" from this repository or its
  data stores.
- Rotating `GOOGLE_TOKEN_ENCRYPTION_KEY`/`NEXTAUTH_SECRET` invalidates
  every previously `encryptSecret`-encrypted `ConnectedAccount` token
  (`lib/crypto.ts`); affected users will need to reconnect Google Drive
  after a rotation.

### Prisma migration recovery

- Migration history is append-only under `prisma/migrations/`; there is
  no destructive-migration rollback tooling in this repository. Reverting
  a bad migration in production means writing and applying a new,
  forward-only migration that undoes the change — never editing or
  deleting an already-applied migration directory.

### Minimum smoke-test checklist after any restore or deploy

Sign-in → workspace/dashboard load → open a Subject → open a Chapter →
open a Topic and confirm its Notes render → upload one Material and
confirm it reaches `READY` → open the AI Chat panel on a Topic with
existing indexed content and confirm a cited answer → `GET /api/health`
returns `"ok"` (or an understood `"degraded"` reason) → `GET
/api/health/live` returns `"alive"`.
