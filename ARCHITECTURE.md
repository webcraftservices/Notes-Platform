# Zenote Technical Architecture Overview

> **Canonical Architecture Document:** For the complete, deep technical architecture specification, entity-relationship diagrams, and service data flows, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 1. High-Level System Architecture

Zenote is a unified, single-deployable **Next.js 14 App Router** application that combines a rich client UI, server components, authenticated REST route handlers, and database-backed asynchronous background jobs.

```text
User Browser
  -> Next.js App Router (Public Marketing & Authenticated Shell)
  -> NextAuth JWT Session Validation
  -> Centralized Authorization Guard (src/lib/access.ts)
  -> Curriculum Hierarchy (Workspace -> Subject -> Chapter -> Topic)
  -> Materials, Notes, Audio Recordings, and Study Groups
  -> StorageService (.storage/ filesystem or Cloudflare R2 / AWS S3)
  -> Document Text Extraction (PDF, DOCX, PPTX) & Speech Transcription (AssemblyAI / Whisper)
  -> Deterministic Chunking (300-word windows, timestamp boundaries)
  -> EmbeddingService (OpenAI text-embedding-3-small, 1536 dimensions)
  -> PostgreSQL + pgvector (MaterialChunk cosine distance index)
  -> Scoped Semantic Retrieval & Grounded Context Assembly
  -> AIService (Google Gemini 2.5 Flash Lite)
  -> Socratic AI Tutor & Grounded Citations (Direct Audio & Page Links)
```

There is no separate backend service. Route handlers in `src/app/api/` act as the API layer, while domain services in `src/lib/services/` isolate external integrations.

---

## 2. Core Architectural Domains

1. **Frontend & Application Routing (`src/app/`):**
   - `(auth)`: Split-screen editorial authentication layout (`/sign-in`, `/sign-up`).
   - `(app)`: Authenticated scholar workspace (`/home`, `/subjects`, `/materials`, `/groups`, `/flashcards/[deckId]`, `/quizzes/[quizId]`, `/assistant`, `/settings`).
   - `welcome`: High-performance public marketing experience (`/welcome`, `/welcome/intro`) featuring a WebGL2 background shader, 80-frame Studio canvas reveal, and 8 product showcase sections.
   - `api`: Authenticated REST endpoints.

2. **Authentication & Security (`src/lib/auth.ts`, `src/lib/access.ts`):**
   - Stateless JWT session strategy via NextAuth.js.
   - Rate-limited credentials authentication with bcrypt hashing.
   - Centralized resource authorization ensuring multi-tenant isolation.
   - Open-redirect protection via `getSafeCallbackUrl`.

3. **Multi-Tenancy & Data Model (`prisma/schema.prisma`):**
   - Personal `Workspace` boundaries alongside collaborative `Group` boundaries.
   - Hierarchical course knowledge: `Subject` → `Chapter` → `Topic` → `Note`.
   - Private activity partitioning: group members share materials and subjects, but quiz scores and flashcard reviews remain strictly private.

4. **Speech-to-Text & Ingestion (`src/lib/services/`):**
   - In-browser WebM audio recording with level meters and duration repair.
   - Pluggable speech transcription with speaker diarization via AssemblyAI or Whisper.
   - Multi-format document parsing for PDFs (`pdfjs-dist`), Word (`mammoth`), PowerPoint (`pptx2html`), and Google Docs.

5. **AI, RAG & Vector Search:**
   - 1536-dimensional vector embeddings stored in PostgreSQL via `pgvector`.
   - Cosine-distance similarity retrieval scoped to workspace, subject, or group.
   - Cornell-style note generation and multi-turn Socratic AI Tutor powered by Gemini.

6. **External Integrations:**
   - Decoupled Google Drive connected accounts with AES-256-GCM encrypted tokens.
   - Distributed rate-limiting via Upstash Redis.
   - Observability and health monitoring via Datadog and `/api/health`.

---

## 3. Related Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Comprehensive technical architecture, Mermaid diagrams, and service contracts.
- [`PROJECT_STATE.md`](PROJECT_STATE.md) — Current development status, verified implementations, and planned roadmap.
- [`docs/security-hardening.md`](docs/security-hardening.md) — Security boundaries, CSP headers, and input sanitization.
- [`docs/observability.md`](docs/observability.md) — Health check endpoints, client error reporting, and Datadog telemetry.
- [`docs/production-readiness.md`](docs/production-readiness.md) — Production operations, backup, and recovery runbooks.
