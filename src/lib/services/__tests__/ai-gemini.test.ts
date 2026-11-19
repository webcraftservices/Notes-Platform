import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "@google/genai";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { GeminiAIService, createGeminiAIService } from "@/lib/services/ai-gemini";
import { getAIService } from "@/lib/services/ai";
import { ServiceNotConfiguredError, AIProviderUnavailableError } from "@/lib/services/interfaces";

/** A minimal fake of the one Gemini client surface GeminiAIService touches. */
function fakeClient(generateContent: (params: GenerateContentParameters) => Promise<GenerateContentResponse>) {
  return { models: { generateContent } };
}

function fakeResponse(overrides: Partial<GenerateContentResponse> & { text?: string }): GenerateContentResponse {
  return {
    candidates: [{ finishReason: "STOP" as any }],
    ...overrides,
  } as GenerateContentResponse;
}

describe("GeminiAIService", () => {
  it("reports its provider/model identifiers for usage accounting", () => {
    const service = new GeminiAIService(fakeClient(vi.fn()));
    expect(service.providerName).toBe("gemini");
    expect(service.modelName).toBe("gemini-2.5-flash-lite");
  });
});

describe("GeminiAIService.chat", () => {
  it("returns real content and token counts on a successful call", async () => {
    const generateContent = vi.fn().mockResolvedValue(
      fakeResponse({
        text: "Thermal equilibrium means no net heat flow between two systems.",
        usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 13 },
      })
    );
    const service = new GeminiAIService(fakeClient(generateContent));

    const result = await service.chat({ messages: [{ role: "user", content: "What is thermal equilibrium?" }] });

    expect(result.content).toBe("Thermal equilibrium means no net heat flow between two systems.");
    expect(result.tokensInput).toBe(42);
    expect(result.tokensOutput).toBe(13);
  });

  it("maps 'assistant' role messages to Gemini's 'model' role and keeps 'user' as-is", async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse({ text: "ok", usageMetadata: {} }));
    const service = new GeminiAIService(fakeClient(generateContent));

    await service.chat({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "follow up" },
      ],
    });

    const params = generateContent.mock.calls[0]![0] as GenerateContentParameters;
    expect(params.contents).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "hello" }] },
      { role: "user", parts: [{ text: "follow up" }] },
    ]);
  });

  it("includes the hallucination-control system instruction on every call", async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse({ text: "ok", usageMetadata: {} }));
    const service = new GeminiAIService(fakeClient(generateContent));

    await service.chat({ messages: [{ role: "user", content: "hi" }] });

    const params = generateContent.mock.calls[0]![0] as GenerateContentParameters;
    const systemInstruction = params.config?.systemInstruction as string;
    expect(systemInstruction).toContain("Zenote");
    expect(systemInstruction.toLowerCase()).toContain("wasn't found in the user's uploaded materials");
    expect(systemInstruction.toLowerCase()).toContain("never fabricate");
  });

  it("weaves retrieved RAG context into the system instruction, not the message list", async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse({ text: "ok", usageMetadata: {} }));
    const service = new GeminiAIService(fakeClient(generateContent));

    await service.chat({
      messages: [{ role: "user", content: "What is the zeroth law?" }],
      context: "[1] Source: Thermodynamics.pdf — Page 8\nThe zeroth law states...",
    });

    const params = generateContent.mock.calls[0]![0] as GenerateContentParameters;
    const systemInstruction = params.config?.systemInstruction as string;
    expect(systemInstruction).toContain("Thermodynamics.pdf — Page 8");
    expect(params.contents).toEqual([{ role: "user", parts: [{ text: "What is the zeroth law?" }] }]);
  });

  it("tells the model explicitly when no context was retrieved", async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse({ text: "ok", usageMetadata: {} }));
    const service = new GeminiAIService(fakeClient(generateContent));

    await service.chat({ messages: [{ role: "user", content: "hi" }] });

    const params = generateContent.mock.calls[0]![0] as GenerateContentParameters;
    const systemInstruction = params.config?.systemInstruction as string;
    expect(systemInstruction).toContain("No course material context was retrieved");
  });

  it("defaults missing token counts to 0 rather than throwing", async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse({ text: "ok" }));
    const service = new GeminiAIService(fakeClient(generateContent));

    const result = await service.chat({ messages: [{ role: "user", content: "hi" }] });

    expect(result.tokensInput).toBe(0);
    expect(result.tokensOutput).toBe(0);
  });

  it("rejects an empty/whitespace-only response rather than returning it", async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse({ text: "   ", usageMetadata: {} }));
    const service = new GeminiAIService(fakeClient(generateContent));

    await expect(service.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/empty response/i);
  });

  it("rejects a call with no user/assistant messages before ever calling the API", async () => {
    const generateContent = vi.fn();
    const service = new GeminiAIService(fakeClient(generateContent));

    await expect(service.chat({ messages: [{ role: "system", content: "irrelevant" }] })).rejects.toThrow(/no user\/assistant messages/i);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("surfaces a clear error (including the API status) when the Gemini request itself fails", async () => {
    const apiError = new ApiError({ message: "Rate limit exceeded", status: 429 });
    const generateContent = vi.fn().mockRejectedValue(apiError);
    const service = new GeminiAIService(fakeClient(generateContent));

    await expect(service.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/429/);
  });

  it("never fabricates a reply when the API call throws — the error propagates instead", async () => {
    const generateContent = vi.fn().mockRejectedValue(new Error("network down"));
    const service = new GeminiAIService(fakeClient(generateContent));

    await expect(service.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/network down/);
  });

  /**
   * Phase 9.1 — provider-unavailable classification (spec §16-17). These
   * pin the *type* of the thrown error (not just its message, already
   * covered above) so route handlers can map it to a clean 503 without
   * string-matching, while genuinely-bad-request-shaped provider errors
   * stay generic (unexpected/internal) rather than being reported as
   * "temporarily unavailable".
   */
  describe("provider-unavailable classification", () => {
    it("classifies a network/connection-level failure (non-ApiError) as AIProviderUnavailableError", async () => {
      const generateContent = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
      const service = new GeminiAIService(fakeClient(generateContent));

      await expect(service.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
        AIProviderUnavailableError
      );
    });

    it("classifies an upstream 429 (ApiError) as AIProviderUnavailableError", async () => {
      const apiError = new ApiError({ message: "Rate limit exceeded", status: 429 });
      const generateContent = vi.fn().mockRejectedValue(apiError);
      const service = new GeminiAIService(fakeClient(generateContent));

      await expect(service.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
        AIProviderUnavailableError
      );
    });

    it("classifies an upstream 503 (ApiError) as AIProviderUnavailableError", async () => {
      const apiError = new ApiError({ message: "Service unavailable", status: 503 });
      const generateContent = vi.fn().mockRejectedValue(apiError);
      const service = new GeminiAIService(fakeClient(generateContent));

      await expect(service.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
        AIProviderUnavailableError
      );
    });

    it("does NOT classify a 400 bad-request ApiError as unavailable — it's a real bug, not an outage", async () => {
      const apiError = new ApiError({ message: "Invalid argument", status: 400 });
      const generateContent = vi.fn().mockRejectedValue(apiError);
      const service = new GeminiAIService(fakeClient(generateContent));

      const rejection = service.chat({ messages: [{ role: "user", content: "hi" }] });
      await expect(rejection).rejects.not.toBeInstanceOf(AIProviderUnavailableError);
      await expect(rejection).rejects.toThrow(/400/);
    });

    it("applies the same classification to generateNotes()", async () => {
      const apiError = new ApiError({ message: "Service unavailable", status: 502 });
      const generateContent = vi.fn().mockRejectedValue(apiError);
      const service = new GeminiAIService(fakeClient(generateContent));

      await expect(
        service.generateNotes({ transcriptText: "text", templateKind: "lecture" })
      ).rejects.toBeInstanceOf(AIProviderUnavailableError);
    });
  });
});

