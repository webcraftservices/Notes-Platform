# Zenote — Project State & Implementation Snapshot

> **Canonical Project State Document**
> Last reconciled against the repository on **November 3, 2026**, following the final pre-push audit and temporary file cleanup.

---

## 1. Executive Summary & Overall Status

Zenote is an **AI-powered lecture intelligence, structured note-taking, and collaborative knowledge platform**.

The repository status is cleanly distinguished across four pillars:
- **Website Development:** **Completed.** The public-facing Zenote marketing website, welcome portal (`/welcome`), interactive 8-section onboarding experience (`/welcome/intro`), split-screen authentication views, and complete SEO infrastructure have been designed, implemented, and verified locally.
- **Documentation & Repository Preparation:** **In Progress.** The repository audit, temporary file cleanup, and technical documentation synchronization are being finalized for the first synchronized GitHub push.
- **Website Deployment & Production Launch:** **Pending.** Cloud hosting, managed database provisioning, and production domain launch have not yet occurred.
- **Core Workspace Application:** **Implemented & Ongoing.** Features across 9 comprehensive implementation phases (curriculum hierarchies, Tiptap rich notes, multi-format file ingestion, AssemblyAI transcription, Gemini AI notes and Socratic tutor, collaborative study groups, and Google Drive connectivity) remain fully preserved and functional, with ongoing development continuing.

### Current Health & Verification Metrics:
- **TypeScript Compilation:** **PASS** (`tsc --noEmit` executed; exited code `0`, zero type errors).
- **ESLint Linting:** **PASS** (`eslint .` executed; exited code `0`, zero errors, 4 non-blocking image optimization warnings).
- **Automated Tests:** **PASS** (Vitest: **86 test files passed (86/86)**, **875 tests passed**, 4 skipped integration tests requiring external API keys).
- **Production Build:** **PASS** (`next build` executed; compiled and prerendered all 40 static and dynamic routes cleanly).
- **Setup & Database Commands:** `npm run db:migrate` and `npm run db:seed` verified via schema and source inspection; not executed against live databases during this audit pass.
- **Repository Cleanliness:** 37 developer scratch scripts, temporary captures, and legacy prototypes were safely deleted in the pre-push audit. Zero credentials, environment secrets, or personal paths are tracked.
- **Deployment Status:** Not yet deployed to production hosting. Build and bundle artifacts verified locally.

---

## 2. Phased Development Status

