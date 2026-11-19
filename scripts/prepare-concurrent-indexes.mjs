#!/usr/bin/env node
/**
 * LIM-09 Operational Helper — Zero-Downtime Concurrent Index Preparation, Semantic Parity & Recovery
 *
 * Inventory of Phase 12–15 Migration Indexes:
 * - Total `CREATE [UNIQUE] INDEX` statements across Phases 12–15 migrations: 23
 *   - 4 inline indexes on brand-new empty tables created in the same migration:
 *     - `NoteChunk_noteId_idx` (Phase 12, `CREATE TABLE "NoteChunk"`)
 *     - `BillingWebhookEvent_externalEventId_key`, `BillingWebhookEvent_userId_idx`,
 *       `BillingWebhookEvent_eventType_idx` (Phase 15, `CREATE TABLE "BillingWebhookEvent"`)
 *   - 19 `IF NOT EXISTS` indexes tracked in `CONCURRENT_INDEX_MANIFEST`:
 *     - 12 `pre_migrate` indexes across 11 pre-existing tables (`MaterialChunk`, `Subject`,
 *       `Chapter`, `Topic`, `Material`, `Group`, `FlashcardDeck`, `Flashcard`,
 *       `FlashcardReview` [2 indexes], `ProcessingJob`, `Subscription`): target tables AND
 *       columns already exist prior to Phases 12–15, so `buildPreMigrationConcurrentSql()`
 *       can pre-create all 12 concurrently before `npx prisma migrate deploy` runs.
 *     - 7 `in_migration_or_post_column` indexes (`idx_note_chunk_embedding_hnsw`,
 *       `idx_note_search_fts`, `FlashcardReview_userId_idempotencyKey_key`,
 *       `FlashcardReview_userId_dueAt_idx`, `ConnectedAccount_watchChannelId_key`,
 *       `ConnectedAccount_watchExpiresAt_idx`, `Subscription_externalSubscriptionId_key`):
 *       target a column (`Note.plainText`, `FlashcardReview.idempotencyKey`, `FlashcardReview.dueAt`,
 *       `ConnectedAccount.watchChannelId`, `ConnectedAccount.watchExpiresAt`,
 *       `Subscription.externalSubscriptionId`) or table (`NoteChunk`) added by the Phase 12–15
 *       migration itself. They cannot be built before their column/table exists; operators can
 *       either pre-apply the idempotent `ADD COLUMN IF NOT EXISTS` statements (`--include-post-column`)
 *       or build/recover them via `buildPostColumnConcurrentSql()` / `buildIndexRecoverySql()`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONCURRENT_INDEX_MANIFEST = [
  // Phase 12 — Search Indexing (7 pre_migrate indexes on pre-existing tables/columns)
  {
    name: "idx_material_chunk_embedding_hnsw",
    migration: "20261110090000_phase12_search_indexing",
    table: "MaterialChunk",
    accessMethod: "hnsw",
    phase: "pre_migrate",
    unique: false,
    columns: ["embedding"],
    operatorClass: "vector_cosine_ops",
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_material_chunk_embedding_hnsw" ON "MaterialChunk" USING hnsw ("embedding" vector_cosine_ops);`,
  },
  {
    name: "idx_subject_search_fts",
    migration: "20261110090000_phase12_search_indexing",
    table: "Subject",
    accessMethod: "gin",
    phase: "pre_migrate",
    unique: false,
    columns: ["name", "description"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_subject_search_fts" ON "Subject" USING gin ((setweight(to_tsvector('english', coalesce("name", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B')));`,
  },
  {
    name: "idx_chapter_search_fts",
    migration: "20261110090000_phase12_search_indexing",
    table: "Chapter",
    accessMethod: "gin",
    phase: "pre_migrate",
    unique: false,
    columns: ["name", "description"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_chapter_search_fts" ON "Chapter" USING gin ((setweight(to_tsvector('english', coalesce("name", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B')));`,
  },
  {
    name: "idx_topic_search_fts",
    migration: "20261110090000_phase12_search_indexing",
    table: "Topic",
    accessMethod: "gin",
    phase: "pre_migrate",
    unique: false,
    columns: ["name", "description"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_topic_search_fts" ON "Topic" USING gin ((setweight(to_tsvector('english', coalesce("name", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B')));`,
  },
  {
    name: "idx_material_search_fts",
    migration: "20261110090000_phase12_search_indexing",
    table: "Material",
    accessMethod: "gin",
    phase: "pre_migrate",
    unique: false,
    columns: ["title", "originalFilename", "extractedText"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_material_search_fts" ON "Material" USING gin ((setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("originalFilename", '')), 'B') || setweight(to_tsvector('english', coalesce("extractedText", '')), 'C')));`,
  },
  {
    name: "idx_group_search_fts",
    migration: "20261110090000_phase12_search_indexing",
    table: "Group",
    accessMethod: "gin",
    phase: "pre_migrate",
    unique: false,
    columns: ["name", "description"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_group_search_fts" ON "Group" USING gin ((setweight(to_tsvector('english', coalesce("name", '')), 'A') || setweight(to_tsvector('english', coalesce("description", '')), 'B')));`,
  },
  {
    name: "idx_flashcard_deck_search_fts",
    migration: "20261110090000_phase12_search_indexing",
    table: "FlashcardDeck",
    accessMethod: "gin",
    phase: "pre_migrate",
    unique: false,
    columns: ["title"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_flashcard_deck_search_fts" ON "FlashcardDeck" USING gin ((setweight(to_tsvector('english', coalesce("title", '')), 'A')));`,
  },
  // Phase 12 — 2 indexes on new table/column introduced in Phase 12
  {
    name: "idx_note_chunk_embedding_hnsw",
    migration: "20261110090000_phase12_search_indexing",
    table: "NoteChunk",
    accessMethod: "hnsw",
    phase: "in_migration_or_post_column",
    unique: false,
    columns: ["embedding"],
    operatorClass: "vector_cosine_ops",
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_note_chunk_embedding_hnsw" ON "NoteChunk" USING hnsw ("embedding" vector_cosine_ops);`,
  },
  {
    name: "idx_note_search_fts",
    migration: "20261110090000_phase12_search_indexing",
    table: "Note",
    accessMethod: "gin",
    phase: "in_migration_or_post_column",
    unique: false,
    columns: ["title", "plainText"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_note_search_fts" ON "Note" USING gin ((setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("plainText", '')), 'B')));`,
  },
  // Phase 13 — Intelligent Study System (3 pre_migrate + 2 in_migration_or_post_column)
  {
    name: "idx_flashcard_search_fts",
    migration: "20261111180000_phase13_intelligent_study_system",
    table: "Flashcard",
    accessMethod: "gin",
    phase: "pre_migrate",
    unique: false,
    columns: ["front", "back"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_flashcard_search_fts" ON "Flashcard" USING gin ((setweight(to_tsvector('english', coalesce("front", '')), 'B') || setweight(to_tsvector('english', coalesce("back", '')), 'C')));`,
  },
  {
    name: "FlashcardReview_userId_reviewedAt_idx",
    migration: "20261111180000_phase13_intelligent_study_system",
    table: "FlashcardReview",
    accessMethod: "btree",
    phase: "pre_migrate",
    unique: false,
    columns: ["userId", "reviewedAt"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "FlashcardReview_userId_reviewedAt_idx" ON "FlashcardReview"("userId", "reviewedAt");`,
  },
  {
    name: "FlashcardReview_userId_flashcardId_reviewedAt_idx",
    migration: "20261111180000_phase13_intelligent_study_system",
    table: "FlashcardReview",
    accessMethod: "btree",
    phase: "pre_migrate",
    unique: false,
    columns: ["userId", "flashcardId", "reviewedAt"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "FlashcardReview_userId_flashcardId_reviewedAt_idx" ON "FlashcardReview"("userId", "flashcardId", "reviewedAt");`,
  },
  {
    name: "FlashcardReview_userId_idempotencyKey_key",
    migration: "20261111180000_phase13_intelligent_study_system",
    table: "FlashcardReview",
    accessMethod: "btree",
    phase: "in_migration_or_post_column",
    unique: true,
    columns: ["userId", "idempotencyKey"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "FlashcardReview_userId_idempotencyKey_key" ON "FlashcardReview"("userId", "idempotencyKey");`,
  },
  {
    name: "FlashcardReview_userId_dueAt_idx",
    migration: "20261111180000_phase13_intelligent_study_system",
    table: "FlashcardReview",
    accessMethod: "btree",
    phase: "in_migration_or_post_column",
    unique: false,
    columns: ["userId", "dueAt"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "FlashcardReview_userId_dueAt_idx" ON "FlashcardReview"("userId", "dueAt");`,
  },
  // Phase 14 — Google Drive Sync (2 in_migration_or_post_column indexes)
  {
    name: "ConnectedAccount_watchChannelId_key",
    migration: "20261112223000_phase14_google_drive_sync_and_slides",
    table: "ConnectedAccount",
    accessMethod: "btree",
    phase: "in_migration_or_post_column",
    unique: true,
    columns: ["watchChannelId"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ConnectedAccount_watchChannelId_key" ON "ConnectedAccount"("watchChannelId");`,
  },
  {
    name: "ConnectedAccount_watchExpiresAt_idx",
    migration: "20261112223000_phase14_google_drive_sync_and_slides",
    table: "ConnectedAccount",
    accessMethod: "btree",
    phase: "in_migration_or_post_column",
    unique: false,
    columns: ["watchExpiresAt"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "ConnectedAccount_watchExpiresAt_idx" ON "ConnectedAccount"("watchExpiresAt");`,
  },
  // Phase 15 — Durable Jobs & Billing (2 pre_migrate + 1 in_migration_or_post_column)
  {
    name: "ProcessingJob_status_createdAt_idx",
    migration: "20261113210000_phase15_durable_jobs_and_billing",
    table: "ProcessingJob",
    accessMethod: "btree",
    phase: "pre_migrate",
    unique: false,
    columns: ["status", "createdAt"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProcessingJob_status_createdAt_idx" ON "ProcessingJob"("status", "createdAt");`,
  },
  {
    name: "Subscription_externalCustomerId_idx",
    migration: "20261113210000_phase15_durable_jobs_and_billing",
    table: "Subscription",
    accessMethod: "btree",
    phase: "pre_migrate",
    unique: false,
    columns: ["externalCustomerId"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Subscription_externalCustomerId_idx" ON "Subscription"("externalCustomerId");`,
  },
  {
    name: "Subscription_externalSubscriptionId_key",
    migration: "20261113210000_phase15_durable_jobs_and_billing",
    table: "Subscription",
    accessMethod: "btree",
    phase: "in_migration_or_post_column",
    unique: true,
    columns: ["externalSubscriptionId"],
    operatorClass: null,
    wherePredicate: null,
    includeColumns: null,
    concurrentSql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Subscription_externalSubscriptionId_key" ON "Subscription"("externalSubscriptionId");`,
  },
];

/**
 * Normalizes SQL whitespace outside single/double quotes and parentheses for
 * deterministic semantic comparison between `concurrentSql` and `migration.sql`.
 */
