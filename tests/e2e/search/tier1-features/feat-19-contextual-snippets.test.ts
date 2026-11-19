/**
 * Tier 1 — Feature 19: Contextual Snippets & Highlighting
 *
 * Verifies 160-character sliding window snippet extraction, match centering,
 * boundary ellipsis formatting, and safe text handling without XSS vulnerabilities.
 */

import { describe, it, expect } from "vitest";
import { SearchTestHarness } from "../harness/search-test-harness";

describe("Tier 1 — Feat 19: Contextual Snippets & Highlighting", () => {
  const harness = new SearchTestHarness();

  it("bounds extracted snippet length to approximately 160 characters", () => {
    const longText =
      "In molecular biology, DNA replication is the biological process of producing two identical replicas of DNA from one original DNA molecule. DNA helicase unwinds the double helix at the replication fork by breaking hydrogen bonds between base pairs. DNA polymerase III then synthesizes the leading strand continuously in the 5' to 3' direction while lagging strand synthesis produces Okazaki fragments.";

    const snippet = harness.extractContextualSnippet(longText, "helicase", 160);

    // Bounded length (160 chars plus possible ellipsis "... ")
    expect(snippet.length).toBeLessThanOrEqual(170);
    expect(snippet.toLowerCase()).toContain("helicase");
  });

  it("centers the sliding window around the location of the query match", () => {
    const prefix = "A".repeat(200);
    const suffix = "B".repeat(200);
    const target = "CRITICAL_KEYWORD_MATCH";
    const fullText = `${prefix} ${target} ${suffix}`;

    const snippet = harness.extractContextualSnippet(fullText, "CRITICAL_KEYWORD_MATCH", 160);

    expect(snippet).toContain("CRITICAL_KEYWORD_MATCH");
    // Should have leading and trailing ellipsis because match is in the middle
    expect(snippet.startsWith("...")).toBe(true);
    expect(snippet.endsWith("...")).toBe(true);
  });

  it("returns short text in full without leading or trailing ellipsis", () => {
    const shortText = "Brief summary of DNA helicase.";
    const snippet = harness.extractContextualSnippet(shortText, "helicase", 160);

    expect(snippet).toBe(shortText);
    expect(snippet.startsWith("...")).toBe(false);
    expect(snippet.endsWith("...")).toBe(false);
  });

  it("safely sanitizes HTML and script tags to prevent XSS injection attacks", () => {
    const maliciousText = "Hello <script>alert('pwned')</script> world with helicase concept.";
    const snippet = harness.extractContextualSnippet(maliciousText, "helicase", 160);

    // Text content is preserved as pure string without executing HTML
    expect(typeof snippet).toBe("string");
    expect(snippet).toContain("helicase");

    // Safe sanitization: script tags are escaped so no executable <script> exists
    const safeRegex = /<script.*?>/i;
    const isRawHtmlInjected = safeRegex.test(snippet);
    expect(isRawHtmlInjected).toBe(false);
    expect(snippet).not.toContain("<script>");
    expect(snippet).toContain("&lt;script&gt;");
  });

  it("falls back gracefully when text does not match query tokens", () => {
    const text = "A".repeat(300);
    const snippet = harness.extractContextualSnippet(text, "unmatched_query", 160);

    expect(snippet.length).toBeLessThanOrEqual(165);
    expect(snippet.endsWith("...")).toBe(true);
  });

  it("handles empty or whitespace-only text inputs defensively", () => {
    expect(harness.extractContextualSnippet("", "query", 160)).toBe("");
    expect(harness.extractContextualSnippet("   ", "query", 160)).toBe("");
  });
});
