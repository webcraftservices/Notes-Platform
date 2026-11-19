# Zenote Phase 12: Unified Global & Semantic Search — E2E Test Infrastructure & Methodology

## 1. Overview & Objectives

This document establishes the authoritative End-to-End (E2E) testing infrastructure, methodology, and verification framework for **Zenote Phase 12: Unified Global & Semantic Search**.

The primary objective of the Phase 12 E2E testing track is to guarantee that the search engine operates as a coherent, multi-tenant, server-side authorized hybrid retrieval system across all approved core entities (Subjects, Chapters, Topics, Materials, Notes, StudyGroups, and FlashcardDecks), with strict exclusion of Quizzes, zero data leakage, and high-fidelity ranking and navigation.

The test suite is structured around an **opaque-box** testing model:
- Tests interact exclusively through public APIs (`GET /api/search`, note lifecycle routes), standard HTTP request/response interfaces, and component render outputs.
- No test couples to private internal functions or ephemeral implementation details.
- All tests execute deterministically in Node.js via Vitest (`npx.cmd vitest`), without requiring live cloud databases or network connections.

---

## 2. Test Architecture & Environment

### 2.1 Test Execution Environment
- **Test Framework**: Vitest v2.1.1+ (configured in `vitest.config.ts` with `environment: "node"`).
- **TypeScript**: TypeScript v5.6.2+ (`tsconfig.json` with strict type checking and `@/*` path mapping to `./src/*`).
- **Operating System Compatibility**: Fully verified on Windows PowerShell.
  - **Critical Shell Command Rule**: PowerShell script execution policies may disable `npx` directly. All test invocations must use the Windows batch shim:
    ```powershell
    npx.cmd vitest run <path>
    npm.cmd run typecheck
    ```

### 2.2 In-Memory Mock Store & Isolation Pattern
- **Cloud Database Decoupling**: The repository `.env` points to a cloud Neon PostgreSQL database. In accordance with project conventions, E2E tests do not write to or require an active connection to cloud databases.
- **Hoisted Mock Database**: The reusable test harness (`tests/e2e/search/harness/mock-db-store.ts`) provides a high-fidelity, in-memory mock of Prisma Client (`@/lib/db`) and access control resolvers (`@/lib/access`).
- **Deterministic Fixtures**: Standard multi-tenant datasets (`tests/e2e/search/harness/fixtures.ts`) seed isolated user topologies (Alice, Bob, Charlie) across personal workspaces, shared study groups with role hierarchies (OWNER, ADMIN, MEMBER, VIEWER), hierarchical subjects/chapters/topics, and note/material chunk embeddings.

---

## 3. Systematic Test Methodology (Tiers 1–4)

The test suite applies four systematic software testing methodologies across four distinct tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Tier 4: Workload Testing                          │
│               5 Realistic Multi-Step Student Workflows                 │
├────────────────────────────────────────────────────────────────────────┤
│                      Tier 3: Pairwise Testing                          │
│             Cross-Feature Combinations & Interaction Faults             │
├────────────────────────────────────────────────────────────────────────┤
│                 Tier 2: Boundary Value Analysis (BVA)                  │
│               Limits, Extremes, Nulls, Special Characters              │
├────────────────────────────────────────────────────────────────────────┤
│                 Tier 1: Category-Partition Coverage                    │
│            ≥5 Tests per Feature across all 22 Features (≥110)          │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Tier 1: Feature Coverage (Category-Partition Method)
- **Methodology**: The Category-Partition method decomposes each of the 22 features identified in `PROJECT.md § Feature Inventory` into distinct functional categories, input parameters, and output partitions.
- **Coverage Goal**: At least **5 independent, deterministic tests per feature** across all 22 features, yielding a baseline of **$\ge 110$ tests**.
- **Scope**: Verifies individual feature requirements in isolation, confirming that nominal happy-path behaviors operate strictly within interface contracts.

