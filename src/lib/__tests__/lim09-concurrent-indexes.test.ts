import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertIsolatedTestDatabaseConfig,
  resolveIsolatedTestDatabaseUrl,
  verifyLiveIsolatedDatabaseIdentity,
} from "@/lib/testing/isolated-db-guard";
// @ts-expect-error -- .mjs operational helper module
import * as lim09 from "../../../scripts/prepare-concurrent-indexes.mjs";

const rootDir = process.cwd();
const isolatedUrl = resolveIsolatedTestDatabaseUrl();
const hasIsolatedTestDb = Boolean(isolatedUrl);

describe("LIM-09 Concurrent Index Tooling — Hermetic Semantic Parity & Recovery Contracts", () => {
  it("accounts for all 19 manifest indexes (12 pre_migrate across 11 existing tables + 7 post_column) and 4 inline new-table indexes", () => {
    const manifest = lim09.CONCURRENT_INDEX_MANIFEST as Array<{
      name: string;
      migration: string;
      table: string;
      accessMethod: string;
      phase: string;
      unique: boolean;
      columns: string[];
      operatorClass: string | null;
      concurrentSql: string;
    }>;

    expect(manifest).toHaveLength(19);

    const preMigrate = manifest.filter((i) => i.phase === "pre_migrate");
    const postColumn = manifest.filter((i) => i.phase === "in_migration_or_post_column");
    expect(preMigrate).toHaveLength(12);
    expect(postColumn).toHaveLength(7);

    // The 12 pre_migrate indexes span exactly 11 pre-existing tables
    // (FlashcardReview has 2 pre_migrate indexes).
    const preMigrateTables = new Set(preMigrate.map((i) => i.table));
    expect(preMigrateTables.size).toBe(11);
    expect([...preMigrateTables].sort()).toEqual([
      "Chapter",
      "Flashcard",
      "FlashcardDeck",
      "FlashcardReview",
      "Group",
      "Material",
      "MaterialChunk",
      "ProcessingJob",
      "Subject",
      "Subscription",
      "Topic",
    ]);

    // Verify the 7 post_column indexes are the exact ones referencing columns/tables added in Phases 12-15
    expect(postColumn.map((i) => i.name)).toEqual([
      "idx_note_chunk_embedding_hnsw",
      "idx_note_search_fts",
      "FlashcardReview_userId_idempotencyKey_key",
      "FlashcardReview_userId_dueAt_idx",
      "ConnectedAccount_watchChannelId_key",
      "ConnectedAccount_watchExpiresAt_idx",
      "Subscription_externalSubscriptionId_key",
    ]);
  });

  it("verifies full semantic parity (name, table, uniqueness, accessMethod, columns/expressions, operatorClass, sortOrder, INCLUDE, WHERE) across all 19 Phase 12-15 indexes", () => {
    const check = lim09.verifyMigrationIndexIdempotency();
    expect(check.valid).toBe(true);
    expect(check.checkedCount).toBe(19);
    expect(check.preMigrateCount).toBe(12);
    expect(check.postColumnCount).toBe(7);
    expect(check.errors).toEqual([]);
  });

  it("parses complex CREATE INDEX statements including HNSW operator classes, GIN expressions, sort orders, INCLUDE columns, and partial WHERE predicates", () => {
    const hnswParsed = lim09.parseCreateIndexStatement(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_material_chunk_embedding_hnsw" ON "MaterialChunk" USING hnsw ("embedding" vector_cosine_ops);`
    );
    expect(hnswParsed).toMatchObject({
      name: "idx_material_chunk_embedding_hnsw",
      table: "MaterialChunk",
      unique: false,
      concurrent: true,
      ifNotExists: true,
      accessMethod: "hnsw",
      keyExpression: `"embedding" vector_cosine_ops`,
      operatorClasses: ["vector_cosine_ops"],
      includeColumns: null,
      wherePredicate: null,
    });

    const partialUniqueParsed = lim09.parseCreateIndexStatement(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_custom_partial" ON "GroupInvitation" ("groupId", "email" DESC) INCLUDE ("token") WHERE "status" = 'PENDING';`
    );
    expect(partialUniqueParsed).toMatchObject({
      name: "idx_custom_partial",
      table: "GroupInvitation",
      unique: true,
      concurrent: false,
      ifNotExists: true,
      accessMethod: "btree",
      keyExpression: `"groupId", "email" DESC`,
      sortOrders: ["DESC"],
      includeColumns: `"token"`,
      wherePredicate: `"status" = 'PENDING'`,
    });
  });

  it("detects semantic drift when a migration SQL statement diverges from the manifest on table, uniqueness, expression, operator class, or predicate", () => {
    const tmpMigrationsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zenote-lim09-drift-"));
    try {
      const realMigrationsRoot = path.resolve(rootDir, "prisma/migrations");
      for (const dir of [
        "20261110090000_phase12_search_indexing",
        "20261111180000_phase13_intelligent_study_system",
        "20261112223000_phase14_google_drive_sync_and_slides",
        "20261113210000_phase15_durable_jobs_and_billing",
      ]) {
        const destDir = path.join(tmpMigrationsRoot, dir);
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(
          path.join(realMigrationsRoot, dir, "migration.sql"),
          path.join(destDir, "migration.sql")
        );
      }

      // Mutate operator class and column in Phase 12 migration copy
      const p12Path = path.join(
        tmpMigrationsRoot,
        "20261110090000_phase12_search_indexing",
        "migration.sql"
      );
      const originalP12 = fs.readFileSync(p12Path, "utf8");
      fs.writeFileSync(
        p12Path,
        originalP12.replace("vector_cosine_ops", "vector_l2_ops"),
        "utf8"
      );

      const driftResult = lim09.verifyMigrationIndexIdempotency(tmpMigrationsRoot);
      expect(driftResult.valid).toBe(false);
      expect(driftResult.errors.some((e: string) => e.includes("idx_material_chunk_embedding_hnsw"))).toBe(true);
    } finally {
      fs.rmSync(tmpMigrationsRoot, { recursive: true, force: true });
    }
  });

  it("generates duplicate-key inspection SQL and repeatable recovery SQL for unique and non-unique indexes", () => {
    const dupSql = lim09.buildUniqueDuplicateCheckSql("FlashcardReview_userId_idempotencyKey_key");
    expect(dupSql).toContain(`SELECT "userId", "idempotencyKey", COUNT(*) AS duplicate_count`);
    expect(dupSql).toContain(`FROM "FlashcardReview"`);
    expect(dupSql).toContain(`WHERE "userId" IS NOT NULL AND "idempotencyKey" IS NOT NULL`);
    expect(dupSql).toContain(`HAVING COUNT(*) > 1;`);

    expect(() => lim09.buildUniqueDuplicateCheckSql("idx_subject_search_fts")).toThrow(
      /not a UNIQUE index/i
    );

    const uniqueRecovery = lim09.buildIndexRecoverySql("FlashcardReview_userId_idempotencyKey_key");
    expect(uniqueRecovery).toContain(`DROP INDEX CONCURRENTLY IF EXISTS "FlashcardReview_userId_idempotencyKey_key";`);
    expect(uniqueRecovery).toContain(
      `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "FlashcardReview_userId_idempotencyKey_key" ON "FlashcardReview"("userId", "idempotencyKey");`
    );

    const cliVerify = execFileSync(
      process.execPath,
      [path.resolve(rootDir, "scripts/prepare-concurrent-indexes.mjs"), "--verify"],
      { cwd: rootDir, encoding: "utf8" }
    );
    expect(cliVerify).toContain("Verified 19 migration indexes");

    const cliRecover = execFileSync(
      process.execPath,
      [
        path.resolve(rootDir, "scripts/prepare-concurrent-indexes.mjs"),
        "--recover-index",
        "ConnectedAccount_watchChannelId_key",
      ],
      { cwd: rootDir, encoding: "utf8" }
    );
    expect(cliRecover).toContain(
      `DROP INDEX CONCURRENTLY IF EXISTS "ConnectedAccount_watchChannelId_key";`
    );
  });
});

