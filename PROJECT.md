# Project: Zenote Phase 12 — Unified Global & Semantic Search

## Architecture
Zenote Phase 12 upgrades search from a rudimentary 3-entity substring scan into a unified, multi-tenant hybrid search engine combining PostgreSQL GIN full-text search with `pgvector` HNSW vector embeddings across authorized core entities.

```
Client UI (Command Palette / Topbar ⌘K & /search Page)
      │
      ▼
Search API (`GET /api/search` with Zod validation & auth guard)
      │
      ▼
Search Access Resolver (`src/lib/search/search-access.ts`)
  ├── Personal Workspace Scope (`personalWorkspaceId`)
  └── Active StudyGroup Memberships (`activeGroupIds`)
      │
      ├───────────────────────────────┬───────────────────────────────┐
      ▼                               ▼                               ▼
Lexical FTS Channel             Vector Semantic Channel         Hierarchy Filters
- Expression GIN Indexes        - pgvector HNSW Indexes         - Subject/Chapter/Topic
- `websearch_to_tsquery`        - MaterialChunk (1536d)         - Ancestor `deletedAt IS NULL`
- `ts_rank_cd` scoring          - NoteChunk (1536d)
      │                               │
      └───────────────────────────────┴───────────────────────────────┘
                                      │
                                      ▼
                      Reciprocal Rank Fusion (RRF k=60)
                      - Score normalization & blending
                      - Entity-level chunk collapsing & deduplication
                      - Contextual 160-char snippet extraction with highlights
                                      │
                                      ▼
                      Unified Response Payload & Deep Links
                      - PDF page `?page=` / Audio `?t=`
                      - Topic Notes tab `?tab=notes`
```

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Core Entity Lexical Search | PostgreSQL FTS across Subjects, Chapters, Topics, Materials, Notes, StudyGroups | M1, M2, M3 | ORIGINAL_REQUEST §R1, §R2 |
| 2 | FlashcardDeck Lexical Scope | Search FlashcardDeck titles within authorized workspaces/groups (card embeddings deferred) | M1, M2, M3 | ORIGINAL_REQUEST §R1 |
| 3 | Quiz Scope Formal Decision | Explicit architectural exclusion of Quizzes from Phase 12 per authoritative roadmap | M1, M2 | ORIGINAL_REQUEST §R1 |
| 4 | Text Normalization & FTS Syntax | Punctuation, whitespace, case normalization, and phrase support via `websearch_to_tsquery` | M1, M2 | ORIGINAL_REQUEST §R2 |
| 5 | Material Vector Reuse | Reuse existing `MaterialChunk.embedding` (1536d) without redundant vector columns | M1, M2 | ORIGINAL_REQUEST §R2 |
| 6 | Note Plain-Text Extraction | Deterministic plain-text extraction from Tiptap/ProseMirror JSON blocks | M1 | ORIGINAL_REQUEST §R2 |
| 7 | Note Embedding Lifecycle | Dedicated `NoteChunk` model, autosave hashing, transactional locking, no stale vectors | M1 | ORIGINAL_REQUEST §R2 |
| 8 | Vector HNSW Indexing | Implement pgvector HNSW index (`vector_cosine_ops`) over IVFFlat | M1 | ORIGINAL_REQUEST §R3 |
| 9 | Expression GIN Indexing | Deploy expression GIN indexes across core entities via reproducible SQL migration | M1 | ORIGINAL_REQUEST §R3 |
| 10 | Unified RRF Ranking | Reciprocal Rank Fusion ($k=60$) blending lexical and semantic candidate ranks | M2 | ORIGINAL_REQUEST §R3 |
| 11 | Chunk Collapsing & Deduplication | Deduplicate multiple chunks per Material/Note to top chunk with rank & snippet | M2 | ORIGINAL_REQUEST §R3 |
| 12 | Hierarchy & Entity Filtering | Filter by entity types and Subject, Chapter, Topic, or Group scope | M2, M3 | ORIGINAL_REQUEST §R3 |
| 13 | Pre-Filtered Server Authorization | Compile tenancy and active group predicates directly into SQL/Prisma WHERE clauses | M2, M3 | ORIGINAL_REQUEST §R4 |
| 14 | Fail-Closed Hierarchy Soft Deletion | Exclude notes/materials under soft-deleted subjects/chapters/topics | M2 | ORIGINAL_REQUEST §R4 |
| 15 | Leakage Prevention | Strict isolation ensuring unauthorized content never appears in results, snippets, or counts | M2, M3 | ORIGINAL_REQUEST §R4 |
| 16 | Authenticated Search API | Validated `GET /api/search` with Zod schema, pagination, mode selection, and error handling | M3 | ORIGINAL_REQUEST §R5 |
| 17 | Command Palette (`⌘K`) Upgrade | Fast modal search with `cmdk` `shouldFilter={false}`, debouncing, AbortController | M4 | ORIGINAL_REQUEST §R5 |
| 18 | Dedicated `/search` Experience | Full search page with faceted entity filters, loading skeletons, and empty states | M4 | ORIGINAL_REQUEST §R5 |
| 19 | Contextual Snippets & Highlighting | 160-char sliding window with safe React `<HighlightedSnippet>` using `bg-accent-soft` | M4 | ORIGINAL_REQUEST §R5 |
| 20 | Deep-Link Navigation Routing | Route to PDF page (`?page=`), audio timestamp (`?t=`), Note tab (`?tab=notes`) | M4 | ORIGINAL_REQUEST §R5 |
| 21 | Comprehensive Test Validation | Unit, integration, authorization, regression, build, and typecheck verification | M5 | ORIGINAL_REQUEST §R6 |
| 22 | Documentation & Roadmap Sync | Update `docs/ROADMAP.md`, `PROJECT_STATE.md`, Limitations Register, and Final Report | M5 | ORIGINAL_REQUEST §R6 |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Database Architecture, Migrations & Note Lifecycle | Prisma schema updates (`Note.plainText`, `NoteChunk`), SQL migration for HNSW and GIN FTS indexes, Tiptap plain-text extractor, note block autosave sync, note embedding lifecycle with advisory locking | none | DONE (Verified: 122 tests pass, clean audit, gate PASS) |
| M2 | Security, Access Control & Unified Hybrid Retrieval Service | `src/lib/search/search-access.ts` (scope resolution), lexical FTS builder, vector retrieval runner, RRF ($k=60$) rank fusion, chunk collapsing/deduplication, 160-char snippet windowing | M1 | DONE (Verified: 242 tests pass, clean audit, gate PASS) |
| M3 | Search API Handler & Route Integration | Upgraded `GET /api/search` with Zod validation schema (`src/lib/validation/search.ts`), query parameter parsing, authorization enforcement, error boundaries, graceful vector fallback, route unit & integration tests | M2 | IN_PROGRESS |
| M4 | Global Search UI, Command Palette & Navigation Integration | `command-palette.tsx` upgrade (`shouldFilter={false}`, `AbortController`), `/search` page upgrade (facets, debounce, skeletons, empty states), safe `<HighlightedSnippet>`, deep linking (`materialSourceHref`, `?tab=notes`) | M3 | PLANNED |
| M5 | Final E2E Test Suite Pass, Adversarial Hardening & Deliverables | 100% pass of E2E test suite (Tiers 1-4), Tier 5 white-box adversarial testing, TypeScript typecheck, production build, documentation updates (`ROADMAP.md`, `PROJECT_STATE.md`), final report | M4, E2E-Ready | PLANNED |

