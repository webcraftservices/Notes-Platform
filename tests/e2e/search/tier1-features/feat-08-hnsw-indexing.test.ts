/**
 * Tier 1 — Feature 8: Vector HNSW Indexing
 *
 * Verifies pgvector HNSW index DDL, vector_cosine_ops operator class,
 * 1536-dimensional vector embedding column types, and idempotent migration script structure.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Tier 1 — Feat 08: Vector HNSW Indexing", () => {
  const migrationPath = path.resolve(
    process.cwd(),
    "prisma/migrations/20261110090000_phase12_search_indexing/migration.sql"
  );
  const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");

  it("verifies the Phase 12 search indexing migration SQL file exists", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(sql.length).toBeGreaterThan(100);
  });

  it("creates HNSW index with vector_cosine_ops on MaterialChunk embedding", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");

    // Match CREATE INDEX on MaterialChunk USING hnsw (embedding vector_cosine_ops)
    expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?"?idx_material_chunk_embedding_hnsw"?/i);
    expect(sql).toMatch(/ON\s+"?MaterialChunk"?/i);
    expect(sql).toMatch(/USING\s+hnsw/i);
    expect(sql).toMatch(/"?embedding"?\s+vector_cosine_ops/i);
  });

  it("creates HNSW index with vector_cosine_ops on NoteChunk embedding", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");

    // Match CREATE INDEX on NoteChunk USING hnsw (embedding vector_cosine_ops)
    expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?"?idx_note_chunk_embedding_hnsw"?/i);
    expect(sql).toMatch(/ON\s+"?NoteChunk"?/i);
    expect(sql).toMatch(/USING\s+hnsw/i);
    expect(sql).toMatch(/"?embedding"?\s+vector_cosine_ops/i);
  });

  it("verifies HNSW index is chosen over IVFFlat for high-recall without clustering warmup", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");

    // Verify hnsw is used and ivfflat is NOT used for embeddings
    expect(sql.toLowerCase()).toContain("using hnsw");
    expect(sql.toLowerCase()).not.toContain("using ivfflat");
  });

  it("ensures DDL uses idempotent IF NOT EXISTS guards for safe zero-downtime execution", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");

    const materialHnswLine = sql
      .split("\n")
      .find((line) => line.includes("idx_material_chunk_embedding_hnsw"));
    expect(materialHnswLine).toBeDefined();
    expect(materialHnswLine?.toUpperCase()).toContain("IF NOT EXISTS");

    const noteHnswLine = sql
      .split("\n")
      .find((line) => line.includes("idx_note_chunk_embedding_hnsw"));
    expect(noteHnswLine).toBeDefined();
    expect(noteHnswLine?.toUpperCase()).toContain("IF NOT EXISTS");
  });

  it("verifies NoteChunk and MaterialChunk specify 1536d vector columns in Prisma schema and DDL", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(sql).toMatch(/"embedding"\s+vector\(1536\)/i);

    const schema = fs.readFileSync(schemaPath, "utf-8");
    // Verify NoteChunk model in Prisma schema
    expect(schema).toContain("model NoteChunk");
    expect(schema).toMatch(/embedding\s+Unsupported\("vector\(1536\)"\)\?/);
    // Verify MaterialChunk model in Prisma schema
    expect(schema).toContain("model MaterialChunk");
    expect(schema).toMatch(/embedding\s+Unsupported\("vector\(1536\)"\)\?/);
  });
});
