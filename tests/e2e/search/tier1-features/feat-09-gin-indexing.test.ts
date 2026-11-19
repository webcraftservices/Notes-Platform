/**
 * Tier 1 — Feature 9: Expression GIN Indexing
 *
 * Verifies expression GIN full-text search indexes across core entities:
 * Subject, Chapter, Topic, Material, Note, Group, and FlashcardDeck
 * with weighted tsvectors ('A', 'B', 'C') for relevance ranking.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Tier 1 — Feat 09: Expression GIN Indexing", () => {
  const migrationPath = path.resolve(
    process.cwd(),
    "prisma/migrations/20261110090000_phase12_search_indexing/migration.sql"
  );

  it("verifies expression GIN index on Subject with weighted fields ('A' name, 'B' description)", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");

    expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?"?idx_subject_search_fts"?/i);
    expect(sql).toMatch(/ON\s+"?Subject"?/i);
    expect(sql).toMatch(/USING\s+gin/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("name",\s*''\)\),\s*'A'\)/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("description",\s*''\)\),\s*'B'\)/i);
  });

  it("verifies expression GIN index on Chapter with weighted fields ('A' name, 'B' description)", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");

    expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?"?idx_chapter_search_fts"?/i);
    expect(sql).toMatch(/ON\s+"?Chapter"?/i);
    expect(sql).toMatch(/USING\s+gin/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("name",\s*''\)\),\s*'A'\)/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("description",\s*''\)\),\s*'B'\)/i);
  });

  it("verifies expression GIN index on Topic with weighted fields ('A' name, 'B' description)", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");

    expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?"?idx_topic_search_fts"?/i);
    expect(sql).toMatch(/ON\s+"?Topic"?/i);
    expect(sql).toMatch(/USING\s+gin/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("name",\s*''\)\),\s*'A'\)/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("description",\s*''\)\),\s*'B'\)/i);
  });

  it("verifies expression GIN index on Material with weighted fields ('A' title, 'B' originalFilename, 'C' extractedText)", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");

    expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?"?idx_material_search_fts"?/i);
    expect(sql).toMatch(/ON\s+"?Material"?/i);
    expect(sql).toMatch(/USING\s+gin/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("title",\s*''\)\),\s*'A'\)/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("originalFilename",\s*''\)\),\s*'B'\)/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("extractedText",\s*''\)\),\s*'C'\)/i);
  });

  it("verifies expression GIN index on Note with weighted fields ('A' title, 'B' plainText)", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");

    expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?"?idx_note_search_fts"?/i);
    expect(sql).toMatch(/ON\s+"?Note"?/i);
    expect(sql).toMatch(/USING\s+gin/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("title",\s*''\)\),\s*'A'\)/i);
    expect(sql).toMatch(/setweight\(to_tsvector\('english',\s*coalesce\("plainText",\s*''\)\),\s*'B'\)/i);
  });

  it("verifies expression GIN indexes on Group and FlashcardDeck", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");

    // Group FTS index
    expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?"?idx_group_search_fts"?/i);
    expect(sql).toMatch(/ON\s+"?Group"?/i);
    expect(sql).toMatch(/USING\s+gin/i);

    // FlashcardDeck FTS index
    expect(sql).toMatch(/CREATE\s+INDEX\s+(IF\s+NOT\s+EXISTS\s+)?"?idx_flashcard_deck_search_fts"?/i);
    expect(sql).toMatch(/ON\s+"?FlashcardDeck"?/i);
    expect(sql).toMatch(/USING\s+gin/i);
  });
});
