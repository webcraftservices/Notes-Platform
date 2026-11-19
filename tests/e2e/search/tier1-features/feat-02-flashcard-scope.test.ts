/**
 * Tier 1 — Feature 2: FlashcardDeck Lexical Scope
 *
 * Verifies lexical search over FlashcardDeck titles within authorized workspaces and groups,
 * confirms individual card embeddings and card-level entity retrieval are deferred to Phase 13,
 * and validates tenant scoping and deep-link navigation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";
import { assertSearchApiResponse, isSearchHit, SearchHit } from "../harness/contracts";

describe("Tier 1 — Feat 02: FlashcardDeck Lexical Scope", () => {
  let harness: SearchTestHarness;
  const alice = { id: "user-alice", email: "alice@example.com", name: "Alice Smith" };
  const bob = { id: "user-bob", email: "bob@example.com", name: "Bob Jones" };
  const charlie = { id: "user-charlie", email: "charlie@example.com", name: "Charlie Brown" };

  beforeEach(() => {
    harness = new SearchTestHarness();
    harness.reset();
  });

  it("retrieves FlashcardDeck entities matching query on title within personal workspace", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Replication Essentials Deck", mode: "lexical", types: "flashcard" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    expect(res.data.hits.length).toBeGreaterThanOrEqual(1);

    const hit = (res.data.hits as SearchHit[]).find((h: SearchHit) => h.id === "deck-dna-cards");
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe("flashcard");
    expect(hit?.title).toBe("DNA Replication Essentials Deck");
    expect(hit?.navigation.href).toContain("deckId=deck-dna-cards");
    expect(res.data.counts.flashcard).toBeGreaterThanOrEqual(1);
  });

  it("populates topic, chapter, and subject hierarchy context for linked FlashcardDecks", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Replication Essentials", mode: "lexical", types: "flashcard" },
      alice
    );

    expect(res.status).toBe(200);
    const hit = (res.data.hits as SearchHit[]).find((h: SearchHit) => h.id === "deck-dna-cards");
    expect(hit).toBeDefined();
    expect(hit?.hierarchy.subjectId).toBe("subj-alice-bio");
    expect(hit?.hierarchy.subjectName).toBe("Molecular Biology");
    expect(hit?.hierarchy.chapterId).toBe("chap-dna");
    expect(hit?.hierarchy.topicId).toBe("topic-helicase");
    expect(hit?.navigation.href).toBe("/topics/topic-helicase?tab=flashcards&deckId=deck-dna-cards");
  });

  it("enforces tenant workspace boundaries: Alice cannot see Charlie's private flashcard deck", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Quantum Relativity Concepts", mode: "lexical", types: "flashcard" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    // Alice has no access to Charlie's private deck
    expect(res.data.hits.some((h) => h.id === "deck-charlie-cards")).toBe(false);
    expect(res.data.counts.flashcard).toBe(0);
  });

  it("allows owner Charlie to retrieve his private flashcard deck", async () => {
    const res = await harness.dispatchSearchApiJson(
      { q: "Quantum Relativity Concepts", mode: "lexical", types: "flashcard" },
      charlie
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    const hit = res.data.hits.find((h) => h.id === "deck-charlie-cards");
    expect(hit).toBeDefined();
    expect(hit?.title).toBe("Quantum Relativity Concepts Deck");
  });

  it("confirms individual card-level content is deferred and not returned as separate search hits", async () => {
    // Seed card has front: "What enzyme breaks hydrogen bonds to unwind DNA at the replication fork?"
    // Searching for card question text should not return individual cards
    const res = await harness.dispatchSearchApiJson(
      { q: "unwind DNA at the replication fork", mode: "lexical", types: "flashcard" },
      alice
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);

    // Any hit with entityType flashcard MUST be a deck id, not an individual card id
    for (const hit of res.data.hits) {
      expect(hit.entityType).toBe("flashcard");
      expect(hit.id).not.toBe("card-dna-1");
      expect(hit.id).not.toBe("card-dna-2");
    }
  });

  it("supports searching FlashcardDecks shared within an active Study Group", async () => {
    const db = harness.store.createPrismaClientMock();
    await db.flashcardDeck.create({
      data: {
        id: "deck-group1-chem",
        title: "Organic Chemistry Group Reaction Deck",
        groupId: "group-1",
        ownerId: "user-alice",
      },
    });

    // Bob is a member of group-1
    const res = await harness.dispatchSearchApiJson(
      { q: "Organic Chemistry Group Reaction Deck", mode: "lexical", types: "flashcard" },
      bob
    );

    expect(res.status).toBe(200);
    assertSearchApiResponse(res.data);
    const hit = res.data.hits.find((h) => h.id === "deck-group1-chem");
    expect(hit).toBeDefined();
    expect(hit?.hierarchy.groupId).toBe("group-1");
  });
});
