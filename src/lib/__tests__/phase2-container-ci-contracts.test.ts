import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { validateRuntimeConfiguration } from "@/lib/config/production-validation";

const rootDir = process.cwd();

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.resolve(rootDir, relPath), "utf8");
}

describe("Phase 2 — Container Architecture, Linux CI & Migration Inventory Contracts", () => {
  describe("Dockerfile targets, non-root UID 1001 & volume permissions", () => {
    const dockerfile = readRepoFile("Dockerfile");

    it("defines isolated base, deps, prod-deps, migrator, builder, web, and worker stages on Node 22.22.2 Bookworm slim", () => {
      expect(dockerfile).toContain("FROM node:22.22.2-bookworm-slim AS base");
      for (const stage of ["AS deps", "AS prod-deps", "AS migrator", "AS builder", "AS web", "AS worker"]) {
        expect(dockerfile).toContain(stage);
      }
      expect(dockerfile).toContain("COPY patches ./patches");
      expect(dockerfile).toContain("COPY --from=deps /app/node_modules/pptx2html ./node_modules/pptx2html");
    });

    it("pre-creates writable /tmp/zenote-local-storage owned by UID 1001 before dropping privileges in web and worker", () => {
      const webSection = dockerfile.slice(dockerfile.indexOf("AS web"), dockerfile.indexOf("AS worker"));
      const workerSection = dockerfile.slice(dockerfile.indexOf("AS worker"));

      expect(webSection).toContain("chown -R nextjs:nodejs /app/.next /tmp/zenote-local-storage");
      expect(webSection.indexOf("chown -R nextjs:nodejs")).toBeLessThan(webSection.indexOf("USER nextjs"));

      expect(workerSection).toContain("chown -R worker:nodejs /tmp/zenote-local-storage");
      expect(workerSection.indexOf("chown -R worker:nodejs")).toBeLessThan(workerSection.indexOf("USER worker"));
    });

    it("strips .env* and .storage from .next/standalone during builder stage and .dockerignore", () => {
      expect(dockerfile).toContain("rm -rf .next/standalone/.env* .next/standalone/.storage");

      const dockerignore = readRepoFile(".dockerignore");
      expect(dockerignore).toMatch(/^\.env$/m);
      expect(dockerignore).toMatch(/^\.env\.\*$/m);
      expect(dockerignore).toMatch(/^\.storage$/m);
    });
  });

  describe("docker-compose.yml & Stage A Linux CI verification workflow", () => {
    const compose = readRepoFile("docker-compose.yml");
    const stageAYml = readRepoFile(".github/workflows/stage-a-verification.yml");

    it("enforces strict isolation from live cloud endpoints and validates compose web/worker baseline env", () => {
      expect(compose).not.toMatch(/neon\.tech|upstash\.io|r2\.cloudflarestorage\.com/i);
      expect(compose).toContain("pgvector/pgvector:pg17");
      expect(compose).toContain("service_completed_successfully");
      expect(compose).toContain("BULLMQ_DEDICATED_WORKER: \"true\"");
      expect(compose).toContain("BULLMQ_EMBEDDED_WORKER: \"false\"");

      const webValidation = validateRuntimeConfiguration({
        role: "web",
        env: {
          NODE_ENV: "production",
          NEXTAUTH_SECRET: "local-compose-dev-secret-change-in-production-32bytes",
          DATABASE_URL: "postgresql://zenote:zenote_local_pw@postgres:5432/zenote_local?schema=public",
          REDIS_URL: "redis://redis:6379",
        },
      });
      expect(webValidation.ok).toBe(true);
    });

    it("clears restart policy before SIGTERM + docker wait and verifies writable volume mounts", () => {
      const updateIdx = stageAYml.indexOf('docker update --restart=no "$w1_cid"');
      const killIdx = stageAYml.indexOf('docker kill --signal=SIGTERM "$w1_cid"');
      const waitIdx = stageAYml.indexOf('docker wait "$w1_cid"');
      expect(updateIdx).toBeGreaterThan(-1);
      expect(killIdx).toBeGreaterThan(updateIdx);
      expect(waitIdx).toBeGreaterThan(killIdx);

      const webUpdateIdx = stageAYml.indexOf('docker update --restart=no "$web_cid"');
      const webKillIdx = stageAYml.indexOf('docker kill --signal=SIGTERM "$web_cid"');
      const webWaitIdx = stageAYml.indexOf('docker wait "$web_cid"');
      expect(webUpdateIdx).toBeGreaterThan(-1);
      expect(webKillIdx).toBeGreaterThan(webUpdateIdx);
      expect(webWaitIdx).toBeGreaterThan(webKillIdx);

      expect(stageAYml).toContain("docker compose run --rm migrate");
      expect(stageAYml).toContain("pg_extension WHERE extname = 'vector'");
      expect(stageAYml).toContain("docker compose restart worker web");
      expect(stageAYml).toContain("test -w /tmp/zenote-local-storage");
      expect(stageAYml).toContain("scripts/scrub-standalone-env.mjs");
      expect(stageAYml).toContain("scripts/prepare-concurrent-indexes.mjs");
      expect(stageAYml).toContain("group-deletion-postgres-integration.test.ts");
      expect(stageAYml).toContain("search-postgres-integration.test.ts");
      expect(stageAYml).toContain("study-postgres-integration.test.ts");
      expect(stageAYml).toContain("phase15-live-integration.test.ts");
      expect(stageAYml).toContain("lim09-concurrent-indexes.test.ts");
    });

    it("enforces exact port parity between docker-compose.yml published ports (5433/6380), container network URLs (postgres:5432/redis:6379), and stage-a-verification.yml host-runner test URLs", () => {
      // 1. Parse published ports from docker-compose.yml
      const pgPortMatch = compose.match(/postgres:[\s\S]*?ports:\s*\r?\n\s*-\s*"(\d+):(\d+)"/);
      const redisPortMatch = compose.match(/redis:[\s\S]*?ports:\s*\r?\n\s*-\s*"(\d+):(\d+)"/);
      const webPortMatch = compose.match(/web:[\s\S]*?ports:\s*\r?\n\s*-\s*"(\d+):(\d+)"/);

      expect(pgPortMatch).not.toBeNull();
      expect(redisPortMatch).not.toBeNull();
      expect(webPortMatch).not.toBeNull();

      const [pgHostPort, pgContainerPort] = [pgPortMatch![1], pgPortMatch![2]];
      const [redisHostPort, redisContainerPort] = [redisPortMatch![1], redisPortMatch![2]];
      const [webHostPort, webContainerPort] = [webPortMatch![1], webPortMatch![2]];

      expect(pgHostPort).toBe("5433");
      expect(pgContainerPort).toBe("5432");
      expect(redisHostPort).toBe("6380");
      expect(redisContainerPort).toBe("6379");
      expect(webHostPort).toBe("3000");
      expect(webContainerPort).toBe("3000");

      // 2. Verify Compose internal service URLs use container ports (postgres:5432 and redis:6379)
      expect(compose).toContain(`@postgres:${pgContainerPort}/zenote_local`);
      expect(compose).toContain(`redis://redis:${redisContainerPort}`);

      // 3. Verify host-runner Vitest step in stage-a-verification.yml uses host-published ports (127.0.0.1:5433 and 127.0.0.1:6380)
      expect(stageAYml).toContain(
        `ISOLATED_TEST_DATABASE_URL="postgresql://zenote:zenote_local_pw@127.0.0.1:${pgHostPort}/zenote_local?schema=public"`
      );
      expect(stageAYml).toContain(
        `DATABASE_URL="postgresql://zenote:zenote_local_pw@127.0.0.1:${pgHostPort}/zenote_local?schema=public"`
      );
      expect(stageAYml).toContain(`ISOLATED_TEST_REDIS_URL="redis://127.0.0.1:${redisHostPort}"`);
      expect(stageAYml).toContain(`REDIS_URL="redis://127.0.0.1:${redisHostPort}"`);
      expect(stageAYml).toContain(`BULLMQ_REDIS_URL="redis://127.0.0.1:${redisHostPort}"`);
      expect(stageAYml).toContain(`ENABLE_LIVE_BULLMQ_TESTS="true"`);
      expect(stageAYml).not.toContain(`@127.0.0.1:${pgContainerPort}/zenote_local`);
      expect(stageAYml).not.toContain(`redis://127.0.0.1:${redisContainerPort}`);

      // 4. Verify container-exec steps in stage-a-verification.yml still use internal Compose DNS (redis:6379)
      expect(stageAYml).toContain(`new IORedis("redis://redis:${redisContainerPort}"`);

      // 5. Verify inline async Node checks in stage-a-verification.yml attach explicit .catch handlers that exit non-zero,
      //    and that failure logs are collected before Compose teardown.
      const asyncIifeMatches = stageAYml.match(/\}\)\(\)/g) ?? [];
      const caughtAsyncIifeMatches = stageAYml.match(/\}\)\(\)\.catch\(\(err\) => \{ console\.error\(err\); process\.exit\(1\); \}\)/g) ?? [];
      expect(asyncIifeMatches.length).toBeGreaterThanOrEqual(4);
      expect(caughtAsyncIifeMatches.length).toBe(asyncIifeMatches.length);
      expect(stageAYml).toContain("if: failure()");
      expect(stageAYml).toContain("docker compose logs --tail=100");
    });

    it("verifies LIM-09 concurrent index manifest idempotency and invalid-index recovery SQL generation", async () => {
      // @ts-expect-error -- .mjs helper module
      const lim09 = await import("../../../scripts/prepare-concurrent-indexes.mjs");
      const check = lim09.verifyMigrationIndexIdempotency();
      expect(check.valid).toBe(true);
      expect(check.checkedCount).toBe(19);
      expect(check.errors).toEqual([]);

      const preSql = lim09.buildPreMigrationConcurrentSql();
      expect(preSql).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS \"idx_material_chunk_embedding_hnsw\"");
      expect(preSql).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS \"idx_material_search_fts\"");
      expect(preSql).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS \"idx_flashcard_search_fts\"");

      const invalidCheckSql = lim09.buildInvalidIndexCheckSql();
      expect(invalidCheckSql).toContain("i.indisvalid = false OR i.indisready = false");

      const recoverySql = lim09.buildIndexRecoverySql("idx_material_chunk_embedding_hnsw");
      expect(recoverySql).toContain("DROP INDEX CONCURRENTLY IF EXISTS \"idx_material_chunk_embedding_hnsw\";");
      expect(recoverySql).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS \"idx_material_chunk_embedding_hnsw\"");
    });
  });

  describe("Prisma migration history <-> schema structural parity (Stage E offline audit)", () => {
    it("matches all 38 tables, 25 enums, 90 Prisma indexes + 10 raw PostgreSQL HNSW/GIN indexes across 14 migrations", () => {
      const migrationsDir = path.resolve(rootDir, "prisma/migrations");
      const migrationDirs = fs
        .readdirSync(migrationsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      expect(migrationDirs.length).toBeGreaterThanOrEqual(14);

      const migSql = migrationDirs
        .map((dir) => fs.readFileSync(path.join(migrationsDir, dir, "migration.sql"), "utf8"))
        .join("\n");

      const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
      const schemaDdl = execSync(
        `${npxBin} prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`,
        { cwd: rootDir, encoding: "utf8" }
      );

      const extract = (sql: string, re: RegExp) => [...sql.matchAll(re)].map((m) => m[1]).sort();
      const sTables = extract(schemaDdl, /CREATE TABLE "([^"]+)"/g);
      const mTables = extract(migSql, /CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/g);
      const sEnums = extract(schemaDdl, /CREATE TYPE "([^"]+)"/g);
      const mEnums = extract(migSql, /CREATE TYPE "([^"]+)"/g);
      const sIndexes = extract(schemaDdl, /CREATE (?:UNIQUE )?INDEX "([^"]+)"/g);
      const mIndexes = extract(migSql, /CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"([^"]+)"/g);

      expect(mTables).toEqual(sTables);
      expect(mEnums).toEqual(sEnums);
      for (const idx of sIndexes) {
        expect(mIndexes).toContain(idx);
      }

      const customIndexes = mIndexes.filter((idx) => !sIndexes.includes(idx));
      expect(customIndexes).toEqual([
        "idx_chapter_search_fts",
        "idx_flashcard_deck_search_fts",
        "idx_flashcard_search_fts",
        "idx_group_search_fts",
        "idx_material_chunk_embedding_hnsw",
        "idx_material_search_fts",
        "idx_note_chunk_embedding_hnsw",
        "idx_note_search_fts",
        "idx_subject_search_fts",
        "idx_topic_search_fts",
      ]);

      // Explicitly verify LIM-09 search migration characteristics
      const phase12Sql = fs.readFileSync(
        path.join(migrationsDir, "20261110090000_phase12_search_indexing", "migration.sql"),
        "utf8"
      );
      expect(phase12Sql).toContain("USING hnsw");
      expect(phase12Sql).not.toContain("CONCURRENTLY");
    });
  });

  describe("Standalone .env scrub behavior", () => {
    it("removes all .env* variants inside a simulated standalone artifact directory via scripts/scrub-standalone-env.mjs", () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zenote-scrub-"));
      const standaloneDir = path.join(tmpRoot, ".next", "standalone");
      fs.mkdirSync(standaloneDir, { recursive: true });
      try {
        fs.writeFileSync(path.join(standaloneDir, ".env"), "SECRET=1");
        fs.writeFileSync(path.join(standaloneDir, ".env.local"), "SECRET=2");
        fs.writeFileSync(path.join(standaloneDir, ".env.production"), "SECRET=3");
        fs.writeFileSync(path.join(standaloneDir, "server.js"), "console.log('ok');");

        execFileSync(
          process.execPath,
          [path.resolve(rootDir, "scripts/scrub-standalone-env.mjs")],
          { cwd: tmpRoot, encoding: "utf8" }
        );

        expect(fs.existsSync(path.join(standaloneDir, "server.js"))).toBe(true);
        expect(fs.readdirSync(standaloneDir)).toEqual(["server.js"]);
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  });
});