describe("GeminiAIService.generateNotes", () => {
  it("parses a well-formed JSON array response into note blocks", async () => {
    const generateContent = vi.fn().mockResolvedValue(
      fakeResponse({
        text: JSON.stringify([
          { kind: "DEFINITION", heading: "Thermal Equilibrium", content: "Two systems are..." },
          { kind: "SUMMARY", content: "In summary..." },
        ]),
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
      })
    );
    const service = new GeminiAIService(fakeClient(generateContent));

    const result = await service.generateNotes({ transcriptText: "some lecture transcript", templateKind: "lecture" });

    expect(result.blocks).toEqual([
      { kind: "DEFINITION", heading: "Thermal Equilibrium", content: "Two systems are..." },
      { kind: "SUMMARY", heading: undefined, content: "In summary..." },
    ]);
  });

  it("requests JSON output with a schema, and includes the hallucination-control instruction", async () => {
    const generateContent = vi.fn().mockResolvedValue(
      fakeResponse({ text: JSON.stringify([{ kind: "SUMMARY", content: "Meeting summary." }]), usageMetadata: {} })
    );
    const service = new GeminiAIService(fakeClient(generateContent));

    await service.generateNotes({ transcriptText: "transcript text", templateKind: "meeting" });

    const params = generateContent.mock.calls[0]![0] as GenerateContentParameters;
    expect(params.config?.responseMimeType).toBe("application/json");
    expect(params.config?.responseSchema).toBeDefined();
    expect(params.config?.systemInstruction).toContain("Zenote");
  });

  it("rejects a non-array JSON response", async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse({ text: JSON.stringify({ not: "an array" }), usageMetadata: {} }));
    const service = new GeminiAIService(fakeClient(generateContent));

    await expect(service.generateNotes({ transcriptText: "t", templateKind: "lecture" })).rejects.toThrow(/JSON array/);
  });

  it("rejects invalid (non-JSON) output despite the requested schema", async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse({ text: "not json at all", usageMetadata: {} }));
    const service = new GeminiAIService(fakeClient(generateContent));

    await expect(service.generateNotes({ transcriptText: "t", templateKind: "lecture" })).rejects.toThrow(/valid JSON/);
  });

  it("rejects a block missing the required kind/content fields", async () => {
    const generateContent = vi.fn().mockResolvedValue(
      fakeResponse({ text: JSON.stringify([{ heading: "Missing kind and content" }]), usageMetadata: {} })
    );
    const service = new GeminiAIService(fakeClient(generateContent));

    await expect(service.generateNotes({ transcriptText: "t", templateKind: "lecture" })).rejects.toThrow(/kind.*content/i);
  });

  it("rejects an empty response", async () => {
    const generateContent = vi.fn().mockResolvedValue(fakeResponse({ text: "", usageMetadata: {} }));
    const service = new GeminiAIService(fakeClient(generateContent));

    await expect(service.generateNotes({ transcriptText: "t", templateKind: "lecture" })).rejects.toThrow(/empty response/i);
  });

  describe("Source unit attribution and validation", () => {
    it("includes explicit source attribution instructions in prompt when sourceUnits is provided", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            { kind: "OVERVIEW", content: "Overview content", sourcePageNumbers: [1] },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      await service.generateNotes({
        sourceText: "--- Page 1 ---\nContent on page 1\n\n--- Page 2 ---\nContent on page 2",
        sourceType: "document",
        sourceUnits: { unitType: "page", availableUnits: [1, 2] },
      });

      const params = generateContent.mock.calls[0]![0] as GenerateContentParameters;
      const promptText = (params.contents as Array<{ parts: Array<{ text: string }> }>)[0]?.parts[0]?.text;
      expect(promptText).toContain("Source attribution instructions:");
      expect(promptText).toContain('labeled "--- Page <number> ---"');
      expect(promptText).toContain("Available page numbers: 1, 2");
      expect(promptText).toContain('"sourcePageNumbers"');
    });

    it("validates and attaches valid sourcePageNumbers returned by Gemini", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            { kind: "OVERVIEW", heading: "First", content: "Page 1 content", sourcePageNumbers: [1] },
            { kind: "APPLICATION", heading: "Multi", content: "Spans 1 and 2", sourcePageNumbers: [1, 2] },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: "--- Slide 1 ---\nSlide 1\n\n--- Slide 2 ---\nSlide 2",
        sourceType: "document",
        sourceUnits: { unitType: "slide", availableUnits: [1, 2] },
      });

      expect(res.blocks).toEqual([
        { kind: "OVERVIEW", heading: "First", content: "Page 1 content", sourcePages: [1] },
        { kind: "APPLICATION", heading: "Multi", content: "Spans 1 and 2", sourcePages: [1, 2] },
      ]);
    });

    it("deduplicates and sorts sourcePageNumbers ascending", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            { kind: "CORE_CONCEPT", content: "Concept", sourcePageNumbers: [3, 1, 3] },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: "--- Page 1 ---\n1\n\n--- Page 2 ---\n2\n\n--- Page 3 ---\n3",
        sourceType: "document",
        sourceUnits: { unitType: "page", availableUnits: [1, 2, 3] },
      });

      expect(res.blocks[0]?.sourcePages).toEqual([1, 3]);
    });

    it("filters out out-of-range, negative, or non-integer page numbers", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            { kind: "DEFINITION", content: "Def", sourcePageNumbers: [2, 999, -1, 1.5] },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: "--- Page 1 ---\n1\n\n--- Page 2 ---\n2",
        sourceType: "document",
        sourceUnits: { unitType: "page", availableUnits: [1, 2] },
      });

      expect(res.blocks[0]?.sourcePages).toEqual([2]);
    });

    it("omits sourcePages when all returned page numbers are invalid or out-of-range", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            { kind: "SUMMARY", content: "Summary", sourcePageNumbers: [999, -5] },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: "--- Page 1 ---\n1",
        sourceType: "document",
        sourceUnits: { unitType: "page", availableUnits: [1] },
      });

      expect(res.blocks[0]?.sourcePages).toBeUndefined();
    });

    it("omits sourcePages when Gemini returns no sourcePageNumbers or an empty array", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            { kind: "SUMMARY", content: "Summary without pages" },
            { kind: "OVERVIEW", content: "Overview with empty array", sourcePageNumbers: [] },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: "--- Page 1 ---\n1",
        sourceType: "document",
        sourceUnits: { unitType: "page", availableUnits: [1] },
      });

      expect(res.blocks[0]?.sourcePages).toBeUndefined();
      expect(res.blocks[1]?.sourcePages).toBeUndefined();
    });

    it("discards model-generated sourcePageNumbers when sourceUnits was not supplied (e.g. DOCX)", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            { kind: "OVERVIEW", content: "Docx overview", sourcePageNumbers: [1, 2] },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: "DOCX text with no page units.",
        sourceType: "document",
      });

      // Model returned [1, 2], but since no sourceUnits were provided, attribution is safely discarded
      expect(res.blocks[0]?.sourcePages).toBeUndefined();

      const params = generateContent.mock.calls[0]![0] as GenerateContentParameters;
      const promptText = (params.contents as Array<{ parts: Array<{ text: string }> }>)[0]?.parts[0]?.text;
      expect(promptText).not.toContain("Source attribution instructions:");
    });
  });

  describe("Phase 11.3.5C: Source Grounding and Adversarial Citation Verification", () => {
    const multiPageSourceText = [
      "--- Page 1 ---",
      "Photosynthesis converts light energy into chemical energy within chloroplasts.",
      "",
      "--- Page 2 ---",
      "Cellular respiration breaks down glucose to produce ATP in the mitochondria.",
      "",
      "--- Page 3 ---",
      "DNA replication occurs in the five prime to three prime direction via DNA polymerase.",
      "",
      "--- Page 4 ---",
      "Mitosis consists of prophase metaphase anaphase and telophase.",
    ].join("\n");

    const sourceUnits = { unitType: "page" as const, availableUnits: [1, 2, 3, 4] };

    it("verifies grounding when block references a page with an authentic verbatim sourceQuote", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            {
              kind: "DEFINITION",
              content: "Respiration creates ATP in mitochondria.",
              sourcePageNumbers: [2],
              sourceQuote: "produce ATP in the mitochondria",
            },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: multiPageSourceText,
        sourceType: "document",
        sourceUnits,
      });

      expect(res.blocks[0]?.sourcePages).toEqual([2]);
      expect(res.blocks[0]?.sourceQuote).toBe("produce ATP in the mitochondria");
    });

    it("fails closed and drops sourcePages when block references Page 4 but quotes text from Page 2 (cross-page misattribution)", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            {
              kind: "DEFINITION",
              content: "Respiration creates ATP in mitochondria.",
              sourcePageNumbers: [4], // Adversarial: citations point to page 4
              sourceQuote: "produce ATP in the mitochondria", // Quote is actually from page 2
            },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: multiPageSourceText,
        sourceType: "document",
        sourceUnits,
      });

      // Grounding check failed on Page 4 because Page 4 does not contain the quote.
      // Must drop sourcePages and must NOT silently reassign to Page 2.
      expect(res.blocks[0]?.sourcePages).toBeUndefined();
      expect(res.blocks[0]?.sourceQuote).toBeUndefined();
      expect(res.blocks[0]?.content).toBe("Respiration creates ATP in mitochondria.");
    });

    it("fails closed and drops sourcePages when block provides a completely fabricated quotation not in the document", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            {
              kind: "DEFINITION",
              content: "Mitochondria fly in outer space.",
              sourcePageNumbers: [2],
              sourceQuote: "mitochondria fly through quantum portals",
            },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: multiPageSourceText,
        sourceType: "document",
        sourceUnits,
      });

      expect(res.blocks[0]?.sourcePages).toBeUndefined();
    });

    it("filters multi-page references to only those pages where the quotation actually appears", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            {
              kind: "EXPLANATION",
              content: "Energy processes in cells.",
              sourcePageNumbers: [2, 4], // Cites 2 and 4, but quote is only in 2
              sourceQuote: "Cellular respiration breaks down glucose",
            },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: multiPageSourceText,
        sourceType: "document",
        sourceUnits,
      });

      // Retains only page 2, excludes page 4
      expect(res.blocks[0]?.sourcePages).toEqual([2]);
    });

    it("retains multi-page references when quotation appears across cited units", async () => {
      const multiSource = [
        "--- Page 1 ---",
        "ATP is produced in stage one.",
        "",
        "--- Page 2 ---",
        "ATP is produced in stage two.",
      ].join("\n");

      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            {
              kind: "SUMMARY",
              content: "ATP synthesis across stages.",
              sourcePageNumbers: [1, 2],
              sourceQuote: "ATP is produced",
            },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: multiSource,
        sourceType: "document",
        sourceUnits: { unitType: "page", availableUnits: [1, 2] },
      });

      expect(res.blocks[0]?.sourcePages).toEqual([1, 2]);
    });

    it("preserves valid in-range reference under structural membership validation when no quote is supplied", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            {
              kind: "OVERVIEW",
              content: "Overview of cell biology.",
              sourcePageNumbers: [3],
              // sourceQuote omitted
            },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: multiPageSourceText,
        sourceType: "document",
        sourceUnits,
      });

      // Structural membership succeeds because 3 is in [1, 2, 3, 4]
      expect(res.blocks[0]?.sourcePages).toEqual([3]);
    });

    it("accepts block with empty sourcePageNumbers as an unattributed summary block", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            {
              kind: "SUMMARY",
              content: "High level summary of the entire chapter.",
              sourcePageNumbers: [],
            },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: multiPageSourceText,
        sourceType: "document",
        sourceUnits,
      });

      expect(res.blocks[0]?.sourcePages).toBeUndefined();
      expect(res.blocks[0]?.content).toBe("High level summary of the entire chapter.");
    });

    it("rejects out-of-range reference (e.g. Page 99) regardless of quotation", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            {
              kind: "DEFINITION",
              content: "Photosynthesis def.",
              sourcePageNumbers: [99],
              sourceQuote: "Photosynthesis converts light energy",
            },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: multiPageSourceText,
        sourceType: "document",
        sourceUnits,
      });

      expect(res.blocks[0]?.sourcePages).toBeUndefined();
    });

    it("accepts citation when block content is semantically unrelated to the page but sourceQuote is genuinely present on that page (lexical presence vs semantic entailment)", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            {
              kind: "DEFINITION",
              // Content is completely fabricated / unrelated to biology on Page 2
              content: "Quantum gravity fluctuations generate electromagnetic anomalies.",
              sourcePageNumbers: [2],
              // Quote is genuinely present on Page 2
              sourceQuote: "produce ATP in the mitochondria",
            },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: multiPageSourceText,
        sourceType: "document",
        sourceUnits,
      });

      // The citation is accepted because "produce ATP in the mitochondria" is lexically present on Page 2.
      // This proves that quotation matching verifies lexical presence on the page, not semantic entailment
      // or factual accuracy of the block's text.
      expect(res.blocks[0]?.sourcePages).toEqual([2]);
      expect(res.blocks[0]?.sourceQuote).toBe("produce ATP in the mitochondria");
      expect(res.blocks[0]?.content).toBe("Quantum gravity fluctuations generate electromagnetic anomalies.");
    });

    it("fails closed and drops sourcePages when a quotation spans across the boundary of two consecutive pages so neither page independently contains it", async () => {
      const generateContent = vi.fn().mockResolvedValue(
        fakeResponse({
          candidates: [{ finishReason: "STOP" as any }],
          text: JSON.stringify([
            {
              kind: "EXPLANATION",
              content: "Coupled cellular bioenergetics.",
              sourcePageNumbers: [1, 2],
              // Quote straddles Page 1 and Page 2 boundary:
              sourceQuote: "within chloroplasts Cellular respiration breaks down",
            },
          ]),
        })
      );
      const service = new GeminiAIService(fakeClient(generateContent));

      const res = await service.generateNotes({
        sourceText: multiPageSourceText,
        sourceType: "document",
        sourceUnits,
      });

      // Neither Page 1 nor Page 2 independently contains the complete cross-page quotation string.
      // The implementation ensures it does NOT falsely claim both pages (or either page) are grounded;
      // it fails closed and discards sourcePages.
      expect(res.blocks[0]?.sourcePages).toBeUndefined();
    });
  });
});