### 3.2 Tier 2: Boundary Value Analysis (BVA) & Corner Cases
- **Methodology**: Boundary Value Analysis and Equivalence Partitioning target edge values, discontinuity thresholds, empty/null states, and defensive error boundaries.
- **Key Partition Boundaries**:
  - **Query Length ($q$)**: Length 0 (empty string), Length 1 (below minimum 2-char threshold), Length 2 (exact minimum valid query), Length 200 (maximum valid query), Length 201+ (over maximum limit).
  - **Special Characters & Encoding**: Punctuation-only (`!@#$%^&*()`), whitespace variations (leading/trailing/multiple consecutive spaces, tabs, newlines), Unicode, diacritics, PostgreSQL FTS operators (`&`, `|`, `!`, `:*`), and SQL injection patterns (`' OR '1'='1`).
  - **Pagination Parameters**: `limit` at 0, 1, 20 (default), 50 (max), 51 (over max), negative integers; `offset` at 0, 10, 1000+ (deep pagination), negative integers.
  - **Hierarchy Scopes**: Querying non-existent ancestor UUIDs, cross-tenant UUID injection, soft-deleted ancestors.
  - **Access & Roles**: Access evaluation at role transitions (VIEWER vs MEMBER vs ADMIN vs OWNER), removed group members, soft-deleted groups.
- **Coverage Goal**: At least **5 dedicated boundary/corner tests per feature area** ($\ge 110$ tests).

### 3.3 Tier 3: Cross-Feature Combinations (Pairwise Testing)
- **Methodology**: Pairwise (2-way combinatorial) testing systematically verifies that feature interactions operate without unexpected interference, state corruption, or ranking anomalies.
- **Target Interaction Matrices**:
  1. **Lexical + Semantic + RRF Ranking (Features 1, 5, 7, 10)**: Validates reciprocal rank fusion ($k=60$) blending when candidates appear in only lexical, only semantic, or both retrieval lists.
  2. **Hierarchy Scoping + Tenancy + Entity Filters (Features 12, 13, 16)**: Validates filtering when combining entity subsets (`types=["note", "material"]`) with parent scoping (`subjectId`, `chapterId`, `topicId`, `groupId`) across private vs shared boundaries.
  3. **Note Autosave + Plain-Text Extraction + Search Reflection (Features 6, 7, 1)**: Verifies that updating ProseMirror note blocks immediately updates searchable plain text, purges stale embeddings, and ensures new queries retrieve updated content.
  4. **Pagination Offset + Chunk Collapsing & Deduplication (Features 11, 16)**: Verifies that paginated retrieval across multi-chunk documents maintains stable ordering without duplicating parent entity records or splitting across pages.
- **Coverage Goal**: At least **22 pairwise interaction test cases**.

### 3.4 Tier 4: Real-World Workload Testing (Application Scenarios)
- **Methodology**: Workload testing simulates realistic user behavior through end-to-end multi-step flows mirroring real student and collaborator journeys.
- **5 Canonical Scenarios**:
  1. **Scenario 1 — Lecture Concept Deep Linking**: A student searches for "helicase replication fork" across notes and multi-page PDF lecture slides; verifies retrieval returns both Note and Material hits with deep links (`?page=2` for PDF slides and `?tab=notes` for topic notes).
  2. **Scenario 2 — Study Group Multi-Tenant Isolation**: Two students (Alice and Bob) in a shared study group search for shared course materials; verifies Alice's private notes and Bob's private notes remain invisible to each other, while shared group subjects and materials are retrieved symmetrically.
  3. **Scenario 3 — Command Palette Keyboard & Debounce Flow**: User opens command palette via `⌘K`, types rapidly (testing debounce and request cancellation via `AbortController`), navigates results via ArrowDown/ArrowUp, and selects an item via Enter.
  4. **Scenario 4 — Note Lifecycle & Invalidation**: User authoring a lecture note edits content; tests verify that updated terms are immediately searchable via lexical search, old vector representations are purged/re-indexed, and stale deleted content is completely inaccessible.
  5. **Scenario 5 — Adversarial Leakage & Snooping Probe**: Adversarial probe by unauthorized user Charlie attempting to infer title names, snippets, or entity counts of Alice's private materials or unjoined study groups via wildcard, single-character, and exact-match queries.

---

## 4. Feature Inventory to Test Mapping

