# Zenote

> **AI-Powered Lecture Intelligence, Notes & Collaborative Knowledge Workspace**

Zenote is an AI-native study and knowledge platform designed to eliminate academic clutter. It unifies lecture recordings, course materials, rich structured notes, and collaborative study groups into a calm, focused workspace backed by grounded artificial intelligence.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14.2-black.svg)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-336791.svg)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.20-2D3748.svg)](https://www.prisma.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC.svg)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Vitest-86_suites_passing-brightgreen.svg)](https://vitest.dev/)

---

## Table of Contents

- [Project Overview](#project-overview)
- [The Problem Zenote Solves](#the-problem-zenote-solves)
- [Core Features](#core-features)
- [Website & Public Experience](#website--public-experience)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Installation & Local Development](#installation--local-development)
- [Visual Assets & Documentation](#visual-assets--documentation)
- [Current Development Status](#current-development-status)
- [Roadmap & Future Development](#roadmap--future-development)
- [Contributing & License](#contributing--license)

---

## Project Overview

University students, researchers, and serious learners routinely juggle half a dozen disconnected tools: audio memo apps for lectures, cloud drives for lecture slides, separate PDF viewers for textbooks, fragmented note editors, and third-party flashcard apps. Course material ends up scattered across downloads folders and browser tabs, losing the context that makes learning stick.

**Zenote** brings these disparate elements into a single coherent system. It captures raw audio and source documents, organizes them into a structured curriculum hierarchy (Workspace → Subject → Chapter → Topic), and transforms collected information into durable understanding through grounded AI notes, transcript-seeking playback, interactive flashcards, and quizzes.

### Target Users & Primary Use Cases

- **Undergraduate & Graduate Students:** Record lectures with live waveform feedback, generate structured Cornell-style study notes from transcripts, and study with topic-scoped AI tutors.
- **Academic Study Groups:** Share curated course materials, notes, and subjects within role-governed groups while preserving individual study activity privacy.
- **Self-Directed Scholars & Researchers:** Ingest PDFs, Word documents, PowerPoint decks, and Google Drive files into a semantic search index with source-attributed citations.

---

## Core Features

Zenote cleanly distinguishes between **fully implemented core capabilities** and **planned enhancements**:

### 1. Curriculum Hierarchy & Structured Notes (Implemented)
- **Four-Tier Knowledge Tree:** Organized by `Workspace` → `Subject` → `Chapter` → `Topic`.
- **Block-Based Rich Text Editor:** Built on Tiptap with ordered blocks, inline formatting, link insertion, auto-save, and version history with point-in-time restoration.
- **Granular Access Control:** Centralized server-side authorization ensuring users can only read and mutate nodes within authorized personal workspaces or shared groups.

### 2. Multi-Format Material Management & Ingestion (Implemented)
- **Broad File Support:** Ingests PDFs, Microsoft Word (`.docx`), Microsoft PowerPoint (`.pptx`), and audio recordings (`.mp3`, `.wav`, `.m4a`, `.webm`).
- **Document Text Extraction:** Deterministic text and layout extraction (`pdfjs-dist`, `mammoth`, `pptx2html`). Page and slide numbers are preserved for citation tracking.
- **Storage Abstraction:** Dual-driver `StorageService` supporting zero-setup local filesystem storage (`.storage/`) and production S3-compatible object storage (Cloudflare R2, AWS S3) with HTTP byte-range streaming for seekable audio/video playback.

### 3. Lecture Recording & Transcription (Implemented)
- **Browser-Native Audio Capture:** Integrated recorder with real-time audio level meters, pause/resume/cancel controls, and automatic WebM duration repair (`webm-duration-fix`).
- **Multi-Provider Speech-to-Text:** Pluggable speech service abstraction supporting:
  - **AssemblyAI:** Production-grade transcription with speaker diarization.
  - **OpenAI Whisper:** Cost-effective general transcription.
- **Interactive Transcript Player:** Transcripts are stored as timestamped segments; clicking any sentence in the transcript seeks audio playback directly to that moment.

### 4. AI Lecture Intelligence & Grounded RAG (Implemented)
- **Cornell-Style AI Note Generation:** Automatically distills lecture transcripts and documents into executive summaries, key concepts, study questions, and actionable takeaways using Google Gemini (`gemini-2.5-flash-lite`).
- **Semantic Vector Search (pgvector):** Chunks text using word-window and timestamp-aware boundaries, generates 1536-dimensional embeddings (`text-embedding-3-small`), and queries cosine distance directly in PostgreSQL.
- **Grounded Citations:** AI responses cite specific source materials, hyperlinking directly to exact audio timestamps or PDF page numbers.
- **Topic-Scoped AI Tutor:** Dedicated Socratic tutor mode with tailored system prompts to guide learners through difficult concepts without simply supplying answers.

### 5. Flashcards, Quizzes & Study Analytics (Implemented)
- **AI Flashcard Deck Generation:** One-click flashcard generation from topic notes and materials.
- **Interactive Study Session:** Flip-card study interface with per-card confidence tracking (`again`, `hard`, `good`, `easy`) and private review persistence.
- **Quiz Engine:** Automated generation of multiple-choice quizzes with server-side validation and scoring.
- **Study Activity Tracking:** Aggregate metrics tracking quiz scores, attempts, and learning momentum.

### 6. Groups & Collaboration (Implemented)
- **Group Hierarchy:** Workspaces can collaborate via dedicated `Group` entities.
- **Role-Based Membership:** Support for `OWNER`, `ADMIN`, `MEMBER`, and `VIEWER` roles.
- **Content Sharing:** Share entire Subjects or individual Materials to a group. Group members can query a shared AI Assistant scoped to the group's collective material.
- **Privacy Partitioning:** While materials are shared, individual quiz scores, review attempts, and flashcard mastery remain strictly private to each user.
- **Invitations & Activity:** Cryptographically signed invitation tokens with revocation and acceptance lifecycles, coupled with real-time group activity logs.

### 7. Google Drive & Google Docs Integration (Implemented)
- **Separate Connected Account Flow:** Connects to Google Drive using a dedicated OAuth consent flow that is decoupled from user authentication.
- **Encrypted Token Storage:** Refresh tokens are AES-256-GCM encrypted at rest in PostgreSQL.
- **Drive Browser & Importer:** Browse files, select documents, import PDFs and binary formats, and export Google Docs as structured text for ingestion.
- *(Note: Continuous background two-way folder synchronization and native Google Slides formatting remain planned roadmap items).*

### 8. Authentication & Multi-Tenancy (Implemented)
- **NextAuth.js v4:** JWT session strategy with dual providers:
  - **Email & Password:** bcrypt password hashing (cost 12), rate-limited against brute-force attacks (10 attempts per 15 minutes by client IP).
  - **Google OAuth:** One-click social sign-in.
- **Open-Redirect Defense:** Strict validation ensuring post-login callbacks remain within internal safe application routes.
- **Transactional Provisioning:** Automatically creates a default `Workspace`, user `Profile`, and `FREE` tier `Subscription` inside an atomic transaction upon registration.

---

## Website & Public Experience

The Zenote repository houses both the **authenticated core web application** and the **public marketing and onboarding website**. The public experience is completely self-contained and pre-rendered:

- **`/welcome`:** The initial welcome portal. Features a native WebGL2 continuous lines gradient background and an 80-frame Studio Shader canvas animation that performs a 120fps GPU cross-fade into the Platinum-Silver CAD Zenote wordmark. Handles session storage lifecycle, document reloads, and prefers-reduced-motion fallbacks.
- **`/welcome/intro` ("Meet Zenote"):** A comprehensive 8-section product exploration page:
  1. *Intro Hero:* Editorial typography and platform proposition with animated shine border.
  2. *Upload Your Files:* Interactive container-query animated folder-to-cloud file transfer visualization (`FolderTransfer`).
  3. *Connected Sources:* Animated SVG connection beams demonstrating Google Drive, PDF, audio, and web import.
  4. *Organize & Explore:* Interactive tabbed card deck showcasing intelligent classification and search.
  5. *Lecture Recording & Transcription:* Live animated waveform recorder visualizer.
  6. *Collaborate With Your Group:* Multi-node orbital ring system showcasing peer group collaboration.
  7. *The Zenote Journey:* Bespoke 1:1 scroll-synchronized multi-color tracing beam guiding users through Capture, Organize, Explore, and Learn steps with custom SVG artwork.
  8. *Contact & Support:* Functional contact form with client-side Zod validation and Web3Forms integration.
- **SEO & Discoverability Infrastructure:** Complete OpenGraph cards, Twitter preview cards, dynamic `manifest.webmanifest`, dynamic `robots.txt`, XML `sitemap.xml`, and Schema.org structured data (`WebsiteJsonLd`, `SoftwareApplicationJsonLd`).

---

## Technology Stack

| Layer | Technologies |
|---|---|
| **Framework & Language** | Next.js 14.2 (App Router, Server Components, Route Handlers), React 18.3, TypeScript 5.6 |
| **Styling & Design Tokens** | Tailwind CSS 3.4, `@tailwindcss/animate`, Radix UI primitives, Lucide Icons, MagicUI registry |
| **Database & Multi-Tenancy** | PostgreSQL 15+, Prisma ORM 5.20, `pgvector` extension (1536-dimensional cosine retrieval) |
| **Authentication & Security** | NextAuth.js 4.24 (JWT Strategy), bcryptjs, AES-256-GCM encryption, strict CSP headers |
| **AI & LLM Services** | Google Gemini (`@google/genai` with `gemini-2.5-flash-lite`), OpenAI (`openai` with `text-embedding-3-small`) |
| **Speech & Audio** | AssemblyAI (with speaker diarization), OpenAI Whisper, `music-metadata`, `webm-duration-fix` |
| **Storage Drivers** | Dual-mode `StorageService`: Local disk (`.storage/`) and S3-compatible object storage (`@aws-sdk/client-s3`) |
| **Cache & Rate Limiting** | Upstash Redis (`@upstash/redis`) distributed rate-limiting with memory fallback |
| **Document Processing** | `pdfjs-dist`, `pdf-lib`, `mammoth` (DOCX), `pptx2html` / `jszip` (PPTX) |
| **Rich Text Editor** | Tiptap 2.8 (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`) |
| **Observability & Logging** | Datadog direct HTTP log & metric intake, `/api/health` readiness/liveness, `/api/client-errors` |
| **Testing & Quality** | Vitest 2.1 (86 suites, 875+ tests), ESLint 8.57, TypeScript strict checking |

---

## Project Structure

```text
notes-platform-phase5/
├── docs/                               # Deep technical architecture & operational guides
│   ├── ARCHITECTURE.md                 # System architecture, multi-tenancy, and data flows
│   ├── ai-setup.md                     # AI and embedding provider configuration details
│   ├── google-setup.md                 # Google OAuth and Drive/Docs setup guide
│   ├── observability.md                # Datadog metrics, health checks, and logging guide
│   ├── production-readiness.md         # Operational runbook, recovery, and backup procedures
│   └── security-hardening.md           # Security audit, CSP headers, and boundary analysis
├── prisma/                             # Database schema and migration management
│   ├── migrations/                     # Sequential SQL migration history
│   ├── schema.prisma                   # Canonical Prisma data models and indexes
│   └── seed.ts                         # Development database seed script
├── public/                             # Public static assets
│   ├── avatars/                        # Real group collaborator avatars
│   ├── fonts/                          # Local variable and brand webfonts (Noto, Satoshi, Maname, Manrope)
│   ├── images/onboarding/              # High-definition studio source assets for animation
│   ├── intro-hero.png                  # Canonical OpenGraph & Twitter preview banner
│   └── zenote-logo-transparent.png     # Official high-resolution transparent logo
├── src/
│   ├── app/                            # Next.js App Router root
│   │   ├── (app)/                      # Authenticated scholar's workspace shell & views
│   │   │   ├── assistant/              # Workspace-wide AI conversational assistant
│   │   │   ├── flashcards/             # Interactive flashcard decks and review sessions
│   │   │   ├── groups/                 # Collaborative study groups and shared materials
│   │   │   ├── home/                   # Main scholar dashboard and recent activity
│   │   │   ├── materials/              # File manager, viewer, and audio player
│   │   │   ├── quizzes/                # Quiz taking and scoring engine
│   │   │   ├── search/                 # Workspace-wide text search
│   │   │   ├── settings/               # Profile, billing, and connected account settings
│   │   │   └── subjects/               # Subject → Chapter → Topic hierarchy views
│   │   ├── (auth)/                     # Split-screen editorial authentication (sign-in, sign-up)
│   │   ├── api/                        # Serverless API route handlers
│   │   │   ├── ai/                     # Conversations, messages, and RAG retrieval
│   │   │   ├── auth/                   # NextAuth and registration endpoints
│   │   │   ├── health/                 # Liveness and readiness health monitoring
│   │   │   ├── integrations/google/    # Drive OAuth, connect, disconnect, and import
│   │   │   ├── materials/              # Ingestion, transcription, and note generation
│   │   │   └── storage/                # Presigned upload and range-buffered read proxy
│   │   ├── welcome/                    # Public pre-rendered website (/welcome, /welcome/intro)
│   │   ├── layout.tsx                  # Global root HTML layout with JSON-LD and fonts
│   │   ├── manifest.ts                 # Dynamic Web App Manifest
│   │   ├── robots.ts                   # Dynamic robots.txt
│   │   └── sitemap.ts                  # Dynamic XML sitemap
│   ├── components/                     # Modular React UI components
│   │   ├── ai/                         # Chat panels, message bubbles, and citation badges
│   │   ├── auth/                       # Sign-in/sign-up forms, password toggles, Google button
│   │   ├── onboarding/                 # Welcome screens, logo reveal canvas, and 8 intro sections
│   │   ├── seo/                        # Schema.org JSON-LD structured data components
│   │   ├── shell/                      # Sidebar navigation, header, and mobile nav drawer
│   │   └── ui/                         # Base design system primitives (Button, Input, Dialog)
│   ├── lib/                            # Core business logic and shared services
│   │   ├── access.ts                   # Centralized multi-tenant authorization layer
│   │   ├── auth.ts                     # NextAuth configuration and credentials provider
│   │   ├── contact-form.ts             # Contact submission handler and validation
│   │   ├── db.ts                       # Singleton Prisma client instance
│   │   ├── rate-limit.ts               # Upstash Redis / in-memory rate-limiter
│   │   ├── site-config.ts              # Single source of truth for site identity & metadata
│   │   └── services/                   # Service layer abstractions (AI, speech, storage, drive)
│   └── registry/magicui/               # Curated high-performance UI visual components
└── tailwind.config.js                  # Tailwind design tokens, typography, and animations
```

---

## Installation & Local Development

### Prerequisites
- **Node.js:** `v18.18.0` or higher (verified up to Node 20 LTS)
- **Database:** PostgreSQL 15+ with the `pgvector` extension installed
- **Package Manager:** `npm` (included with Node.js)

### Step-by-Step Setup

#### 1. Clone the Repository
```bash
git clone https://github.com/webcraftservices/Notes-Platform.git
cd Notes-Platform
```

#### 2. Install Dependencies
```bash
npm install
```

#### 3. Configure Environment Variables
Copy the template configuration file:
```bash
cp .env.example .env.local
```
Open `.env.local` in your editor. At a minimum, set:
- `DATABASE_URL`: Your PostgreSQL connection string (e.g. `postgresql://user:password@localhost:5432/zenote?schema=public`).
- `NEXTAUTH_SECRET`: A secure random 32-character string (generate via `openssl rand -base64 32`).
- `NEXTAUTH_URL`: `http://localhost:3000`

*Optional integrations (can be enabled as needed):*
- `AI_PROVIDER="gemini"` & `GOOGLE_AI_API_KEY`: Activates AI note generation, chat, and the AI Tutor.
- `EMBEDDING_PROVIDER="openai"` & `OPENAI_API_KEY`: Activates document vector embeddings for RAG search.
- `SPEECH_PROVIDER="assemblyai"` & `ASSEMBLYAI_API_KEY` (or `"openai"`): Activates audio lecture transcription.
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: Activates Google sign-in and Drive/Docs import.
- `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY`: Activates public contact form delivery (delivered to your email).

#### 4. Prepare Database & Apply Migrations
Connect to your PostgreSQL database and enable `pgvector`:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```
Then run the Prisma migration suite:
```bash
npm run db:migrate
```

#### 5. Seed Initial Development Data
```bash
npm run db:seed
```
*Creates a pre-configured demo account (`demo@example.com` / `Password123`) populated with sample subjects (Physics, Calculus), chapters, and topics so the dashboard is immediately functional.*

#### 6. Initialize Local File Storage
```bash
# macOS / Linux
mkdir -p .storage

# Windows PowerShell
New-Item -ItemType Directory -Path .storage -Force
```

#### 7. Start the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.
- Visit [http://localhost:3000/welcome](http://localhost:3000/welcome) to experience the brand reveal.
- Visit [http://localhost:3000/welcome/intro](http://localhost:3000/welcome/intro) to view the product showcase.
- Visit [http://localhost:3000/sign-in](http://localhost:3000/sign-in) to log in to the workspace.

---

## Available NPM Scripts

| Command | Description | Verification Status |
|---|---|---|
| `npm run build` | Compiles an optimized production build and pre-renders static pages | **Executed & Verified** (`next build`, 40 routes) |
| `npm run typecheck` | Executes TypeScript type-checking without emitting files (`tsc --noEmit`) | **Executed & Verified** (0 errors) |
| `npm run lint` | Runs ESLint across all source and component files | **Executed & Verified** (0 errors) |
| `npm test` | Runs the full Vitest automated test suite once (`vitest run`) | **Executed & Verified** (86 suites, 875 passed) |
| `npm run dev` | Starts the Next.js development server on `127.0.0.1:3000` | Verified via `package.json` inspection |
| `npm run start` | Starts the production server using the compiled build | Verified via `package.json` inspection |
| `npm run test:watch` | Starts Vitest in interactive watch mode for TDD | Verified via `package.json` inspection |
| `npm run db:generate` | Generates the Prisma client from `schema.prisma` | Verified via `package.json` inspection |
| `npm run db:migrate` | Applies development Prisma database migrations | Verified via `package.json` / migrations inspection |
| `npm run db:migrate:deploy` | Applies pending migrations in production | Verified via `package.json` inspection |
| `npm run db:studio` | Opens Prisma Studio GUI in browser to inspect records | Verified via `package.json` inspection |
| `npm run db:seed` | Seeds demo user, workspace, subjects, chapters, and topics | Verified via `package.json` / `seed.ts` inspection |

> **Audit Note on Database Commands:** In accordance with strict pre-push audit safety rules, database migration (`db:migrate`) and seeding (`db:seed`) scripts were verified through complete source and configuration inspection; they were not executed against live databases during this audit pass.

---

## Visual Assets & Documentation

The repository includes high-resolution visual previews and architectural specifications:

- **Welcome Hero Banner:** [`public/intro-hero.png`](public/intro-hero.png)
- **Official Brand Mark:** [`public/zenote-logo-transparent.png`](public/zenote-logo-transparent.png)
- **Deep Architecture Documentation:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Project State & Phased Breakdown:** [`PROJECT_STATE.md`](PROJECT_STATE.md)
- **Security Hardening Audit:** [`docs/security-hardening.md`](docs/security-hardening.md)
- **Observability & Health Endpoints:** [`docs/observability.md`](docs/observability.md)
- **Production Operations Runbook:** [`docs/production-readiness.md`](docs/production-readiness.md)

---

## Current Development Status

- **Website Development:** **Completed.** The welcome experience, 8 intro narrative sections, WebGL2 shader background, Studio canvas reveal animation, split-screen auth layouts, and comprehensive SEO infrastructure are fully implemented and verified locally.
- **Documentation & Repository Preparation:** **In Progress.** Repository audit, dead-code removal, technical documentation synchronization, and commit plan are actively being finalized for the first synchronized GitHub push.
- **Website Deployment & Production Launch:** **Pending.** Cloud hosting provisioning, staging environment configuration with managed PostgreSQL/pgvector, and live domain deployment have not yet occurred.
- **Core Workspace Application:** **Implemented & Ongoing.** Existing implemented features across 9 completed phases (curriculum hierarchy, Tiptap rich notes, multi-format ingestion, AssemblyAI transcription, Gemini AI notes and Socratic tutor, collaborative groups, and Google Drive integration) remain fully preserved and functional, with ongoing development continuing alongside deployment infrastructure.
- **Repository Health:**
  - TypeScript: Zero compilation errors (`tsc --noEmit` clean).
  - ESLint: Clean pass (0 errors).
  - Production Build: Successfully pre-renders all 40 static and dynamic routes.
  - Automated Tests: 86 test files passing (875 unit and integration tests).

---

## Roadmap & Future Development

### Completed
- [x] Phase 1: PostgreSQL + Prisma schema, NextAuth authentication, and base security.
- [x] Phase 2: Scholar dashboard and Workspace → Subject → Chapter → Topic hierarchy.
- [x] Phase 3: Block-based note editor (Tiptap), versioning, and multi-format file ingestion.
- [x] Phase 4: Lecture audio recording, WebM duration repair, and AssemblyAI/Whisper transcription.
- [x] Phase 5: RAG vector embeddings, pgvector cosine search, Cornell note generation, and AI chat with citations.
- [x] Phase 6: Collaborative study groups, role-based access, and shared AI assistant scoping.
- [x] Phase 7: Google Drive and Google Docs connected account flow, encrypted tokens, and file import.
- [x] Phase 8: Flashcard generation, interactive study loop, quiz scoring engine, and AI Tutor.
- [x] Phase 9: Distributed rate limiting, security boundaries, Datadog observability, and performance optimization.
- [x] Brand Rebrand: Platform renamed to Zenote; complete public marketing website and onboarding experience created.

### In Progress
- [ ] Production deployment and continuous integration (CI/CD) pipeline setup.
- [ ] Staging environment provisioning with managed PostgreSQL/pgvector.
- [ ] End-to-end browser regression automation on deployed environments.

### Planned
- [ ] Spaced repetition scheduling algorithm (SM-2 / FSRS) for flashcard decks.
- [ ] Continuous bidirectional synchronization with Google Drive folders.
- [ ] Native slide extraction and presentation viewer for Google Slides.
- [ ] Offline-first desktop application packaging (via Tauri / Electron).
- [ ] Mobile companion apps for on-the-go lecture audio capture.

---

## Contributing & License

### Contributing
This repository is currently maintained for the Zenote platform. Pull requests and issues are managed through internal development workflows. Contributors are expected to maintain documentation integrity, run `npm test` before opening PRs, and adhere to the project's strict zero-mock policy for production services.

### License
All rights reserved. Proprietary software. Licensing terms are to be determined upon public release.