describe("createGeminiAIService", () => {
  const originalKey = process.env.GOOGLE_AI_API_KEY;

  beforeEach(() => {
    delete process.env.GOOGLE_AI_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = originalKey;
  });

  it("throws ServiceNotConfiguredError when GOOGLE_AI_API_KEY is missing", () => {
    expect(() => createGeminiAIService()).toThrow(ServiceNotConfiguredError);
  });

  it("names GOOGLE_AI_API_KEY specifically in the configuration error", () => {
    expect(() => createGeminiAIService()).toThrow(/GOOGLE_AI_API_KEY/);
  });

  it("constructs successfully once GOOGLE_AI_API_KEY is set, without ever logging the key", () => {
    process.env.GOOGLE_AI_API_KEY = "fake-key-not-a-real-key";
    const logSpy = vi.spyOn(console, "log");
    const errorSpy = vi.spyOn(console, "error");

    const service = createGeminiAIService();

    expect(service).toBeInstanceOf(GeminiAIService);
    for (const spy of [logSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        expect(call.join(" ")).not.toContain("fake-key-not-a-real-key");
      }
    }
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("getAIService (registry) with AI_PROVIDER=gemini", () => {
  const ENV_KEYS = ["AI_PROVIDER", "GOOGLE_AI_API_KEY"];
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("throws ServiceNotConfiguredError when AI_PROVIDER is unset", () => {
    expect(() => getAIService()).toThrow(ServiceNotConfiguredError);
  });

  it("throws ServiceNotConfiguredError for an unimplemented provider name", () => {
    process.env.AI_PROVIDER = "anthropic";
    expect(() => getAIService()).toThrow(ServiceNotConfiguredError);
  });

  /**
   * DISCOVERED PRE-EXISTING LIMITATION, same as documented in
   * embedding-openai.test.ts (not introduced by this change, not fixed
   * here — out of scope): ai.ts's `provider === "gemini"` branch hands off
   * via a bare `require("./ai-gemini")`, exactly mirroring speech.ts's
   * `require()` pattern. Under this project's Vitest setup, native
   * `require()` of any relative/`@/`-aliased `.ts` module path fails to
   * resolve at test time, regardless of the target file's content — a
   * Vitest/Node module-resolution quirk (native `require` bypasses Vite's
   * transform pipeline), not a defect in this file or in ai.ts. Real
   * Next.js/webpack bundling resolves `require()` calls correctly at build
   * time. GeminiAIService/createGeminiAIService are fully covered above
   * via normal `import`, which Vitest resolves correctly — only this
   * require()-based hand-off is untestable here.
   */
  it.skip("returns a real GeminiAIService when AI_PROVIDER=gemini and GOOGLE_AI_API_KEY is set (untestable under Vitest's require() resolution)", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GOOGLE_AI_API_KEY = "fake-key-not-a-real-key";
    expect(getAIService()).toBeInstanceOf(GeminiAIService);
  });

  it.skip("still throws ServiceNotConfiguredError when AI_PROVIDER=gemini but GOOGLE_AI_API_KEY is missing (untestable under Vitest's require() resolution)", () => {
    process.env.AI_PROVIDER = "gemini";
    expect(() => getAIService()).toThrow(ServiceNotConfiguredError);
  });
});