| # | Feature Name | Description | Test File Location | Target Tier | Verification Criteria |
|---|--------------|-------------|-------------------|-------------|-----------------------|
| 1 | Core Entity Lexical Search | FTS across Subjects, Chapters, Topics, Materials, Notes, StudyGroups | `tier1-features/feat-01-core-lexical.test.ts` | Tier 1 | All 6 core entity types return valid hits on text match |
| 2 | FlashcardDeck Lexical Scope | Search FlashcardDeck titles within authorized workspaces/groups | `tier1-features/feat-02-flashcard-scope.test.ts` | Tier 1 | Decks match on title; cards themselves deferred |
| 3 | Quiz Scope Formal Decision | Explicit architectural exclusion of Quizzes from Phase 12 search | `tier1-features/feat-03-quiz-exclusion.test.ts` | Tier 1 | Quizzes never returned in hits or counts; `quiz` rejected as type |
| 4 | Text Normalization & FTS Syntax | Punctuation, whitespace, case normalization, and phrase support | `tier1-features/feat-04-text-normalization.test.ts` | Tier 1 | Case-insensitive, punctuation-stripped, and phrase queries match |
| 5 | Material Vector Reuse | Reuse existing `MaterialChunk.embedding` (1536d) without redundant vector columns | `tier1-features/feat-05-material-vector-reuse.test.ts` | Tier 1 | Material chunks queryable via vector cosine similarity |
| 6 | Note Plain-Text Extraction | Deterministic plain-text extraction from Tiptap/ProseMirror JSON blocks | `tier1-features/feat-06-note-plain-text.test.ts` | Tier 1 | JSON block content converted to clean search plain text |
| 7 | Note Embedding Lifecycle | Dedicated `NoteChunk` model, autosave hashing, no stale vectors | `tier1-features/feat-07-note-embedding-lifecycle.test.ts` | Tier 1 | Chunk creation, update with hash check, stale vector deletion |
| 8 | Vector HNSW Indexing | Implement pgvector HNSW index (`vector_cosine_ops`) over IVFFlat | `tier1-features/feat-08-hnsw-indexing.test.ts` | Tier 1 | Migration DDL and vector search compatibility verified |
| 9 | Expression GIN Indexing | Deploy expression GIN indexes across core entities via migration | `tier1-features/feat-09-gin-indexing.test.ts` | Tier 1 | GIN index migration DDL and tsvector generation verified |
| 10 | Unified RRF Ranking | Reciprocal Rank Fusion ($k=60$) blending lexical and semantic candidate ranks | `tier1-features/feat-10-rrf-ranking.test.ts` | Tier 1 | Score computed as $\sum \frac{1}{60 + r_i}$; dual matches rank highest |
| 11 | Chunk Collapsing & Deduplication | Deduplicate multiple chunks per Material/Note to top chunk | `tier1-features/feat-11-chunk-collapsing.test.ts` | Tier 1 | Each entity appears at most once with highest scoring chunk snippet |
| 12 | Hierarchy & Entity Filtering | Filter by entity types and Subject, Chapter, Topic, or Group scope | `tier1-features/feat-12-hierarchy-filtering.test.ts` | Tier 1 | Scoped queries restrict results strictly to specified ancestors |
| 13 | Pre-Filtered Server Authorization | Tenancy and active group predicates compiled into query filters | `tier1-features/feat-13-prefiltered-authorization.test.ts` | Tier 1 | Only personal workspace and active group items returned |
| 14 | Fail-Closed Hierarchy Soft Deletion | Exclude notes/materials under soft-deleted subjects/chapters/topics | `tier1-features/feat-14-soft-delete-fail-closed.test.ts` | Tier 1 | Items with deleted ancestors never appear in search results |
| 15 | Leakage Prevention | Strict isolation ensuring unauthorized content never appears in snippets or counts | `tier1-features/feat-15-leakage-prevention.test.ts` | Tier 1 | No title, snippet, metadata, or count leakage to unauthorized users |
| 16 | Authenticated Search API | Validated `GET /api/search` with Zod schema, pagination, mode selection | `tier1-features/feat-16-authenticated-api.test.ts` | Tier 1 | 401 on unauthenticated, 400 on invalid params, 200 with contract |
| 17 | Command Palette (`⌘K`) Upgrade | Fast modal search with `cmdk` `shouldFilter={false}`, debouncing, AbortController | `tier1-features/feat-17-command-palette.test.ts` | Tier 1 | Component renders, sends debounced queries, handles cancels |
| 18 | Dedicated `/search` Experience | Full search page with faceted entity filters, loading skeletons, empty states | `tier1-features/feat-18-search-page.test.ts` | Tier 1 | Full page renders facets, counts, pagination, and empty results |
| 19 | Contextual Snippets & Highlighting | 160-char sliding window with safe React `<HighlightedSnippet>` | `tier1-features/feat-19-contextual-snippets.test.ts` | Tier 1 | Snippet is $\le 160$ chars, centers on match, safe against XSS |
| 20 | Deep-Link Navigation Routing | Route to PDF page (`?page=`), audio timestamp (`?t=`), Note tab (`?tab=notes`) | `tier1-features/feat-20-deep-links.test.ts` | Tier 1 | Navigation URLs contain exact target query params |
| 21 | Comprehensive Test Validation | Unit, integration, authorization, regression, build, and typecheck | `tier1-features/feat-21-test-validation.test.ts` | Tier 1 | Automated verification of test coverage, typecheck, and build |
| 22 | Documentation & Roadmap Sync | Update `docs/ROADMAP.md`, `PROJECT_STATE.md`, Limitations Register | `tier1-features/feat-22-documentation-sync.test.ts` | Tier 1 | Documentation consistency and roadmap status verified |

