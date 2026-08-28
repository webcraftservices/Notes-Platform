# Knowledge Platform

AI-powered notes, lecture intelligence & collaborative knowledge platform.
Built in phases — see `docs/ARCHITECTURE.md` for the full roadmap and
`docs/ARCHITECTURE.md#phase-1-verification-checklist` to confirm this phase
works before moving on.

**Phase 1 of 9 — Architecture, database, and authentication.**

## Prerequisites

- Node.js 18.18+
- PostgreSQL 15+ with the [`pgvector`](https://github.com/pgvector/pgvector) extension installed
- A Google Cloud OAuth client (optional for Phase 1 — email/password works without it)

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# edit .env.local: at minimum set DATABASE_URL and NEXTAUTH_SECRET
#   generate a secret with: openssl rand -base64 32

# 3. Create the database (if it doesn't exist) and enable pgvector
#    Connect with psql and run:
#      CREATE EXTENSION IF NOT EXISTS vector;

# 4. Run migrations
npm run db:migrate

# 5. Seed a demo account
npm run db:seed
# creates demo@example.com / Password123, already onboarded, with two
# sample subjects (Physics, Calculus) so the dashboard isn't empty on
# first look

# 6. Create a local storage directory for uploaded files (auto-created on
#    first upload too, but doesn't hurt to do it up front)
mkdir -p .storage

# 7. Start the dev server
npm run dev
```

Visit `http://localhost:3000` — you'll be redirected to `/sign-in`. Sign in
with the seeded account (lands straight on the dashboard) or create a new
one (walks through onboarding first).

Uploaded files land on disk under `.storage/` by default (gitignored) —
zero setup needed for local development. See `.env.example` for switching
to S3-compatible storage.

## Speech-to-text setup (optional for Phase 4)

Recording and uploading audio always works. Transcription needs one
provider configured in `.env.local`:

```bash
SPEECH_PROVIDER="assemblyai"     # recommended — real speaker diarization
ASSEMBLYAI_API_KEY="..."          # https://www.assemblyai.com/
```

or

```bash
SPEECH_PROVIDER="openai"
OPENAI_API_KEY="..."              # capped at 25MB per file (~an hour of speech)
```

Without either set, clicking "Transcribe" fails immediately with a clear
configuration error — it never fakes a transcript.

## Google OAuth setup (optional for Phase 1)

1. In the [Google Cloud Console](https://console.cloud.google.com/), create
   an OAuth 2.0 Client ID (Web application).
2. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
   (add your production URL later too).
3. Copy the Client ID/Secret into `.env.local` as `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`.

Drive/Docs file-access scopes (Phase 7) are a separate, later consent step
— this OAuth client is only used for sign-in during Phase 1–6.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm run start` | Production build/serve |
| `npm run db:migrate` | Apply Prisma migrations (dev) |
| `npm run db:migrate:deploy` | Apply migrations (production) |
| `npm run db:studio` | Prisma's DB browser GUI |
| `npm run db:seed` | Seed demo data |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |

## Project docs

- `docs/ARCHITECTURE.md` — stack decisions, multi-tenancy model, folder
  structure, full 9-phase roadmap, and the Phase 1 verification checklist.
- `.env.example` — every environment variable used across all 9 phases,
  with notes on which phase activates each one.

## Status

- [x] Phase 1 — Architecture, database, authentication
- [x] Phase 2 — Dashboard + Subject/Chapter/Topic system
- [x] Phase 3 — Notes editor + materials
- [x] Phase 4 — Audio recording + transcription
- [x] Phase 5 — AI notes + RAG + AI chat
- [ ] Phase 6 — Groups + collaboration
- [ ] Phase 7 — Google Drive/Docs
- [ ] Phase 8 — Flashcards + quizzes + AI tutor
- [ ] Phase 9 — Security + performance + production polish
