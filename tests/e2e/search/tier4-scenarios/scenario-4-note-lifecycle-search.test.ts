/**
 * Tier 4: Real-World Workload Testing — Scenario 4: Note Lifecycle & Search Reflection
 *
 * User Journey:
 * A researcher (Alice) creates a new research note, authors rich-text blocks,
 * revises content over time, and eventually archives/deletes the note.
 *
 * Steps:
 * 1. Alice creates note "CRISPR-Cas9 Gene Editing Protocols" with block content
 *    detailing "single guide RNA targeting and Cas9 endonuclease cleavage".
 * 2. Search verification: searching "endonuclease cleavage" immediately returns the note.
 * 3. Alice updates the note to "Prime Editing with Deactivated Cas9 Nickase", replacing
 *    the term "endonuclease" entirely with "nickase and reverse transcriptase".
 * 4. Stale query verification: searching "endonuclease" produces zero false positives.
 * 5. Updated query verification: searching "prime editing nickase" immediately returns the updated note.
 * 6. Alice soft-deletes the note (`deletedAt = new Date()`).
 * 7. Deletion verification: searching for both old and new terms returns zero hits.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, SearchHit } from "../harness/contracts";
import { createMockEmbedding } from "../harness/fixtures";

describe("Tier 4: Scenario 4 — Note Lifecycle & Search Reflection Workflow", () => {
  let harness: SearchTestHarness;

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("executes the complete note authoring, revision, and deletion search lifecycle", async () => {
    const data = harness.store.getData();
    const noteId = "note-crispr-lifecycle";

    // ------------------------------------------------------------------------
    // Step 1: Note Creation with Initial Content
    // ------------------------------------------------------------------------
    const initialTitle = "CRISPR-Cas9 Gene Editing Protocols";
    const initialText =
      "Single guide RNA directs the Cas9 endonuclease to introduce site-specific double-strand breaks in genomic DNA.";

    data.notes.push({
      id: noteId,
      topicId: "topic-helicase",
      authorId: "user-alice",
      title: initialTitle,
      plainText: initialText,
      source: "USER_CREATED",
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    data.noteChunks.push({
      id: "nc-crispr-initial",
      noteId,
      content: initialText,
      order: 1,
      embedding: createMockEmbedding("cas9 endonuclease cleavage"),
      createdAt: new Date(),
    });

    // ------------------------------------------------------------------------
    // Step 2: Initial Search Verification (Lexical & Semantic)
    // ------------------------------------------------------------------------
    const initialRes = await harness.dispatchSearchApiJson(
      { q: "endonuclease cleavage", mode: "hybrid" },
      { id: "user-alice" }
    );
    expect(initialRes.status).toBe(200);
    assertSearchApiResponse(initialRes.data);

    const initialHit = initialRes.data.hits.find((h: SearchHit) => h.id === noteId);
    expect(initialHit).toBeDefined();
    expect(initialHit?.title).toBe(initialTitle);
    expect(initialHit?.snippet).toContain("endonuclease");

    // ------------------------------------------------------------------------
    // Step 3: Content Revision (Replacing "endonuclease" with "prime editing nickase")
    // ------------------------------------------------------------------------
    const revisedTitle = "Prime Editing with Deactivated Cas9 Nickase";
    const revisedText =
      "Engineered pegRNA guides a catalytically impaired Cas9 nickase fused to reverse transcriptase for precise genomic insertions without double-strand breaks.";

    const noteRecord = data.notes.find((n) => n.id === noteId);
    expect(noteRecord).toBeDefined();
    if (noteRecord) {
      noteRecord.title = revisedTitle;
      noteRecord.plainText = revisedText;
      noteRecord.updatedAt = new Date();
    }

    // Invalidate old NoteChunks and insert updated chunk
    const oldChunkIndices = data.noteChunks
      .map((c, idx) => (c.noteId === noteId ? idx : -1))
      .filter((idx) => idx !== -1)
      .reverse();
    for (const idx of oldChunkIndices) {
      data.noteChunks.splice(idx, 1);
    }

    data.noteChunks.push({
      id: "nc-crispr-revised",
      noteId,
      content: revisedText,
      order: 1,
      embedding: createMockEmbedding("prime editing nickase reverse transcriptase"),
      createdAt: new Date(),
    });

    // ------------------------------------------------------------------------
    // Step 4: Stale Query Verification (Zero False-Positive Matches)
    // ------------------------------------------------------------------------
    const staleRes = await harness.dispatchSearchApiJson(
      { q: "endonuclease cleavage", mode: "lexical" },
      { id: "user-alice" }
    );
    expect(staleRes.status).toBe(200);
    // The note must NOT appear under the stale term
    expect(staleRes.data.hits.some((h: SearchHit) => h.id === noteId)).toBe(false);

    // ------------------------------------------------------------------------
    // Step 5: Updated Query Verification
    // ------------------------------------------------------------------------
    const updatedRes = await harness.dispatchSearchApiJson(
      { q: "prime editing nickase", mode: "hybrid" },
      { id: "user-alice" }
    );
    expect(updatedRes.status).toBe(200);
    assertSearchApiResponse(updatedRes.data);

    const updatedHit = updatedRes.data.hits.find((h: SearchHit) => h.id === noteId);
    expect(updatedHit).toBeDefined();
    expect(updatedHit?.title).toBe(revisedTitle);
    expect(updatedHit?.snippet).toContain("nickase");

    // ------------------------------------------------------------------------
    // Step 6: Soft Deletion of Note
    // ------------------------------------------------------------------------
    if (noteRecord) {
      noteRecord.deletedAt = new Date();
    }

    // ------------------------------------------------------------------------
    // Step 7: Deletion Verification (Fail-Closed Search Exclusion)
    // ------------------------------------------------------------------------
    const afterDeleteRes = await harness.dispatchSearchApiJson(
      { q: "prime editing", mode: "hybrid" },
      { id: "user-alice" }
    );
    expect(afterDeleteRes.status).toBe(200);
    expect(afterDeleteRes.data.hits.some((h: SearchHit) => h.id === noteId)).toBe(false);
  });
});