| Phase / Milestone | Status | Verified Implementation Summary |
|---|---|---|
| **Phase 1 — Architecture, Auth & Database** | **COMPLETE** | Next.js 14 App Router, PostgreSQL schema via Prisma ORM, `pgvector` vector extension, NextAuth.js JWT authentication, credentials provider with bcrypt hashing, base layouts, and transactional user/workspace provisioning. |
| **Phase 2 — Dashboard & Hierarchy** | **COMPLETE** | Full course knowledge hierarchy: `Workspace` → `Subject` → `Chapter` → `Topic`. CRUD operations, navigation drawers, breadcrumbs, search bars, and centralized authorization checks in `src/lib/access.ts`. |
| **Phase 3 — Materials, Storage & Notes** | **COMPLETE** | Block-based rich text editor powered by Tiptap with autosave, version history, and point-in-time note restoration. Multi-format file ingestion (PDF, DOCX, PPTX, audio), dual-driver `StorageService` (local disk `.storage/` and Cloudflare R2 / AWS S3), soft deletion, and plan-based storage quotas. |
| **Phase 4 — Audio & Transcription** | **COMPLETE** | Browser-native audio recorder with live waveform meters, pause/resume, and WebM duration repair (`webm-duration-fix`). Speech-to-text service abstraction with concrete AssemblyAI (speaker diarization) and OpenAI Whisper implementations. Interactive transcript player with synchronized timestamp seeking. |
| **Phase 5 — AI Notes, RAG & Chat** | **COMPLETE** | Deterministic word-window and audio-interval text chunking. 1536-dimensional vector embedding generation (`text-embedding-3-small`). Cosine similarity vector search via PostgreSQL `pgvector`. Scoped RAG retrieval (Topic, Subject, Chapter, Group, Workspace). Cornell-style note generation and multi-turn AI chat with grounded audio/page citations using Google Gemini (`gemini-2.5-flash-lite`). |
| **Phase 6 — Groups & Collaboration** | **COMPLETE** | Collaborative study groups with role-based access control (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`). Cryptographically hashed invitation links with expiration and revocation. Shared Subjects and Materials. Group-scoped AI Assistant. Strict privacy boundary ensuring individual quiz attempts and flashcard reviews remain private to each member. |
| **Phase 7 — Google Drive & Docs Integration** | **COMPLETE (Core)** | Dedicated Connected Accounts OAuth flow independent of login scopes. AES-256-GCM token encryption at rest. Google Drive browser, duplicate detection, Google Docs plain-text export, and material ingestion. Continuous bidirectional sync and native Google Slides presentation support remain planned. |
| **Phase 8 — Flashcards, Quizzes & Study Progress** | **COMPLETE (Core)** | AI flashcard deck generation. Interactive flip-card review session with per-card confidence tracking (`again`, `hard`, `good`, `easy`) and private review persistence. AI multiple-choice quiz generator with server-side answer scoring. Study progress rollups tracking quiz performance and momentum. Spaced repetition algorithm (SM-2 / FSRS) remains planned. |
| **Phase 9 — Production Hardening & Observability** | **COMPLETE** | Security boundary audit, XSS input sanitization (`isomorphic-dompurify`), safe JSON parsing for Tiptap note blocks, strict CSP headers. Upstash Redis distributed rate limiting with in-memory fallback. Datadog structured logging and metric intake. Liveness (`/api/health/live`) and readiness (`/api/health`) monitoring. Client crash reporting (`/api/client-errors`). Range-buffered S3 audio seeking and query optimization (`lib/material-list-select.ts`). |
| **Zenote Rebrand & Public Website** | **COMPLETE** | Full rebranding to Zenote. Self-contained public marketing experience: `/welcome` (WebGL2 background shader, 80-frame Studio canvas reveal with 120fps GPU cross-fade, and CAD wordmark), `/welcome/intro` (8-section product narrative including FolderTransfer animation, FeyCards, OrbitingCircles, and 1:1 scroll Tracing Beam with custom SVG illustrations), Web3Forms contact form, split-screen auth views, and comprehensive SEO infrastructure (JSON-LD, manifest, robots, sitemap). |

---

## 3. Verified Implemented Features

### Core Application
- **Curriculum Tree:** `Workspace` → `Subject` → `Chapter` → `Topic`.
- **Note Editor:** Block-based editor (Tiptap) with auto-save, versioning, and restore.
- **Material Management:** Ingestion of PDF, DOCX, PPTX, and audio files with slide/page previews.
- **Speech Intelligence:** Real-time audio recording, WebM duration repair, AssemblyAI diarization, and Whisper transcription with synchronized seeking.
- **RAG & Vector Retrieval:** pgvector cosine similarity search (`vector(1536)`), deterministic chunking, and grounded source citations.
- **AI Synthesis:** Cornell-style lecture summaries, key concepts, study questions, and Socratic AI Tutor.
- **Study Groups:** Role-governed collaborative workspaces with shared materials and group-scoped AI assistant.
- **Study Loops:** Interactive flashcard review and multiple-choice quizzes with server-side validation.
- **Connected Accounts:** Google Drive browser and Google Docs text extraction with encrypted OAuth tokens.
- **Security Boundaries:** Credentials rate-limiting, open-redirect mitigation, CSP headers, and centralized resource authorization.

### Public Website & Onboarding
- **Welcome Splash (`/welcome`):** WebGL2 shader background, Studio canvas reveal animation with session-aware playback rules and reduced-motion support.
- **Product Overview (`/welcome/intro`):** 8 responsive sections:
  1. *Intro Hero:* Editorial typography and badge.
  2. *Upload Your Files:* Responsive `FolderTransfer` container-query animation.
  3. *Connected Sources:* `AnimatedBeam` integration cards.
  4. *Organize & Explore:* Interactive `FeyCards` carousel.
  5. *Lecture Recording:* Animated waveform visualizer.
  6. *Collaborate:* `OrbitingCircles` with real collaborator avatars.
  7. *The Zenote Journey:* 1:1 scroll-tracked `TracingBeam` with custom SVG art.
  8. *Contact & Support:* Functional contact form powered by Web3Forms.
- **SEO & Metadata:** Next.js dynamic metadataBase, OpenGraph cards, Twitter cards, Schema.org JSON-LD, Web App Manifest (`manifest.webmanifest`), `robots.txt`, and XML `sitemap.xml`.

---

## 4. Partially Implemented Features & Planned Roadmap

### Partially Implemented / Deferred Enhancements:
1. **Google Drive Continuous Sync:** Current implementation supports browsing and manual one-off file importing. Automatic background polling or webhook-based folder synchronization is not yet implemented.
2. **Google Slides Native Formatting:** Google Docs exports to clean text; Google Slides currently imports as binary/PDF rather than native parsed slides.
3. **Flashcard Spaced Repetition Scheduling:** The review loop persists per-user confidence levels and timestamps, but does not yet calculate SM-2 or FSRS repetition intervals.
4. **External Background Worker:** Asynchronous jobs (`ProcessingJob`) currently execute within the web server process; decoupling this into an independent worker process (e.g. BullMQ / Redis worker) is designed but deferred until horizontal scaling demands it.
5. **Self-Service Password Reset:** Authentication currently provides secure credentials sign-in, sign-up, and session management. Email-based self-service password reset is handled via administrator notification and is slated for automated email token delivery.

---

## 5. Known Limitations

1. **AI Chat Context Growth:** Multi-turn chat currently passes full conversation history to the model. For extremely long AI Tutor dialogues, a sliding window or conversation summarizer should be implemented to prevent context-window exhaustion.
2. **Streaming Transcriptions:** Transcription jobs upload the entire audio file to AssemblyAI/OpenAI before polling for completion; live chunk-by-chunk real-time streaming transcription is not supported.
3. **In-Flight Job Locks:** Flashcard and quiz generation do not enforce server-side mutex locks; duplicate requests are mitigated by client UI loading states and a 5 request/minute rate limit.

---

## 6. Important Architectural Decisions

1. **Unified Next.js 14 App Router:** Kept as a single deployable unit to maximize development velocity while maintaining strict code-level separation between API routes, domain services, and UI components.
2. **pgvector Colocation:** Vector embeddings are stored directly in PostgreSQL alongside relational models, avoiding the cost, operational overhead, and dual-write consistency hazards of a separate vector database.
3. **Interface-First Service Layer:** All external integrations (`AIService`, `EmbeddingService`, `SpeechService`, `StorageService`) are strictly abstracted. Swapping providers requires zero changes to route handlers or UI components.
4. **Direct Data URI Animation Assets:** The 80-frame Studio animation sprite sheet and master Z frame are embedded directly into `zenote-logo-reveal.tsx` as Base64 data URIs, eliminating runtime HTTP asset requests, CDN latency, and image flicker.
5. **Centralized Access Layer:** Every query for course hierarchy, notes, materials, or groups calls `assertCanAccess()` in `src/lib/access.ts`, enforcing consistent tenant isolation across all endpoints.

---

## 7. Important Directories & Key Entry Points

- **Application Shell Layout:** `src/app/(app)/layout.tsx`
- **Authentication Split Layout:** `src/app/(auth)/layout.tsx`
- **Welcome Splash Page:** `src/app/welcome/page.tsx`
- **Product Overview Page:** `src/app/welcome/intro/page.tsx`
- **Central Access Control:** `src/lib/access.ts`
- **Central NextAuth Configuration:** `src/lib/auth.ts`
- **Service Interfaces:** `src/lib/services/interfaces.ts`
- **Database Schema:** `prisma/schema.prisma`
- **Observability & Health:** `src/app/api/health/route.ts`
- **Site Identity & Metadata:** `src/lib/site-config.ts`

---

## 8. External Service Integrations & Dependencies

| Service | Environment Variable(s) | Required for |
|---|---|---|
| **PostgreSQL 15+** | `DATABASE_URL` | Relational tables and pgvector embedding storage |
| **NextAuth** | `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | User sessions, cookie signing, CSRF defense |
| **Google Gemini** | `AI_PROVIDER="gemini"`, `GOOGLE_AI_API_KEY` | Lecture note synthesis, AI chat, Socratic tutor |
| **OpenAI** | `EMBEDDING_PROVIDER="openai"`, `OPENAI_API_KEY` | 1536-dim vector embeddings (`text-embedding-3-small`) |
| **AssemblyAI** | `SPEECH_PROVIDER="assemblyai"`, `ASSEMBLYAI_API_KEY` | Lecture transcription with speaker diarization |
| **Google OAuth** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` | Social sign-in and encrypted Drive/Docs connectivity |
| **Cloudflare R2 / AWS S3** | `STORAGE_DRIVER="s3"`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Scalable cloud file and audio storage |
| **Upstash Redis** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Distributed rate limiting across serverless nodes |
| **Datadog** | `DD_API_KEY`, `DD_SITE`, `DD_ENV`, `DD_SERVICE`, `DD_VERSION` | Production structured logging, metrics, error tracking |
| **Web3Forms** | `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY` | Serverless contact and support form submissions |

---

## 9. Next Recommended Development Steps

1. **Stage & Commit Approved Website & Documentation Changes:** Stage the verified 68 website files and updated documentation, and perform the initial synchronized GitHub push.
2. **CI/CD Pipeline Setup:** Configure GitHub Actions for automated type-checking, linting, Vitest execution, and Next.js production builds.
3. **Staging Environment Deployment:** Provision a managed PostgreSQL instance with `pgvector` (e.g. Neon, Supabase, or AWS RDS) and deploy the application to a staging environment (e.g. Vercel or AWS ECS/Amplify).
4. **End-to-End Browser Testing:** Execute automated Playwright/Cypress regression flows across the live staging environment for authentication, lecture recording, and study group collaboration.