export function normalizeSqlFragment(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/--[^\r\n]*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\|\|\s*/g, " || ")
    .replace(/;\s*$/, "")
    .trim();
}

/**
 * Parses a PostgreSQL `CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] ...`
 * statement into its structured semantic components:
 *   - name, table, unique, concurrent, ifNotExists, accessMethod
 *   - keyExpression (columns/expressions, operator classes, sort direction)
 *   - includeColumns (`INCLUDE (...)` if present)
 *   - wherePredicate (`WHERE ...` partial-index predicate if present)
 */
export function parseCreateIndexStatement(rawStmt) {
  const cleaned = String(rawStmt)
    .replace(/--[^\r\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;\s*$/, "");

  const headerRe =
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\s+ON\s+"([^"]+)"(?:\s+USING\s+([A-Za-z0-9_]+))?\s*\(/i;
  const match = cleaned.match(headerRe);
  if (!match) {
    return null;
  }

  const unique = Boolean(match[1]);
  const concurrent = Boolean(match[2]);
  const ifNotExists = Boolean(match[3]);
  const name = match[4];
  const table = match[5];
  const accessMethod = (match[6] || "btree").toLowerCase();

  // Find the balanced closing parenthesis for the ON (...) key expression
  const openParenIdx = match[0].length - 1;
  let depth = 0;
  let closeParenIdx = -1;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = openParenIdx; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        closeParenIdx = i;
        break;
      }
    }
  }

  if (closeParenIdx < 0) return null;

  const rawKeyExpr = cleaned.slice(openParenIdx + 1, closeParenIdx);
  let tail = cleaned.slice(closeParenIdx + 1).trim();

  let includeColumns = null;
  const includeMatch = tail.match(/^INCLUDE\s*\(([^)]+)\)\s*(.*)$/i);
  if (includeMatch) {
    includeColumns = normalizeSqlFragment(includeMatch[1]);
    tail = (includeMatch[2] || "").trim();
  }

  let wherePredicate = null;
  const whereMatch = tail.match(/^WHERE\s+(.+)$/i);
  if (whereMatch) {
    wherePredicate = normalizeSqlFragment(whereMatch[1]);
  }

  const keyExpression = normalizeSqlFragment(rawKeyExpr);
  const operatorClasses = [];
  for (const opMatch of keyExpression.matchAll(/\b(vector_cosine_ops|vector_l2_ops|vector_ip_ops|[a-z0-9_]+_ops)\b/gi)) {
    operatorClasses.push(opMatch[1].toLowerCase());
  }
  const sortOrders = [];
  for (const sortMatch of keyExpression.matchAll(/\b(ASC|DESC|NULLS\s+FIRST|NULLS\s+LAST)\b/gi)) {
    sortOrders.push(sortMatch[1].replace(/\s+/g, " ").toUpperCase());
  }

  return {
    name,
    table,
    unique,
    concurrent,
    ifNotExists,
    accessMethod,
    keyExpression,
    operatorClasses,
    sortOrders,
    includeColumns,
    wherePredicate,
  };
}