---

## 5. Directory Layout & File Organization

```
tests/
└── e2e/
    └── search/
        ├── harness/                                  # Reusable Test Harness Infrastructure
        │   ├── fixtures.ts                           # Multi-tenant deterministic seed entities & vectors
        │   ├── mock-db-store.ts                      # In-memory mock Prisma store & access state
        │   ├── contracts.ts                          # Runtime type guards, schema validators & assertions
        │   ├── search-test-harness.ts                # Opaque HTTP/NextRequest dispatch client
        │   └── __tests__/
        │       └── harness.test.ts                   # Harness sanity & verification test suite
        │
        ├── tier1-features/                           # Tier 1: ≥5 tests per feature (Features 1–22)
        │   ├── feat-01-core-lexical.test.ts
        │   ├── feat-02-flashcard-scope.test.ts
        │   ├── feat-03-quiz-exclusion.test.ts
        │   ├── feat-04-text-normalization.test.ts
        │   ├── feat-05-material-vector-reuse.test.ts
        │   ├── feat-06-note-plain-text.test.ts
        │   ├── feat-07-note-embedding-lifecycle.test.ts
        │   ├── feat-08-hnsw-indexing.test.ts
        │   ├── feat-09-gin-indexing.test.ts
        │   ├── feat-10-rrf-ranking.test.ts
        │   ├── feat-11-chunk-collapsing.test.ts
        │   ├── feat-12-hierarchy-filtering.test.ts
        │   ├── feat-13-prefiltered-authorization.test.ts
        │   ├── feat-14-soft-delete-fail-closed.test.ts
        │   ├── feat-15-leakage-prevention.test.ts
        │   ├── feat-16-authenticated-api.test.ts
        │   ├── feat-17-command-palette.test.ts
        │   ├── feat-18-search-page.test.ts
        │   ├── feat-19-contextual-snippets.test.ts
        │   ├── feat-20-deep-links.test.ts
        │   ├── feat-21-test-validation.test.ts
        │   └── feat-22-documentation-sync.test.ts
        │
        ├── tier2-boundaries/                         # Tier 2: Boundary Value Analysis & Corner Cases
        │   ├── boundary-query-length.test.ts         # Lengths 0, 1, 2, 200, 201+, MAX_INT
        │   ├── boundary-special-characters.test.ts   # Punctuation, whitespace, Unicode, FTS operators, SQLi
        │   ├── boundary-pagination.test.ts           # limit (0, 1, 50, 51, neg), offset (0, 1000+, neg)
        │   ├── boundary-hierarchy-scopes.test.ts     # Malformed UUIDs, cross-tenant IDs, missing ancestors
        │   └── boundary-access-edges.test.ts         # Role boundaries (VIEWER/MEMBER), removed members, deleted groups
        │
        ├── tier3-interactions/                       # Tier 3: Pairwise Cross-Feature Interactions
        │   ├── pairwise-lexical-semantic.test.ts     # F1 + F5/F7 + F10 (Hybrid RRF ranking blending)
        │   ├── pairwise-filtering-modes.test.ts      # F12 + F16 (Mode selection + entity types + hierarchy filters)
        │   ├── pairwise-autosave-retrieval.test.ts   # F6 + F7 + F1 (Note PUT blocks -> search reflection & cleanup)
        │   └── pairwise-pagination-dedup.test.ts     # F11 + F16 (Pagination offsets under chunk collapsing)
        │
        └── tier4-scenarios/                          # Tier 4: Real-World Workload User Scenarios
            ├── scenario-1-lecture-deep-linking.test.ts
            ├── scenario-2-study-group-isolation.test.ts
            ├── scenario-3-command-palette-flow.test.ts
            ├── scenario-4-note-lifecycle-search.test.ts
            └── scenario-5-adversarial-leakage.test.ts
```