describe.skipIf(!hasIsolatedTestDb)(
  "LIM-09 Concurrent Index Tooling — Isolated Live PostgreSQL Integration (7 Scenarios)",
  () => {
    let prisma: PrismaClient;
    const tableName = `lim09_pg_verify_${Date.now()}`;
    const btreeIdx = `${tableName}_status_created_idx`;
    const uniqueIdx = `${tableName}_user_idem_key`;

    async function getIndexCatalogState(indexName: string): Promise<{
      oid: number;
      indisvalid: boolean;
      indisready: boolean;
    } | null> {
      const rows = await prisma.$queryRaw<
        Array<{ oid: number; indisvalid: boolean; indisready: boolean }>
      >`
        SELECT c.oid::int AS oid, i.indisvalid, i.indisready
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema()
          AND c.relname = ${indexName}
      `;
      return rows[0] ?? null;
    }

    beforeAll(async () => {
      const verifiedUrl = assertIsolatedTestDatabaseConfig();
      prisma = new PrismaClient({
        datasources: { db: { url: verifiedUrl } },
      });
      await verifyLiveIsolatedDatabaseIdentity(prisma, verifiedUrl);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE "${tableName}" (
          "id" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL,
          "idempotencyKey" TEXT,
          "status" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${tableName}" ("id", "userId", "idempotencyKey", "status")
        VALUES
          ('r1', 'u1', 'idem-1', 'QUEUED'),
          ('r2', 'u1', 'idem-2', 'RUNNING'),
          ('r3', 'u2', 'idem-1', 'SUCCEEDED');
      `);
    });

    afterAll(async () => {
      if (prisma) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`).catch(() => undefined);
        await prisma.$disconnect();
      }
    });

    it("1. creates an index with CREATE INDEX CONCURRENTLY IF NOT EXISTS outside a transaction with indisvalid = true", async () => {
      await prisma.$executeRawUnsafe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${btreeIdx}" ON "${tableName}"("status", "createdAt");`
      );
      const state = await getIndexCatalogState(btreeIdx);
      expect(state).not.toBeNull();
      expect(state?.indisvalid).toBe(true);
      expect(state?.indisready).toBe(true);
    });

    it("2. preserves an existing valid index as a no-op when CREATE INDEX CONCURRENTLY IF NOT EXISTS is re-executed", async () => {
      const before = await getIndexCatalogState(btreeIdx);
      expect(before?.indisvalid).toBe(true);

      await prisma.$executeRawUnsafe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${btreeIdx}" ON "${tableName}"("status", "createdAt");`
      );
      const after = await getIndexCatalogState(btreeIdx);
      expect(after?.oid).toBe(before?.oid);
      expect(after?.indisvalid).toBe(true);
    });

    it("3. detects an existing invalid index (indisvalid = false) and proves standard CREATE INDEX IF NOT EXISTS silently skips it", async () => {
      // Simulate an interrupted concurrent index build by creating a duplicate violation on a UNIQUE index
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${tableName}" ("id", "userId", "idempotencyKey", "status")
        VALUES ('r4-dup', 'u1', 'idem-1', 'QUEUED');
      `);

      // Concurrent unique index build fails with 23505 and leaves an invalid pg_index entry in PostgreSQL
      await expect(
        prisma.$executeRawUnsafe(
          `CREATE UNIQUE INDEX CONCURRENTLY "${uniqueIdx}" ON "${tableName}"("userId", "idempotencyKey");`
        )
      ).rejects.toThrow();

      // Remove the duplicate row so rebuild is possible, but observe that the leftover index is still indisvalid = false
      await prisma.$executeRawUnsafe(`DELETE FROM "${tableName}" WHERE "id" = 'r4-dup';`);

      const invalidState = await getIndexCatalogState(uniqueIdx);
      expect(invalidState).not.toBeNull();
      expect(invalidState?.indisvalid).toBe(false);

      // Standard CREATE UNIQUE INDEX IF NOT EXISTS (what Prisma migration runs) silently skips the invalid index!
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${uniqueIdx}" ON "${tableName}"("userId", "idempotencyKey");`
      );
      const stillInvalid = await getIndexCatalogState(uniqueIdx);
      expect(stillInvalid?.indisvalid).toBe(false);
    });

    it("4. recovers an interrupted/invalid concurrent index via DROP INDEX CONCURRENTLY IF EXISTS + rebuild", async () => {
      const beforeRecovery = await getIndexCatalogState(uniqueIdx);
      expect(beforeRecovery?.indisvalid).toBe(false);

      await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${uniqueIdx}";`);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "${uniqueIdx}" ON "${tableName}"("userId", "idempotencyKey");`
      );

      const recoveredState = await getIndexCatalogState(uniqueIdx);
      expect(recoveredState).not.toBeNull();
      expect(recoveredState?.indisvalid).toBe(true);
      expect(recoveredState?.indisready).toBe(true);
    });

    it("5. detects duplicate key data preventing a unique index before rebuild", async () => {
      await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${uniqueIdx}";`);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "${tableName}" ("id", "userId", "idempotencyKey", "status")
        VALUES ('r5-dup', 'u2', 'idem-1', 'QUEUED');
      `);

      const duplicates = await prisma.$queryRawUnsafe<
        Array<{ userId: string; idempotencyKey: string; duplicate_count: bigint | number }>
      >(`
        SELECT "userId", "idempotencyKey", COUNT(*)::int AS duplicate_count
        FROM "${tableName}"
        WHERE "userId" IS NOT NULL AND "idempotencyKey" IS NOT NULL
        GROUP BY "userId", "idempotencyKey"
        HAVING COUNT(*) > 1;
      `);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]).toMatchObject({ userId: "u2", idempotencyKey: "idem-1" });

      // Clean up duplicate and rebuild unique index cleanly
      await prisma.$executeRawUnsafe(`DELETE FROM "${tableName}" WHERE "id" = 'r5-dup';`);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "${uniqueIdx}" ON "${tableName}"("userId", "idempotencyKey");`
      );
      const state = await getIndexCatalogState(uniqueIdx);
      expect(state?.indisvalid).toBe(true);
    });

    it("6. supports repeated idempotent execution of recovery and CREATE INDEX CONCURRENTLY IF NOT EXISTS", async () => {
      await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${uniqueIdx}";`);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "${uniqueIdx}" ON "${tableName}"("userId", "idempotencyKey");`
      );
      const firstPass = await getIndexCatalogState(uniqueIdx);
      expect(firstPass?.indisvalid).toBe(true);

      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "${uniqueIdx}" ON "${tableName}"("userId", "idempotencyKey");`
      );
      const secondPass = await getIndexCatalogState(uniqueIdx);
      expect(secondPass?.indisvalid).toBe(true);
      expect(secondPass?.oid).toBe(firstPass?.oid);
    });

    it("7. preserves valid pre-created concurrent indexes as an instant no-op when Prisma migration SQL runs inside a transaction", async () => {
      const before = await getIndexCatalogState(uniqueIdx);
      expect(before?.indisvalid).toBe(true);

      // Run standard migration SQL inside a Prisma interactive transaction (simulating `prisma migrate deploy`)
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "${btreeIdx}" ON "${tableName}"("status", "createdAt");`
        );
        await tx.$executeRawUnsafe(
          `CREATE UNIQUE INDEX IF NOT EXISTS "${uniqueIdx}" ON "${tableName}"("userId", "idempotencyKey");`
        );
      });

      const afterBtree = await getIndexCatalogState(btreeIdx);
      const afterUnique = await getIndexCatalogState(uniqueIdx);
      expect(afterBtree?.indisvalid).toBe(true);
      expect(afterUnique?.indisvalid).toBe(true);
      expect(afterUnique?.oid).toBe(before?.oid);
    });
  }
);