/**
 * Extracts a specific `CREATE [UNIQUE] INDEX ... "<indexName>" ...;` statement
 * from a migration SQL file.
 */
export function extractIndexStatementFromMigrationSql(migrationSql, indexName) {
  const escaped = indexName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?"${escaped}"[\\s\\S]*?;`,
    "i"
  );
  const match = String(migrationSql).match(re);
  return match ? match[0] : null;
}

/**
 * Generates the out-of-band SQL script to pre-build all `pre_migrate` indexes
 * (or all 19 indexes when `includePostColumn: true`) concurrently.
 * Must be executed via `psql` WITHOUT `--single-transaction` (`-1`).
 */
export function buildPreMigrationConcurrentSql(options = {}) {
  const includePostColumn = Boolean(options.includePostColumn);
  const items = includePostColumn
    ? CONCURRENT_INDEX_MANIFEST
    : CONCURRENT_INDEX_MANIFEST.filter((item) => item.phase === "pre_migrate");
  const lines = [
    "-- ============================================================================",
    "-- Zenote LIM-09 Pre-Migration Concurrent Index Preparation Script",
    "-- IMPORTANT: Run via psql WITHOUT -1 / --single-transaction.",
    "-- CREATE INDEX CONCURRENTLY cannot execute inside a transaction block.",
    "-- ============================================================================",
    "SET statement_timeout = '0';",
    "SET lock_timeout = '5s';",
    "",
  ];
  for (const item of items) {
    lines.push(`-- [${item.migration}] ${item.table}.${item.name} (${item.accessMethod.toUpperCase()})`);
    lines.push(item.concurrentSql);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Generates the concurrent index creation SQL for the 7 `in_migration_or_post_column`
 * indexes (whose columns/tables are introduced in Phases 12–15).
 */
export function buildPostColumnConcurrentSql() {
  const postItems = CONCURRENT_INDEX_MANIFEST.filter(
    (item) => item.phase === "in_migration_or_post_column"
  );
  const lines = [
    "-- ============================================================================",
    "-- Zenote LIM-09 Post-Column / New-Column Concurrent Index Script (7 Indexes)",
    "-- Run outside a transaction after the target columns/tables exist.",
    "-- ============================================================================",
    "SET statement_timeout = '0';",
    "SET lock_timeout = '5s';",
    "",
  ];
  for (const item of postItems) {
    lines.push(`-- [${item.migration}] ${item.table}.${item.name} (${item.accessMethod.toUpperCase()})`);
    lines.push(item.concurrentSql);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Generates the SQL query that detects any invalid (`indisvalid = false`) or
 * not-ready (`indisready = false`) indexes left behind by an interrupted
 * `CREATE INDEX CONCURRENTLY` operation.
 */
export function buildInvalidIndexCheckSql() {
  const quotedNames = CONCURRENT_INDEX_MANIFEST.map((i) => `'${i.name}'`).join(", ");
  return [
    "-- Detect any invalid or unready indexes in pg_index (must return 0 rows before and after migrate deploy):",
    "SELECT",
    "  c.relname AS index_name,",
    "  t.relname AS table_name,",
    "  i.indisvalid AS is_valid,",
    "  i.indisready AS is_ready",
    "FROM pg_index i",
    "JOIN pg_class c ON c.oid = i.indexrelid",
    "JOIN pg_class t ON t.oid = i.indrelid",
    "JOIN pg_namespace n ON n.oid = c.relnamespace",
    "WHERE n.nspname = current_schema()",
    `  AND c.relname IN (${quotedNames})`,
    "  AND (i.indisvalid = false OR i.indisready = false)",
    "ORDER BY c.relname;",
  ].join("\n");
}

/**
 * Generates a SQL query to check for duplicate non-null key tuples that would prevent
 * a `UNIQUE` index in `CONCURRENT_INDEX_MANIFEST` from building cleanly.
 */
export function buildUniqueDuplicateCheckSql(indexName) {
  const entry = CONCURRENT_INDEX_MANIFEST.find((item) => item.name === indexName);
  if (!entry) {
    throw new Error(`Unknown index in CONCURRENT_INDEX_MANIFEST: ${indexName}`);
  }
  if (!entry.unique) {
    throw new Error(`Index ${indexName} is not a UNIQUE index.`);
  }
  const quotedCols = entry.columns.map((c) => `"${c}"`).join(", ");
  const notNullPredicates = entry.columns.map((c) => `"${c}" IS NOT NULL`).join(" AND ");
  return [
    `-- Detect duplicate key tuples blocking unique index "${entry.name}" on "${entry.table}":`,
    `SELECT ${quotedCols}, COUNT(*) AS duplicate_count`,
    `FROM "${entry.table}"`,
    `WHERE ${notNullPredicates}`,
    `GROUP BY ${quotedCols}`,
    `HAVING COUNT(*) > 1;`,
  ].join("\n");
}

/**
 * Generates repeatable recovery SQL for a specific failed concurrent index (`indisvalid = false`).
 */
export function buildIndexRecoverySql(indexName) {
  const entry = CONCURRENT_INDEX_MANIFEST.find((item) => item.name === indexName);
  if (!entry) {
    throw new Error(`Unknown index in CONCURRENT_INDEX_MANIFEST: ${indexName}`);
  }
  const lines = [
    `-- Recovery for invalid concurrent index "${entry.name}" on "${entry.table}"`,
    "SET statement_timeout = '0';",
    "SET lock_timeout = '5s';",
  ];
  if (entry.unique) {
    lines.push(
      `-- NOTE: If recovery fails with SQLSTATE 23505 (unique_violation), inspect duplicates first:`
    );
    for (const dupLine of buildUniqueDuplicateCheckSql(indexName).split("\n")) {
      lines.push(`--   ${dupLine}`);
    }
  }
  lines.push(`DROP INDEX CONCURRENTLY IF EXISTS "${entry.name}";`);
  lines.push(entry.concurrentSql);
  return lines.join("\n");
}

/**
 * Verifies that every index in `CONCURRENT_INDEX_MANIFEST` exists in the corresponding
 * Prisma migration SQL file with `IF NOT EXISTS` AND matches full semantic parity:
 *   - index name
 *   - target table
 *   - uniqueness (`UNIQUE`)
 *   - access method (`btree`, `gin`, `hnsw`)
 *   - normalized indexed columns / expressions
 *   - operator classes (`vector_cosine_ops`, etc.)
 *   - sort orders (`ASC`/`DESC`)
 *   - `INCLUDE` columns and partial-index `WHERE` predicates
 */
export function verifyMigrationIndexIdempotency(
  migrationsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations")
) {
  const errors = [];
  for (const item of CONCURRENT_INDEX_MANIFEST) {
    const dirName = item.migrationDir ?? item.migration;
    const sqlPath = path.join(migrationsRoot, dirName, "migration.sql");
    if (!fs.existsSync(sqlPath)) {
      errors.push(`Missing migration SQL file for ${item.name}: ${sqlPath}`);
      continue;
    }
    const sql = fs.readFileSync(sqlPath, "utf8");
    const rawMigrationStmt = extractIndexStatementFromMigrationSql(sql, item.name);
    if (!rawMigrationStmt) {
      errors.push(`Index ${item.name} not found in ${dirName}/migration.sql`);
      continue;
    }

    const parsedConcurrent = parseCreateIndexStatement(item.concurrentSql);
    const parsedMigration = parseCreateIndexStatement(rawMigrationStmt);

    if (!parsedConcurrent) {
      errors.push(`Failed to parse concurrentSql for ${item.name}: ${item.concurrentSql}`);
      continue;
    }
    if (!parsedMigration) {
      errors.push(`Failed to parse migration SQL statement for ${item.name}: ${rawMigrationStmt}`);
      continue;
    }

    if (!parsedConcurrent.concurrent) {
      errors.push(`concurrentSql for ${item.name} must specify CONCURRENTLY.`);
    }
    if (parsedMigration.concurrent) {
      errors.push(`Migration SQL for ${item.name} in ${dirName}/migration.sql must not specify CONCURRENTLY.`);
    }
    if (!parsedConcurrent.ifNotExists || !parsedMigration.ifNotExists) {
      errors.push(
        `Index ${item.name} in ${dirName}/migration.sql and manifest must both specify IF NOT EXISTS.`
      );
    }
    if (parsedConcurrent.name !== item.name || parsedMigration.name !== item.name) {
      errors.push(`Index name mismatch for ${item.name}.`);
    }
    if (parsedConcurrent.table !== item.table || parsedMigration.table !== item.table) {
      errors.push(
        `Table mismatch for ${item.name}: manifest=${item.table}, concurrent=${parsedConcurrent.table}, migration=${parsedMigration.table}`
      );
    }
    if (parsedConcurrent.unique !== item.unique || parsedMigration.unique !== item.unique) {
      errors.push(
        `Uniqueness mismatch for ${item.name}: manifest=${item.unique}, concurrent=${parsedConcurrent.unique}, migration=${parsedMigration.unique}`
      );
    }
    if (
      parsedConcurrent.accessMethod !== item.accessMethod ||
      parsedMigration.accessMethod !== item.accessMethod
    ) {
      errors.push(
        `Access method mismatch for ${item.name}: manifest=${item.accessMethod}, concurrent=${parsedConcurrent.accessMethod}, migration=${parsedMigration.accessMethod}`
      );
    }
    if (parsedConcurrent.keyExpression !== parsedMigration.keyExpression) {
      errors.push(
        `Key/expression mismatch for ${item.name}:\n  concurrent: ${parsedConcurrent.keyExpression}\n  migration:  ${parsedMigration.keyExpression}`
      );
    }
    if (
      JSON.stringify(parsedConcurrent.operatorClasses) !==
      JSON.stringify(parsedMigration.operatorClasses)
    ) {
      errors.push(
        `Operator class mismatch for ${item.name}: concurrent=${parsedConcurrent.operatorClasses.join(",")}, migration=${parsedMigration.operatorClasses.join(",")}`
      );
    }
    if (
      JSON.stringify(parsedConcurrent.sortOrders) !== JSON.stringify(parsedMigration.sortOrders)
    ) {
      errors.push(
        `Sort order mismatch for ${item.name}: concurrent=${parsedConcurrent.sortOrders.join(",")}, migration=${parsedMigration.sortOrders.join(",")}`
      );
    }
    if (parsedConcurrent.includeColumns !== parsedMigration.includeColumns) {
      errors.push(
        `INCLUDE clause mismatch for ${item.name}: concurrent=${parsedConcurrent.includeColumns}, migration=${parsedMigration.includeColumns}`
      );
    }
    if (parsedConcurrent.wherePredicate !== parsedMigration.wherePredicate) {
      errors.push(
        `Partial-index WHERE predicate mismatch for ${item.name}: concurrent=${parsedConcurrent.wherePredicate}, migration=${parsedMigration.wherePredicate}`
      );
    }
  }
  return {
    valid: errors.length === 0,
    checkedCount: CONCURRENT_INDEX_MANIFEST.length,
    preMigrateCount: CONCURRENT_INDEX_MANIFEST.filter((i) => i.phase === "pre_migrate").length,
    postColumnCount: CONCURRENT_INDEX_MANIFEST.filter(
      (i) => i.phase === "in_migration_or_post_column"
    ).length,
    errors,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const rawArgs = process.argv.slice(2);
  const args = new Set(rawArgs);

  if (args.has("--verify")) {
    const result = verifyMigrationIndexIdempotency();
    if (!result.valid) {
      console.error("[LIM-09] Migration index semantic parity & idempotency check FAILED:");
      for (const err of result.errors) console.error(`  - ${err}`);
      process.exit(1);
    }
    console.log(
      `[LIM-09] Verified ${result.checkedCount} migration indexes (${result.preMigrateCount} pre_migrate across 11 existing tables + ${result.postColumnCount} post_column) match exact semantic parity and IF NOT EXISTS idempotency.`
    );
    process.exit(0);
  }

  if (args.has("--check-invalid-sql")) {
    console.log(buildInvalidIndexCheckSql());
    process.exit(0);
  }

  const recoverIdxFlag = rawArgs.indexOf("--recover-index");
  if (recoverIdxFlag >= 0) {
    const targetName = rawArgs[recoverIdxFlag + 1];
    if (!targetName) {
      console.error("Usage: node scripts/prepare-concurrent-indexes.mjs --recover-index <indexName>");
      process.exit(1);
    }
    console.log(buildIndexRecoverySql(targetName));
    process.exit(0);
  }

  const dupIdxFlag = rawArgs.indexOf("--check-duplicates");
  if (dupIdxFlag >= 0) {
    const targetName = rawArgs[dupIdxFlag + 1];
    if (!targetName) {
      console.error("Usage: node scripts/prepare-concurrent-indexes.mjs --check-duplicates <uniqueIndexName>");
      process.exit(1);
    }
    console.log(buildUniqueDuplicateCheckSql(targetName));
    process.exit(0);
  }

  if (args.has("--post-column-only")) {
    console.log(buildPostColumnConcurrentSql());
    process.exit(0);
  }

  const includePostColumn = args.has("--include-post-column") || args.has("--include-new-tables") || args.has("--all");
  console.log(buildPreMigrationConcurrentSql({ includePostColumn }));
  console.log("");
  console.log(buildInvalidIndexCheckSql());
}
