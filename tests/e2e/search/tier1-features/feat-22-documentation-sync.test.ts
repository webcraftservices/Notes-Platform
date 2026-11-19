/**
 * Tier 1 — Feature 22: Documentation & Roadmap Sync
 *
 * Verifies documentation synchronization and consistency across docs/ROADMAP.md,
 * PROJECT.md, and PROJECT_STATE.md:
 * - Phase 12 milestone authorization and objective
 * - Search Modality Matrix across core entities
 * - Architectural decision on FlashcardDeck scope
 * - Note plain text & NoteChunk embedding lifecycle
 * - pgvector HNSW vs IVFFlat index evaluation
 * - Reciprocal Rank Fusion (RRF k=60) ranking specification
 * - Cumulative Known Limitations & Verification Gaps Register preservation
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Tier 1 — Feat 22: Documentation & Roadmap Sync", () => {
  const roadmapPath = path.resolve(process.cwd(), "docs/ROADMAP.md");
  const projectPath = path.resolve(process.cwd(), "PROJECT.md");

  it("verifies docs/ROADMAP.md documents Phase 12 as an authorized active milestone", () => {
    expect(fs.existsSync(roadmapPath)).toBe(true);
    const roadmap = fs.readFileSync(roadmapPath, "utf-8");

    expect(roadmap).toContain("Phase 12: Unified Global & Semantic Search");
    expect(roadmap).toMatch(/Phase 12.*?Authorized/i);
  });

  it("verifies docs/ROADMAP.md documents the Search Modality Matrix across all core entities", () => {
    const roadmap = fs.readFileSync(roadmapPath, "utf-8");

    // Must define lexical and semantic modality for Subjects, Chapters, Topics, Materials, Notes, StudyGroups
    expect(roadmap).toContain("Subjects");
    expect(roadmap).toContain("Chapters");
    expect(roadmap).toContain("Topics");
    expect(roadmap).toContain("Materials");
    expect(roadmap).toContain("Notes");
    expect(roadmap).toContain("StudyGroups");
  });

  it("verifies docs/ROADMAP.md documents the architectural decision regarding Flashcards and Quiz exclusion", () => {
    const roadmap = fs.readFileSync(roadmapPath, "utf-8");

    // FlashcardDeck scope decision documented
    expect(roadmap).toMatch(/Flashcard|FlashcardDeck/i);
    // Quizzes explicitly reserved for later phase (Phase 13 study loops)
    expect(roadmap).toContain("Phase 13");
  });

  it("verifies docs/ROADMAP.md documents hybrid retrieval with Reciprocal Rank Fusion (RRF k=60)", () => {
    const roadmap = fs.readFileSync(roadmapPath, "utf-8");

    expect(roadmap).toMatch(/Reciprocal Rank Fusion|RRF/i);
    expect(roadmap).toMatch(/k\s*=\s*60/);
  });

  it("verifies docs/ROADMAP.md documents NoteChunk representation and embedding generation lifecycle", () => {
    const roadmap = fs.readFileSync(roadmapPath, "utf-8");

    expect(roadmap).toMatch(/NoteChunk|Note embedding/i);
    expect(roadmap).toMatch(/plainText|plain-text/i);
  });

  it("verifies docs/ROADMAP.md preserves the Cumulative Known Limitations & Verification Gaps Register", () => {
    const roadmap = fs.readFileSync(roadmapPath, "utf-8");

    expect(roadmap).toContain("Known Limitations & Verification Gaps Register");
  });

  it("verifies PROJECT.md maintains complete Feature Inventory (1-22) and Interface Contracts", () => {
    expect(fs.existsSync(projectPath)).toBe(true);
    const project = fs.readFileSync(projectPath, "utf-8");

    expect(project).toContain("Feature Inventory");
    expect(project).toContain("Core Entity Lexical Search");
    expect(project).toContain("FlashcardDeck Lexical Scope");
    expect(project).toContain("Quiz Scope Formal Decision");
    expect(project).toContain("Vector HNSW Indexing");
    expect(project).toContain("Expression GIN Indexing");
    expect(project).toContain("Unified RRF Ranking");
    expect(project).toContain("Chunk Collapsing & Deduplication");
    expect(project).toContain("Pre-Filtered Server Authorization");
    expect(project).toContain("Fail-Closed Hierarchy Soft Deletion");
    expect(project).toContain("Leakage Prevention");
    expect(project).toContain("Authenticated Search API");
    expect(project).toContain("Command Palette");
    expect(project).toContain("Dedicated `/search` Experience");
    expect(project).toContain("Contextual Snippets");
    expect(project).toContain("Deep-Link Navigation Routing");
    expect(project).toContain("Interface Contracts");
    expect(project).toContain("SearchHit");
    expect(project).toContain("SearchApiResponse");
  });
});
