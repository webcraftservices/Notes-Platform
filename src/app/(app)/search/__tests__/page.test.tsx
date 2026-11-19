import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { HighlightedSnippet } from "@/components/search/highlighted-snippet";
import { SearchResultsList } from "@/components/search/search-results-list";
import type { SearchHit } from "@/lib/search/rrf-ranking";

describe("Phase 12 Search UI Components (HighlightedSnippet & SearchResultsList)", () => {
  it("renders HighlightedSnippet with <mark> elements for matching query terms without XSS execution", () => {
    const html = renderToStaticMarkup(
      React.createElement(HighlightedSnippet, {
        snippet: 'Photosynthesis occurs inside <script>alert(1)</script> thylakoid membranes.',
        query: "photosynthesis thylakoid",
      })
    );

    expect(html).toContain("<mark");
    expect(html).toContain("Photosynthesis</mark>");
    expect(html).toContain("thylakoid</mark>");
    // Escaped script tag — never raw <script>
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders unified SearchResultsList across notes, materials, subjects, chapters, topics, groups, and flashcards with deep links", () => {
    const hits: SearchHit[] = [
      {
        id: "note-1",
        entityType: "note",
        title: "Lecture 1 Notes",
        snippet: "Key concepts of cellular respiration and ATP synthesis.",
        matchType: "hybrid",
        score: 0.032,
        hierarchy: {
          subjectId: "sub-1",
          subjectName: "Biology",
          chapterId: "ch-1",
          chapterName: "Metabolism",
          topicId: "top-1",
          topicName: "Respiration",
        },
        navigation: {
          href: "/subjects/sub-1/chapters/ch-1/topics/top-1?tab=notes",
        },
      },
      {
        id: "mat-1",
        entityType: "material",
        title: "Campbell Biology.pdf",
        snippet: "Page 42 covers oxidative phosphorylation.",
        matchType: "semantic",
        score: 0.016,
        hierarchy: {
          subjectId: "sub-1",
          subjectName: "Biology",
        },
        navigation: {
          href: "/materials/mat-1?page=42",
          pageNumber: 42,
        },
      },
      {
        id: "fd-1",
        entityType: "flashcard",
        title: "Krebs Cycle Flashcards",
        matchType: "lexical",
        score: 0.015,
        hierarchy: {
          subjectId: "sub-1",
          subjectName: "Biology",
          chapterId: "ch-1",
          chapterName: "Metabolism",
          topicId: "top-1",
          topicName: "Respiration",
        },
        navigation: {
          href: "/subjects/sub-1/chapters/ch-1/topics/top-1",
        },
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(SearchResultsList, {
        hits,
        query: "ATP phosphorylation",
      })
    );

    expect(html).toContain("Notes");
    expect(html).toContain("Materials");
    expect(html).toContain("Flashcard Decks");
    expect(html).toContain("Lecture 1 Notes");
    expect(html).toContain("AI+Text");
    expect(html).toContain("Page 42");
    expect(html).toContain("/materials/mat-1?page=42");
    expect(html).toContain("/subjects/sub-1/chapters/ch-1/topics/top-1?tab=notes");
    expect(html).toContain("Biology › Metabolism › Respiration");
  });
});