Parallel Track:
| Track | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Independent requirement-driven opaque-box test suite (Tiers 1-4) covering all 22 features, culminating in `TEST_READY.md` | none | DONE (Verified: 329 tests across 37 files, 100% pass, clean audit, gate PASS) |

---

## Interface Contracts

### 1. Note Block Autosave ↔ Note Plain Text (`src/app/api/notes/[noteId]/blocks/route.ts`)
- **Input**: ProseMirror/Tiptap block JSON tree (`NoteBlock.content`).
- **Extractor**: `extractPlainTextFromTiptap(content: unknown): string` in `src/lib/search/tiptap-text.ts`.
- **Database Output**: `Note.plainText` updated transactionally alongside block saves.
- **Embedding Lifecycle**: SHA-256 hash check (`sha256(plainText)`). Re-chunk and embed on snapshot or version save using `pg_advisory_xact_lock(hashtextextended('note_chunks:' + noteId, 0))` via `src/lib/search/note-embedding.ts`.

### 2. Search Access Resolver ↔ Retrieval Engine (`src/lib/search/search-access.ts`)
```typescript
export interface UserSearchScope {
  userId: string;
  personalWorkspaceId: string;
  activeGroupIds: string[];
}
export async function resolveUserSearchScope(userId: string): Promise<UserSearchScope>;
```

