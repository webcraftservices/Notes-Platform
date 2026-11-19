/**
 * Tier 4: Real-World Workload Testing — Scenario 1: Lecture Deep-Linking
 *
 * User Journey:
 * A student (Alice) searches for lecture concepts across her personal notes and
 * multi-page PDF slides / audio lecture materials. She inspects the complete
 * hierarchy breadcrumb (Subject > Chapter > Topic) and navigates directly to:
 * - PDF slide page number (`?page=2`)
 * - Audio timestamp seconds (`?t=120`)
 * - Note topic tab (`?tab=notes&noteId=...`)
 *
 * Steps:
 * 1. Alice queries "replication fork" across all entities in hybrid mode.
 * 2. Verify returned hits contain both Note and Material entities.
 * 3. Inspect hierarchy breadcrumbs for accurate Subject, Chapter, and Topic resolution.
 * 4. Verify PDF slide material deep link contains exact target page (`?page=2`).
 * 5. Alice queries "organic reactions stereochemistry" matching audio material with timestamp (`?t=120`).
 * 6. Verify Note navigation deep link routes to topic notes tab (`?tab=notes`).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, SearchHit } from "../harness/contracts";
import { createMockEmbedding } from "../harness/fixtures";

describe("Tier 4: Scenario 1 — Student Lecture Concept Deep-Linking Workflow", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("executes the complete multi-step lecture deep-linking journey", async () => {
    // ------------------------------------------------------------------------
    // Step 1: Alice queries "helicase" across all entities
    // ------------------------------------------------------------------------
    const step1Res = await harness.dispatchSearchApiJson(
      { q: "helicase", mode: "hybrid" },
      { id: "user-alice" }
    );
    expect(step1Res.status).toBe(200);
    assertSearchApiResponse(step1Res.data);
    expect(step1Res.data.total).toBeGreaterThanOrEqual(2);

    // ------------------------------------------------------------------------
    // Step 2: Verify returned hits contain both Note and Material entities
    // ------------------------------------------------------------------------
    const hits: SearchHit[] = step1Res.data.hits;
    const noteHits = hits.filter((h) => h.entityType === "note");
    const materialHits = hits.filter((h) => h.entityType === "material");

    expect(noteHits.length).toBeGreaterThanOrEqual(1);
    expect(materialHits.length).toBeGreaterThanOrEqual(1);

    // ------------------------------------------------------------------------
    // Step 3: Inspect hierarchy breadcrumbs on the top Note hit
    // ------------------------------------------------------------------------
    const topNote = noteHits[0];
    expect(topNote).toBeDefined();
    if (!topNote) throw new Error("Expected topNote to be defined");

    expect(topNote.hierarchy.subjectId).toBe("subj-alice-bio");
    expect(topNote.hierarchy.subjectName).toBe("Molecular Biology");
    expect(topNote.hierarchy.chapterId).toBe("chap-dna");
    expect(topNote.hierarchy.chapterName).toBe("DNA Replication and Repair");
    expect(topNote.hierarchy.topicId).toBe("topic-helicase");
    expect(topNote.hierarchy.topicName).toBe("DNA Helicase and Polymerase Mechanisms");

    // ------------------------------------------------------------------------
    // Step 4: Verify PDF slide deep link includes target page number (?page=2)
    // ------------------------------------------------------------------------
    const pdfSlide = materialHits.find((m) => m.id === "mat-dna-slides");
    expect(pdfSlide).toBeDefined();
    expect(pdfSlide?.navigation.pageNumber).toBe(2);
    expect(pdfSlide?.navigation.href).toBe("/materials/mat-dna-slides?page=2");
    expect(pdfSlide?.snippet).toContain("Helicase");

    // ------------------------------------------------------------------------
    // Step 5: Alice queries audio lecture matching timestamp (?t=120)
    // ------------------------------------------------------------------------
    // Ensure audio chunk has matching embedding for the query
    const data = harness.store.getData();
    const audioChunk = data.materialChunks.find((c) => c.id === "mchunk-audio-1");
    if (audioChunk) {
      audioChunk.embedding = createMockEmbedding("stereochemistry aromatic reactions");
    }

    const step5Res = await harness.dispatchSearchApiJson(
      { q: "stereochemistry aromatic reactions", mode: "hybrid" },
      { id: "user-alice" }
    );
    expect(step5Res.status).toBe(200);
    assertSearchApiResponse(step5Res.data);

    const audioLecture = step5Res.data.hits.find((h: SearchHit) => h.id === "mat-chem-lecture-audio");
    expect(audioLecture).toBeDefined();
    expect(audioLecture?.navigation.timestampSeconds).toBe(120);
    expect(audioLecture?.navigation.href).toBe("/materials/mat-chem-lecture-audio?t=120");

    // ------------------------------------------------------------------------
    // Step 6: Verify Note navigation routes to topic note tab
    // ------------------------------------------------------------------------
    expect(topNote.navigation.href).toBe(
      `/topics/${topNote.hierarchy.topicId}?tab=notes&noteId=${topNote.id}`
    );
  });
});