---

## 6. Authoritative Interface Contracts

All tests validate responses against the authoritative contracts defined in `PROJECT.md § Interface Contracts`:

### 6.1 Search API Request Contract (`GET /api/search`)
- `q`: string, trimmed, length $\in [2, 200]$ (required).
- `mode`: `"hybrid" | "lexical" | "semantic"` (optional, default: `"hybrid"`).
- `types`: array or comma-separated string of `"subject" | "chapter" | "topic" | "material" | "note" | "group" | "flashcard"`. (`"quiz"` is forbidden).
- `groupId?`, `subjectId?`, `chapterId?`, `topicId?`: valid UUID strings.
- `limit`: integer $\in [1, 50]$ (optional, default: 20).
- `offset`: integer $\ge 0$ (optional, default: 0).

### 6.2 Search API Response Contract (`SearchApiResponse`)
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

## 7. Test Runner Commands

All test execution commands are standardized for Windows PowerShell:

### 7.1 Harness Verification (Sanity Test)
```powershell
npx.cmd vitest run tests/e2e/search/harness
```

### 7.2 Full E2E Test Suite Execution
```powershell
npx.cmd vitest run tests/e2e/search
```

### 7.3 Tier-Specific Execution Commands
```powershell
# Tier 1: Feature Coverage Suites
npx.cmd vitest run tests/e2e/search/tier1-features

# Tier 2: Boundary & Corner Cases Suites
npx.cmd vitest run tests/e2e/search/tier2-boundaries

# Tier 3: Pairwise Cross-Feature Suites
npx.cmd vitest run tests/e2e/search/tier3-interactions

# Tier 4: Real-World Scenarios Suites
npx.cmd vitest run tests/e2e/search/tier4-scenarios
```

### 7.4 TypeScript Typecheck & Build Verification
```powershell
# Verify TypeScript strict compilation across all test and source files
npm.cmd run typecheck

# Verify linting
npm.cmd run lint
```

---

## 8. Quantitative Coverage Targets

| Test Tier | Description | Minimum Tests | Target Files |
|-----------|-------------|---------------|--------------|
| **Harness Sanity** | Fixtures, mock DB store, contracts, validators | $\ge 10$ | 1 file |
| **Tier 1** | Feature Coverage ($\ge 5$ per feature across 22 features) | $\ge 110$ | 22 files |
| **Tier 2** | Boundaries & Corner Cases ($\ge 5$ per area across 5 files) | $\ge 110$ | 5 files |
| **Tier 3** | Cross-Feature Combinations (Pairwise matrices) | $\ge 22$ | 4 files |
| **Tier 4** | Real-World Workload Scenarios (5 flows, multi-assertion) | $\ge 5$ | 5 files |
| **Total** | **Comprehensive E2E Search Test Suite** | **$\ge 257$ tests** | **37 files** |