### 3. Unified Search API ↔ Client Surfaces (`GET /api/search`)
- **Query Parameters**:
  - `q`: string (2..200 chars)
  - `mode`: `"hybrid" | "lexical" | "semantic"` (default: `"hybrid"`)
  - `types`: comma-separated or array of `"subject" | "chapter" | "topic" | "material" | "note" | "group" | "flashcard"`
  - `groupId?`, `subjectId?`, `chapterId?`, `topicId?`: string
  - `limit`: number (1..50, default 20)
  - `offset`: number (0.., default 0)
- **Response Format**:
```typescript
export interface SearchHit {
  id: string;
  entityType: "subject" | "chapter" | "topic" | "material" | "note" | "group" | "flashcard";
  title: string;
  snippet?: string;
  matchType: "hybrid" | "lexical" | "semantic";
  score: number;
  hierarchy: {
    subjectId?: string;
    subjectName?: string;
    chapterId?: string;
    chapterName?: string;
    topicId?: string;
    topicName?: string;
    groupId?: string;
    groupName?: string;
  };
  navigation: {
    href: string;
    pageNumber?: number;
    timestampSeconds?: number;
  };
}

export interface SearchApiResponse {
  query: string;
  mode: "hybrid" | "lexical" | "semantic";
  total: number;
  limit: number;
  offset: number;
  hits: SearchHit[];
  counts: Record<string, number>;
}
```

---

## Code Layout
```
src/
├── app/
│   ├── api/
│   │   └── search/
│   │       ├── route.ts                 # Validated search API handler
│   │       └── __tests__/
│   │           └── route.test.ts        # Search API unit & integration tests
│   └── (app)/
│       └── search/
│           └── page.tsx                 # Dedicated search page
├── components/
│   ├── search/
│   │   ├── search-box.tsx               # Debounced search input
│   │   ├── search-results-list.tsx      # Multi-entity results with snippets
│   │   ├── search-facets.tsx            # Entity filter pills
│   │   └── highlighted-snippet.tsx      # XSS-safe text highlighter
│   └── shell/
│       ├── command-palette.tsx          # cmdk modal palette
│       └── topbar.tsx                   # Topbar ⌘K trigger
├── lib/
│   ├── search/
│   │   ├── search-access.ts             # Server-side scope resolver
│   │   ├── lexical-search.ts            # PostgreSQL GIN FTS builder & runner
│   │   ├── vector-search.ts             # pgvector similarity runner
│   │   ├── rrf-ranking.ts               # RRF k=60 & chunk deduplication
│   │   ├── snippet-extractor.ts         # 160-char windowing & match density
│   │   ├── tiptap-text.ts               # Tiptap JSON to plain-text converter
│   │   ├── note-embedding.ts            # Note chunking & embedding lifecycle
│   │   └── __tests__/                   # Unit tests for search modules
│   ├── validation/
│   │   └── search.ts                    # Zod validation schemas
│   └── material-link.ts                 # Deep-link href generator
prisma/
├── schema.prisma                        # Note.plainText, NoteChunk model
└── migrations/
    └── 20261110090000_phase12_search_indexing/
        └── migration.sql                # HNSW & GIN FTS index DDL
tests/
└── e2e/
    └── search/                          # Complete E2E test suite (329 tests)
```
