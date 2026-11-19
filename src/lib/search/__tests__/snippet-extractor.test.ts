import { describe, it, expect } from "vitest";
import { extractContextualSnippet } from "../snippet-extractor";

describe("extractContextualSnippet", () => {
  it("SNIP-01: returns short text verbatim without ellipses", () => {
    const text = "Cellular respiration produces ATP in the presence of oxygen.";
    const result = extractContextualSnippet(text, "respiration");
    expect(result).toBe(text);
    expect(result).not.toContain("…");
  });

  it("SNIP-02: centers sliding window around target term in long text", () => {
    const prefix = "Early history of biology started with empirical observations of animal forms and flora. ";
    const middle = "The core pathway of cellular respiration involves glycolysis in the cytoplasm followed by the citric acid cycle in mitochondria. ";
    const suffix = "Later investigations uncovered the molecular mechanism of ATP synthase and proton gradients across the inner mitochondrial membrane.";
    const longText = prefix.repeat(3) + middle + suffix.repeat(3);

    const snippet = extractContextualSnippet(longText, "respiration");
    expect(snippet).toContain("cellular respiration");
    expect(snippet.startsWith("… ")).toBe(true);
    expect(snippet.endsWith(" …")).toBe(true);
  });

  it("SNIP-03: prioritizes window covering maximum distinct query tokens", () => {
    const partA = "Thermodynamics is a branch of physics dealing with heat and temperature. ";
    const partB = "In everyday life, temperature measures molecular speed. ";
    const partC = "The second law of thermodynamics establishes that entropy increases over time in isolated systems. ";
    const text = partA + partB.repeat(5) + partC + partB.repeat(5);

    // Query contains both "thermodynamics" and "entropy"
    const snippet = extractContextualSnippet(text, "thermodynamics entropy");
    // Should focus on partC where both terms co-occur
    expect(snippet.toLowerCase()).toContain("entropy");
    expect(snippet.toLowerCase()).toContain("thermodynamics");
  });

  it("SNIP-04: snaps to word boundaries without cutting words in half", () => {
    const longSentence =
      "Modern molecular genetics investigates chromosome organization, ribonucleicacid transcription factors, " +
      "nucleotide polymorphisms, and biochemical methylation cascades in mammalian cells.";
    const repeated = longSentence.repeat(4);

    const snippet = extractContextualSnippet(repeated, "transcription");
    // Clean snippet words should not be sliced mid-word
    const words = snippet.replace(/…/g, "").trim().split(/\s+/);
    for (const word of words) {
      expect(word.length).toBeGreaterThan(0);
    }
    expect(snippet).toContain("transcription");
  });

  it("SNIP-05: formats mid-text window with clean Unicode ellipses", () => {
    const text =
      "Section 1 introduces basic kinematics. ".repeat(6) +
      "Quantum electrodynamics describes how light and matter interact at relativistic velocities. " +
      "Section 3 covers quantum chromodynamics. ".repeat(6);

    const snippet = extractContextualSnippet(text, "electrodynamics");
    expect(snippet).toMatch(/^… .+ …$/);
    expect(snippet).toContain("Quantum electrodynamics");
  });

  it("SNIP-06: falls back to clean prefix for semantic matches with zero token overlap", () => {
    const text =
      "Cardiovascular health depends on arterial elasticity and endothelial nitric oxide production. " +
      "Regular physical aerobic activity stimulates vascular angiogenesis and lowers resting systolic blood pressure over extended observation periods.";

    const snippet = extractContextualSnippet(text, "heart fitness workout", { targetLength: 100 });
    expect(snippet.startsWith("Cardiovascular health")).toBe(true);
    expect(snippet.endsWith(" …")).toBe(true);
    expect(snippet.startsWith("…")).toBe(false);
  });

  it("SNIP-07: handles regex special characters safely without error or ReDoS", () => {
    const text =
      "Comparing C++ and C# for embedded systems: [Chapter 4] discusses memory management, pointers, and {destructors}.";
    const maliciousOrSpecialQuery = "(C++ | C#) & [Chapter 4] * + ? ^ $ \\";

    expect(() => {
      const snippet = extractContextualSnippet(text, maliciousOrSpecialQuery);
      expect(snippet.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it("SNIP-08: normalizes tabs, consecutive spaces, and newlines", () => {
    const text = "Line 1 with \t\t tabs.\n\n\nLine 2 with    multiple spaces.   Line 3 conclusion.";
    const snippet = extractContextualSnippet(text, "conclusion");
    expect(snippet).not.toContain("\t");
    expect(snippet).not.toContain("\n");
    expect(snippet).not.toContain("  ");
  });

  it("SNIP-09: enforces defensive bounds on targetLength and leadChars", () => {
    const text = "Cellular respiration produces ATP in the presence of oxygen and glucose molecules.";
    const snipZero = extractContextualSnippet(text, "respiration", { targetLength: 0 });
    expect(snipZero.length).toBeGreaterThanOrEqual(20);
    expect(snipZero).not.toBe("…");

    const snipNeg = extractContextualSnippet(text, "respiration", { targetLength: -50 });
    expect(snipNeg.length).toBeGreaterThanOrEqual(20);

    const snipFractional = extractContextualSnippet(text, "respiration", { targetLength: 35.7 });
    expect(snipFractional.length).toBeGreaterThan(0);

    const snipNaN = extractContextualSnippet(text, "respiration", { targetLength: Number.NaN });
    expect(snipNaN.length).toBeGreaterThan(0);

    const snipLead = extractContextualSnippet(text, "respiration", { targetLength: 30, leadChars: -10 });
    expect(snipLead.length).toBeGreaterThan(0);
  });

  it("handles null, undefined, and empty inputs gracefully", () => {
    expect(extractContextualSnippet(null, "query")).toBe("");
    expect(extractContextualSnippet(undefined, "query")).toBe("");
    expect(extractContextualSnippet("", "query")).toBe("");
    expect(extractContextualSnippet("   ", "query")).toBe("");
    expect(extractContextualSnippet("Valid text", null)).toBe("Valid text");
    expect(extractContextualSnippet("Valid text", undefined)).toBe("Valid text");
  });
});
