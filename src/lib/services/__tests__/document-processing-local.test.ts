import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import { promises as fs } from "fs";
import {
  LocalDocumentProcessingService,
  MAX_PDF_PAGES,
  MAX_PPTX_SLIDES,
  MAX_PPTX_SLIDE_XML_BYTES,
  MAX_DOCUMENT_EXTRACTION_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_PPTX_TOTAL_ENTRIES,
  EXTRACTION_YIELD_INTERVAL,
  extractionLoopHelpers,
  reconstructPdfPageText,
  LayoutAmbiguityError,
} from "@/lib/services/document-processing-local";
import { LocalStorageService } from "@/lib/services/storage-local";
import { S3StorageService } from "@/lib/services/storage-s3";
import * as storageModule from "@/lib/services/storage";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

/** Resolves the real PDFPageProxy prototype from an actual loaded PDF.js document. */
async function getPdfPagePrototype() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fixtureBytes = await fs.readFile(path.join(FIXTURES_DIR, "single-page.pdf"));
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fixtureBytes) }).promise;
  const page = await doc.getPage(1);
  const pageProto = Object.getPrototypeOf(page);
  await doc.destroy();
  return pageProto;
}

describe("LocalDocumentProcessingService real parser integration tests", () => {
  let service: LocalDocumentProcessingService;

  beforeEach(() => {
    vi.restoreAllMocks();
    const localStorage = new LocalStorageService(FIXTURES_DIR);
    vi.spyOn(storageModule, "getStorageService").mockReturnValue(localStorage);
    service = new LocalDocumentProcessingService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. PDF EXTRACTION TESTS (Real pdfjs-dist)
  // =========================================================================
  describe("PDF extraction (pdfjs-dist)", () => {
    it(
      "extracts text from a single-page PDF with exact page number and text",
      async () => {
        const result = await service.extractText({
          storageKey: "single-page.pdf",
          mimeType: "application/pdf",
        });

        expect(result.text).toContain("Zenote Lecture Intelligence: Introduction to Thermodynamics and Energy Conservation.");
        expect(result.pages).toBeDefined();
        expect(result.pages).toHaveLength(1);

        const firstPage = result.pages![0]!;
        expect(firstPage.pageNumber).toBe(1);
        expect(firstPage.text).toContain("Thermodynamics and Energy Conservation");
      },
      15_000
    );

    it("extracts text across multiple pages preserving distinct page boundaries and ordering", async () => {
      const result = await service.extractText({
        storageKey: "multi-page.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toBeDefined();
      expect(result.pages).toHaveLength(3);

      // Verify 1-indexed sequential page numbering
      expect(result.pages!.map((p) => p.pageNumber)).toEqual([1, 2, 3]);

      // Page 1
      expect(result.pages![0]!.text).toContain("First Law of Thermodynamics");
      expect(result.pages![0]!.text).toContain("Energy cannot be created or destroyed");

      // Page 2
      expect(result.pages![1]!.text).toContain("Second Law of Thermodynamics");
      expect(result.pages![1]!.text).toContain("entropy of an isolated system always increases");

      // Page 3
      expect(result.pages![2]!.text).toContain("Third Law of Thermodynamics");
      expect(result.pages![2]!.text).toContain("temperature approaches absolute zero");

      // Full concatenated text joins pages with double newlines
      expect(result.text).toContain("First Law of Thermodynamics");
      expect(result.text).toContain("Second Law of Thermodynamics");
      expect(result.text).toContain("Third Law of Thermodynamics");
      expect(result.text).toBe(result.pages!.map((p) => p.text).join("\n\n"));
    });

    it("characterizes empty-page behavior: retains page entry with empty text without throwing", async () => {
      const result = await service.extractText({
        storageKey: "empty-page.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toBeDefined();
      expect(result.pages).toHaveLength(3);

      expect(result.pages![0]!.pageNumber).toBe(1);
      expect(result.pages![0]!.text).toContain("Content on page one before empty page.");

      // Empty page 2
      expect(result.pages![1]!.pageNumber).toBe(2);
      expect(result.pages![1]!.text).toBe("");

      expect(result.pages![2]!.pageNumber).toBe(3);
      expect(result.pages![2]!.text).toContain("Content on page three after empty page.");
    });

    it("calls page.cleanup() in a finally block for every acquired page during successful extraction", async () => {
      const pageProto = await getPdfPagePrototype();
      const cleanupSpy = vi.spyOn(pageProto, "cleanup");

      const result = await service.extractText({
        storageKey: "multi-page.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(3);
      // Exactly 3 pages acquired, exactly 3 page.cleanup() calls executed
      expect(cleanupSpy).toHaveBeenCalledTimes(3);
      cleanupSpy.mockRestore();
    });

    it("calls page.cleanup() even when getTextContent() throws an exception", async () => {
      const pageProto = await getPdfPagePrototype();
      const getTextContentSpy = vi
        .spyOn(pageProto, "getTextContent")
        .mockRejectedValueOnce(new Error("Simulated getTextContent failure"));
      const cleanupSpy = vi.spyOn(pageProto, "cleanup");

      await expect(
        service.extractText({
          storageKey: "single-page.pdf",
          mimeType: "application/pdf",
        })
      ).rejects.toThrow("Simulated getTextContent failure");

      // Cleanup must be called on page 1 even though text extraction threw
      expect(cleanupSpy).toHaveBeenCalledTimes(1);

      getTextContentSpy.mockRestore();
      cleanupSpy.mockRestore();
    });

    it("calls page.cleanup() on preceding pages and the failing page when a later page fails", async () => {
      const pageProto = await getPdfPagePrototype();
      const origGetTextContent = pageProto.getTextContent;
      let invocation = 0;
      const getTextContentSpy = vi.spyOn(pageProto, "getTextContent").mockImplementation(async function (this: any) {
        invocation += 1;
        if (invocation === 2) {
          throw new Error("Page 2 parse error");
        }
        return origGetTextContent.apply(this, arguments as any);
      });
      const cleanupSpy = vi.spyOn(pageProto, "cleanup");

      await expect(
        service.extractText({
          storageKey: "multi-page.pdf",
          mimeType: "application/pdf",
        })
      ).rejects.toThrow("Page 2 parse error");

      // Page 1 succeeded and cleaned up; Page 2 threw and cleaned up; Page 3 was never acquired
      expect(cleanupSpy).toHaveBeenCalledTimes(2);

      getTextContentSpy.mockRestore();
      cleanupSpy.mockRestore();
    });

    it("cooperatively yields via setImmediate at configured interval for long PDFs", async () => {
      const yieldSpy = vi.spyOn(extractionLoopHelpers, "yieldToEventLoop");

      const result = await service.extractText({
        storageKey: "eleven-pages.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(11);
      // Yield interval is 10: page 10 yields once (10 < 11), page 11 does not yield (11 < 11 is false)
      expect(yieldSpy).toHaveBeenCalledTimes(1);

      // Verify all 11 pages preserved in exact sequential order
      expect(result.pages!.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(result.text).toContain("Lecture Module Section 1");
      expect(result.text).toContain("Lecture Module Section 11");

      yieldSpy.mockRestore();
    });

    it("does not yield for short PDFs (pages <= EXTRACTION_YIELD_INTERVAL)", async () => {
      const yieldSpy = vi.spyOn(extractionLoopHelpers, "yieldToEventLoop");

      const result = await service.extractText({
        storageKey: "multi-page.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(3);
      // 3 pages <= 10 yield interval -> zero yields
      expect(yieldSpy).toHaveBeenCalledTimes(0);

      yieldSpy.mockRestore();
    });

    it("rejects PDFs exceeding MAX_PDF_PAGES with an honest, descriptive error", async () => {
      await expect(
        service.extractText({
          storageKey: "over-limit-pages.pdf",
          mimeType: "application/pdf",
        })
      ).rejects.toThrow(
        new RegExp(
          `This PDF exceeds the maximum supported page limit for text extraction \\(401 pages; limit is ${MAX_PDF_PAGES} pages\\)`
        )
      );
    });

    it("guarantees document-level pdf.destroy() is called in all outcomes (success and page limit exceeded)", async () => {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const fixtureBytes = await fs.readFile(path.join(FIXTURES_DIR, "single-page.pdf"));
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fixtureBytes) }).promise;
      const docProto = Object.getPrototypeOf(doc);
      await doc.destroy();

      const destroySpy = vi.spyOn(docProto, "destroy");

      try {
        // Outcome 1: Successful extraction
        await service.extractText({
          storageKey: "single-page.pdf",
          mimeType: "application/pdf",
        });
        expect(destroySpy).toHaveBeenCalledTimes(1);

        // Outcome 2: Boundary limit exceeded
        await expect(
          service.extractText({
            storageKey: "over-limit-pages.pdf",
            mimeType: "application/pdf",
          })
        ).rejects.toThrow(/exceeds the maximum supported page limit/);
        expect(destroySpy).toHaveBeenCalledTimes(2);
      } finally {
        destroySpy.mockRestore();
      }
    });

    it("handles corrupt PDF with a controlled failure and descriptive user error", async () => {
      await expect(
        service.extractText({
          storageKey: "corrupt.pdf",
          mimeType: "application/pdf",
        })
      ).rejects.toThrow(/Couldn't read this PDF — it may be corrupted or password-protected/);
    });

    it("reconstructs multiple paragraphs with exact paragraph breaks (\\n\\n) and line breaks (\\n)", async () => {
      const result = await service.extractText({
        storageKey: "multi-paragraph.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      // Verify exact paragraph split with double newline
      const expectedText =
        "Thermodynamics is a branch of physics that deals with heat,\n" +
        "work, and temperature, and their relation to energy, radiation,\n" +
        "and physical properties of matter.\n\n" +
        "The behavior of these quantities is governed by the four laws\n" +
        "of thermodynamics which convey a quantitative description.";

      expect(pageText).toBe(expectedText);
      expect(result.text).toBe(expectedText);

      // Verify paragraphs are separated by \n\n
      const paragraphs = pageText.split("\n\n");
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[0]).toContain("Thermodynamics is a branch of physics");
      expect(paragraphs[1]).toContain("The behavior of these quantities is governed");
    });

    it("reconstructs adjacent split text items and kerning without artificial intra-word spaces", async () => {
      const result = await service.extractText({
        storageKey: "split-kerning.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      // Assert exact line reconstruction
      const expectedText = "Thermodynamics\nPhotosynthesis\nMulticellular organisms";
      expect(pageText).toBe(expectedText);

      // Verify no artificial spaces in split/kerned words
      expect(pageText).not.toContain("Ther modynamics");
      expect(pageText).not.toContain("Photo synthesis");
      expect(pageText).not.toContain("Multi cellular");
      expect(pageText).toContain("Thermodynamics");
      expect(pageText).toContain("Photosynthesis");
      expect(pageText).toContain("Multicellular organisms");
    });

    it("preserves consecutive lines within a single compact block using \\n without artificial paragraph breaks", async () => {
      const result = await service.extractText({
        storageKey: "multi-line.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const expectedText =
        "First consecutive line of continuous lecture notes without break.\n" +
        "Second consecutive line following normal line spacing interval.\n" +
        "Third consecutive line completing the compact single block.";

      expect(pageText).toBe(expectedText);
      // Compact lines must be separated by single \n, not \n\n
      expect(pageText).not.toContain("\n\n");
      expect(pageText.split("\n")).toHaveLength(3);
    });

    it("preserves bulleted and indented list items on separate lines with heading paragraph separation", async () => {
      const result = await service.extractText({
        storageKey: "bullet-list.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const expectedText =
        "Key Principles of Modern Computing:\n\n" +
        "- Abstraction layers separate interface from implementation\n" +
        "- Concurrency requires synchronization and mutual exclusion\n" +
        "- Caching exploits spatial and temporal locality";

      expect(pageText).toBe(expectedText);
      const parts = pageText.split("\n\n");
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe("Key Principles of Modern Computing:");
      const listItems = parts[1]!.split("\n");
      expect(listItems).toHaveLength(3);
      expect(listItems[0]).toBe("- Abstraction layers separate interface from implementation");
      expect(listItems[1]).toBe("- Concurrency requires synchronization and mutual exclusion");
      expect(listItems[2]).toBe("- Caching exploits spatial and temporal locality");
    });

    it("reconstructs superscripts and subscripts within their logical lines without artificial line breaks", async () => {
      const result = await service.extractText({
        storageKey: "superscript-subscript.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const expectedText =
        "Einstein formulated E = mc2 in 1905.\n" +
        "Water consists of H2O molecules.\n" +
        "Reference note on quantum mechanics1 shows theoretical convergence.";

      expect(pageText).toBe(expectedText);
      expect(pageText.split("\n")).toHaveLength(3);
      // Verify superscripts/subscripts are NOT broken onto separate lines
      expect(pageText).not.toContain("2\nEinstein");
      expect(pageText).not.toContain("2\nWater");
      expect(pageText).not.toContain("1\nReference");
    });

    it("preserves double-spaced paragraphs with ordinary line breaks (\\n) and paragraph breaks (\\n\\n)", async () => {
      const result = await service.extractText({
        storageKey: "double-spaced.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const parts = pageText.split("\n\n");
      expect(parts).toHaveLength(2);

      const para1Lines = parts[0]!.split("\n");
      expect(para1Lines).toHaveLength(3);
      expect(para1Lines[0]).toBe("This is the first line of a double-spaced academic paper draft.");
      expect(para1Lines[1]).toBe("This is the second consecutive line of the first paragraph.");
      expect(para1Lines[2]).toBe("This is the third concluding line of the first paragraph.");

      const para2Lines = parts[1]!.split("\n");
      expect(para2Lines).toHaveLength(2);
      expect(para2Lines[0]).toBe("This begins the second distinct paragraph after a larger vertical gap.");
      expect(para2Lines[1]).toBe("This is the final line of the second double-spaced paragraph.");
    });

    it("preserves 1.5-spaced paragraphs with ordinary line breaks (\\n) and paragraph breaks (\\n\\n)", async () => {
      const result = await service.extractText({
        storageKey: "one-point-five-spaced.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const parts = pageText.split("\n\n");
      expect(parts).toHaveLength(2);

      const para1Lines = parts[0]!.split("\n");
      expect(para1Lines).toHaveLength(3);
      expect(para1Lines[0]).toBe("First line of a standard one-point-five spaced lecture note.");
      expect(para1Lines[1]).toBe("Second line following normal one-point-five spacing.");
      expect(para1Lines[2]).toBe("Third line completing the initial one-point-five paragraph.");

      const para2Lines = parts[1]!.split("\n");
      expect(para2Lines).toHaveLength(2);
      expect(para2Lines[0]).toBe("Second paragraph begins here with clearly elevated paragraph margin.");
      expect(para2Lines[1]).toBe("Concluding line of the second one-point-five spaced block.");
    });

    it("suppresses faux-bold duplicate text items without concatenating doubled strings", async () => {
      const result = await service.extractText({
        storageKey: "faux-bold.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const expectedText =
        "Introduction to Advanced Quantum Mechanics\n" +
        "Section 1: Fundamentals of Wave Functions";

      expect(pageText).toBe(expectedText);
      expect(pageText).not.toContain("Introduction to Advanced Quantum MechanicsIntroduction");
      expect(pageText).not.toContain("Section 1: Fundamentals of Wave FunctionsSection 1");
    });

    it("preserves legitimate adjacent repeated words without false deduplication", async () => {
      const result = await service.extractText({
        storageKey: "repeated-words.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const expectedText =
        "It is true that that decision had had positive results.\n" +
        "Never never assume the outcome without empirical verification.";

      expect(pageText).toBe(expectedText);
      expect(pageText).toContain("that that");
      expect(pageText).toContain("had had");
      expect(pageText).toContain("Never never");
    });

    it("distinguishes paragraph break on three-line page with two deltas [26, 50] without median inflation (Case B)", async () => {
      const result = await service.extractText({
        storageKey: "three-line-paragraph.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const expectedText =
        "First line of the introduction section.\n" +
        "Second line continuing the introduction section.\n\n" +
        "New paragraph starting after a distinct vertical gap.";

      expect(pageText).toBe(expectedText);

      const parts = pageText.split("\n\n");
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe(
        "First line of the introduction section.\nSecond line continuing the introduction section."
      );
      expect(parts[1]).toBe("New paragraph starting after a distinct vertical gap.");
    });

    it("reconstructs identical paragraph structure from reversed content-stream arrival order", async () => {
      const result = await service.extractText({
        storageKey: "three-line-reversed.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const expectedText =
        "First line of the introduction section.\n" +
        "Second line continuing the introduction section.\n\n" +
        "New paragraph starting after a distinct vertical gap.";

      expect(pageText).toBe(expectedText);
      const parts = pageText.split("\n\n");
      expect(parts).toHaveLength(2);
    });

    it("emits single line break for two-line page with single delta (Case C conservative fallback)", async () => {
      const result = await service.extractText({
        storageKey: "two-line-double-spaced.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const expectedText =
        "First line of a two-line double-spaced note.\n" +
        "Second line of a two-line double-spaced note.";

      expect(pageText).toBe(expectedText);
      expect(pageText).not.toContain("\n\n");
      expect(pageText.split("\n")).toHaveLength(2);
    });

    it("preserves adaptive median paragraph classification on four-line page with three deltas (Case A)", async () => {
      const result = await service.extractText({
        storageKey: "four-line-adaptive.pdf",
        mimeType: "application/pdf",
      });

      expect(result.pages).toHaveLength(1);
      const pageText = result.pages![0]!.text;

      const expectedText =
        "First line of initial paragraph block.\n" +
        "Second line of initial paragraph block.\n" +
        "Third line of initial paragraph block.\n\n" +
        "Concluding separate paragraph following elevated delta.";

      expect(pageText).toBe(expectedText);
      const parts = pageText.split("\n\n");
      expect(parts).toHaveLength(2);
      expect(parts[0]!.split("\n")).toHaveLength(3);
      expect(parts[1]).toBe("Concluding separate paragraph following elevated delta.");
    });

    it("reconstructPdfPageText fails closed with LayoutAmbiguityError when all items lack geometry", () => {
      // Mock items with missing transform matrices
      const missingGeometryItems = [
        { str: "Fallback", dir: "ltr", transform: [], width: 0, height: 0, fontName: "f1", hasEOL: false },
        { str: "text", dir: "ltr", transform: [], width: 0, height: 0, fontName: "f1", hasEOL: false },
        { str: "content", dir: "ltr", transform: [], width: 0, height: 0, fontName: "f1", hasEOL: false },
      ] as any[];

      expect(() => reconstructPdfPageText(missingGeometryItems)).toThrow(LayoutAmbiguityError);
    });

    it("reconstructPdfPageText fails closed on mixed geometry items when independent provenance is absent", () => {
      // Mixed items without independent provenance must fail closed (stream adjacency != physical enclosure)
      const mixedGeometryItems = [
        { str: "First", dir: "ltr", transform: [12, 0, 0, 12, 50, 350], width: 30, height: 12, fontName: "f1", hasEOL: false },
        { str: "Middle", dir: "ltr", transform: [], width: 0, height: 0, fontName: "f1", hasEOL: false },
        { str: "Last", dir: "ltr", transform: [12, 0, 0, 12, 85, 350], width: 30, height: 12, fontName: "f1", hasEOL: false },
      ] as any[];

      expect(() => reconstructPdfPageText(mixedGeometryItems)).toThrow(LayoutAmbiguityError);
    });

    it("reconstructPdfPageText extracts single unanchored item where provenance is self-contained", () => {
      const singleItem = [
        { str: "Sole line", dir: "ltr", transform: [], width: 0, height: 0, fontName: "f1", hasEOL: false },
      ] as any[];

      expect(reconstructPdfPageText(singleItem)).toBe("Sole line");
    });

    it("reconstructPdfPageText preserves RTL stream order without corrupting text", () => {
      // RTL items on the same line should not be sorted with LTR X-ordering
      const rtlItems = [
        { str: "مرحبا", dir: "rtl", transform: [12, 0, 0, 12, 100, 350], width: 30, height: 12, fontName: "f1", hasEOL: false },
        { str: " ", dir: "rtl", transform: [12, 0, 0, 12, 65, 350], width: 5, height: 12, fontName: "f1", hasEOL: false },
        { str: "بالعالم", dir: "rtl", transform: [12, 0, 0, 12, 30, 350], width: 35, height: 12, fontName: "f1", hasEOL: false },
      ] as any[];

      const text = reconstructPdfPageText(rtlItems);
      expect(text).toBe("مرحبا بالعالم");
    });

    it("reconstructPdfPageText handles reversed delta order [50, 26] with paragraph break first (Case B)", () => {
      // 3 lines: line 1 at y=350, line 2 at y=300 (delta=50), line 3 at y=274 (delta=26)
      const items = [
        { str: "Heading Line", dir: "ltr", transform: [12, 0, 0, 12, 50, 350], width: 80, height: 12, fontName: "f1", hasEOL: false },
        { str: "Body First Line", dir: "ltr", transform: [12, 0, 0, 12, 50, 300], width: 90, height: 12, fontName: "f1", hasEOL: false },
        { str: "Body Second Line", dir: "ltr", transform: [12, 0, 0, 12, 50, 274], width: 95, height: 12, fontName: "f1", hasEOL: false },
      ] as any[];

      const text = reconstructPdfPageText(items);
      expect(text).toBe("Heading Line\n\nBody First Line\nBody Second Line");
      const parts = text.split("\n\n");
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe("Heading Line");
      expect(parts[1]).toBe("Body First Line\nBody Second Line");
    });

    it("reconstructPdfPageText conservatively emits ordinary line break for single isolated delta (Case C)", () => {
      // 2 lines with a large 50pt gap: without multiple observations, cannot distinguish
      // double-spaced consecutive lines from two one-line paragraphs
      const items = [
        { str: "First Line", dir: "ltr", transform: [12, 0, 0, 12, 50, 350], width: 60, height: 12, fontName: "f1", hasEOL: false },
        { str: "Second Line", dir: "ltr", transform: [12, 0, 0, 12, 50, 300], width: 70, height: 12, fontName: "f1", hasEOL: false },
      ] as any[];

      const text = reconstructPdfPageText(items);
      expect(text).toBe("First Line\nSecond Line");
      expect(text).not.toContain("\n\n");
    });

    it("reconstructPdfPageText preserves single line with no deltas without inventing paragraph boundaries (Case D)", () => {
      const items = [
        { str: "Single standalone line", dir: "ltr", transform: [12, 0, 0, 12, 50, 350], width: 120, height: 12, fontName: "f1", hasEOL: false },
      ] as any[];

      const text = reconstructPdfPageText(items);
      expect(text).toBe("Single standalone line");
      expect(text).not.toContain("\n");
    });
  });

  // =========================================================================
  // 2. DOCX EXTRACTION TESTS (Real mammoth)
  // =========================================================================
  describe("DOCX extraction (mammoth)", () => {
    it("extracts multiple paragraphs preserving paragraph boundaries", async () => {
      const result = await service.extractText({
        storageKey: "paragraphs.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      expect(result.text).toContain("Chapter 1: Overview of Distributed Systems Architecture.");
      expect(result.text).toContain("CAP Theorem states that a distributed data store can only provide two of Consistency");
      expect(result.text).toContain("Modern cloud databases make explicit tradeoffs between strong consistency and low latency.");

      // DOCX has no file-format page concept; pages must be undefined
      expect(result.pages).toBeUndefined();
    });

    it("extracts text from tables according to current raw-text flattening contract", async () => {
      const result = await service.extractText({
        storageKey: "table.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      expect(result.text).toContain("Comparison Table of Database Guarantees:");
      expect(result.text).toContain("Model");
      expect(result.text).toContain("Consistency");
      expect(result.text).toContain("Availability");
      expect(result.text).toContain("ACID");
      expect(result.text).toContain("Immediate");
      expect(result.text).toContain("BASE");
      expect(result.text).toContain("Eventual");

      // Verify pages remain undefined
      expect(result.pages).toBeUndefined();
    });

    it("handles corrupt DOCX with a controlled failure and descriptive user error", async () => {
      await expect(
        service.extractText({
          storageKey: "corrupt.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        })
      ).rejects.toThrow(/Couldn't read this Word document — it may be corrupted or in an unsupported format/);
    });
  });

  // =========================================================================
  // 3. PPTX EXTRACTION TESTS (Real jszip & DrawingML parsing)
  // =========================================================================
  describe("PPTX extraction (jszip & XML text-run parsing)", () => {
    it("extracts distinct text from multiple slides with sequential slide numbering", async () => {
      const result = await service.extractText({
        storageKey: "two-slides.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toBeDefined();
      expect(result.pages).toHaveLength(2);

      // Slide 1
      const slide1 = result.pages![0]!;
      expect(slide1.pageNumber).toBe(1);
      expect(slide1.text).toContain("Lecture 1: Quantum Foundations");
      expect(slide1.text).toContain("Overview of wave-particle duality and Schrödinger equation.");

      // Slide 2
      const slide2 = result.pages![1]!;
      expect(slide2.pageNumber).toBe(2);
      expect(slide2.text).toContain("Heisenberg Uncertainty Principle");
      expect(slide2.text).toContain("Cannot simultaneously measure position and momentum with arbitrary precision.");

      // Full text is joined by double newlines
      expect(result.text).toBe(result.pages!.map((p) => p.text).join("\n\n"));
    });

    it("preserves paragraph boundaries separated by newlines across slide paragraphs", async () => {
      const result = await service.extractText({
        storageKey: "multiple-paragraphs.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toBeDefined();
      expect(result.pages).toHaveLength(1);

      const slide = result.pages![0]!;
      expect(slide.pageNumber).toBe(1);

      // Paragraphs are preserved and separated by newlines in source order
      expect(slide.text).toBe(
        "Quantum Core Principles\nFirst Principle: Superposition\nSecond Principle: Entanglement\nThird Principle: Interference"
      );
    });

    it("cooperatively yields via setImmediate at configured interval for long PPTX decks", async () => {
      const yieldSpy = vi.spyOn(extractionLoopHelpers, "yieldToEventLoop");

      const result = await service.extractText({
        storageKey: "eleven-slides.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toHaveLength(11);
      // Yield interval is 10: slide 10 yields once (10 < 11), slide 11 does not yield (11 < 11 is false)
      expect(yieldSpy).toHaveBeenCalledTimes(1);

      // Verify all 11 slides preserved in exact sequential order
      expect(result.pages!.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(result.text).toContain("Slide 1 Content for Yielding Test");
      expect(result.text).toContain("Slide 11 Content for Yielding Test");

      yieldSpy.mockRestore();
    });

    it("does not yield for short PPTX decks (slides <= EXTRACTION_YIELD_INTERVAL)", async () => {
      const yieldSpy = vi.spyOn(extractionLoopHelpers, "yieldToEventLoop");

      const result = await service.extractText({
        storageKey: "two-slides.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toHaveLength(2);
      // 2 slides <= 10 yield interval -> zero yields
      expect(yieldSpy).toHaveBeenCalledTimes(0);

      yieldSpy.mockRestore();
    });

    it("rejects presentations exceeding MAX_PPTX_SLIDES with an honest, descriptive error", async () => {
      await expect(
        service.extractText({
          storageKey: "over-limit-slides.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        new RegExp(
          `This presentation exceeds the maximum supported slide limit for text extraction \\(251 slides; limit is ${MAX_PPTX_SLIDES} slides\\)`
        )
      );
    });

    it("rejects slides with uncompressed XML exceeding MAX_PPTX_SLIDE_XML_BYTES before/during decompression", async () => {
      await expect(
        service.extractText({
          storageKey: "oversized-slide.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /Slide 1 exceeds the maximum supported slide XML size \(\d+ KB; limit is \d+ KB\)/
      );
    });

    it("handles corrupt PPTX with a controlled failure and descriptive user error", async () => {
      await expect(
        service.extractText({
          storageKey: "corrupt.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(/Couldn't read this PowerPoint file — it may be corrupted or not a real \.pptx file/);
    });

    it("extracts text runs with xml:space='preserve', intra-word styled runs, custom attributes, XML entities, and soft breaks", async () => {
      const result = await service.extractText({
        storageKey: "runs-and-attributes.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toHaveLength(1);
      const slide = result.pages![0]!;
      expect(slide.pageNumber).toBe(1);

      // Intra-word split across runs: "electro" + "magnetism" without extra space
      expect(slide.text).toContain("electromagnetism");

      // Explicit whitespace between separate runs
      expect(slide.text).toContain("Quantum Mechanics");

      // xml:space="preserve" with leading and trailing spaces preserved
      expect(slide.text).toContain("  Leading and trailing spaces  Follow-up");

      // Attributes on <a:t> (e.g. dirty="0", err="1") do not cause runs to be skipped
      expect(slide.text).toContain("Attribute-decorated text run");

      // XML entities properly decoded
      expect(slide.text).toContain('Salt & Pepper: <tag> "quoted" \'single\'');

      // Soft line break <a:br/> converted to newline
      expect(slide.text).toContain("Break before\nBreak after");

      // Exact full slide text
      expect(slide.text).toBe(
        "electromagnetism\nQuantum Mechanics\n  Leading and trailing spaces  Follow-up\nAttribute-decorated text run\nSalt & Pepper: <tag> \"quoted\" 'single'\nBreak before\nBreak after"
      );
    });

    it("extracts text from multiple distinct shapes separated by double newlines", async () => {
      const result = await service.extractText({
        storageKey: "multi-shapes.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toHaveLength(1);
      const slide = result.pages![0]!;

      // Three shapes separated by double newlines; paragraphs within shape separated by single newline
      expect(slide.text).toBe(
        "Lecture 5: Thermodynamics\n\nProfessor Davis — Fall 2026\n\nOverview of heat engines\nCarnot cycle efficiency"
      );
    });

    it("extracts text from nested grouped shapes in XML document order", async () => {
      const result = await service.extractText({
        storageKey: "grouped-shapes.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toHaveLength(1);
      const slide = result.pages![0]!;

      // Top shape + 2 group shapes + 2 nested subgroup shapes
      expect(slide.text).toBe(
        "Architecture Overview\n\nFrontend Service\n\nAPI Gateway\n\nAuth Database\n\nCache Cluster"
      );
    });

    it("extracts multi-row and multi-column tables with tabs and newlines", async () => {
      const result = await service.extractText({
        storageKey: "table.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toHaveLength(1);
      const slide = result.pages![0]!;

      // Cell boundaries delimited with tabs, rows with newlines, intra-cell paragraphs preserved
      expect(slide.text).toBe(
        "Metric\tTarget\tStatus\nLatency\t< 50ms\tPassing\nAvailability\t99.99%\tNominal\nNotes\tReview weekly\nEscalate P1\tLogged"
      );
    });

    it("orders slides according to authoritative presentation.xml <p:sldIdLst> rather than numeric filenames", async () => {
      const result = await service.extractText({
        storageKey: "reordered-slides.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toHaveLength(3);

      // presentation.xml lists rId2 (slide2) -> rId3 (slide3) -> rId1 (slide1)
      expect(result.pages![0]!.pageNumber).toBe(1);
      expect(result.pages![0]!.text).toBe("Physical Slide 2: Introduction");

      expect(result.pages![1]!.pageNumber).toBe(2);
      expect(result.pages![1]!.text).toBe("Physical Slide 3: Methodology");

      expect(result.pages![2]!.pageNumber).toBe(3);
      expect(result.pages![2]!.text).toBe("Physical Slide 1: Conclusion");

      // Full concatenated text follows presentation order
      expect(result.text).toBe(
        "Physical Slide 2: Introduction\n\nPhysical Slide 3: Methodology\n\nPhysical Slide 1: Conclusion"
      );
    });

    it("falls back to numeric filename ordering when presentation.xml relationships are missing", async () => {
      const result = await service.extractText({
        storageKey: "fallback-order.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toHaveLength(2);

      expect(result.pages![0]!.pageNumber).toBe(1);
      expect(result.pages![0]!.text).toBe("Fallback Slide 1");

      expect(result.pages![1]!.pageNumber).toBe(2);
      expect(result.pages![1]!.text).toBe("Fallback Slide 2");
    });

    it("fails safely with descriptive error when slide XML is malformed", async () => {
      await expect(
        service.extractText({
          storageKey: "malformed-slide.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(/Couldn't read this PowerPoint file — slide 1 XML is malformed or corrupted/);
    });

    it("aborts cooperatively during multi-slide processing when AbortSignal triggers", async () => {
      const controller = new AbortController();

      // Abort during yield on slide 10 of 11-slide deck
      const origYield = extractionLoopHelpers.yieldToEventLoop;
      vi.spyOn(extractionLoopHelpers, "yieldToEventLoop").mockImplementation(async () => {
        controller.abort(new Error("Extraction was aborted by user."));
        return origYield();
      });

      await expect(
        service.extractText({
          storageKey: "eleven-slides.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          signal: controller.signal,
        })
      ).rejects.toThrow("Extraction was aborted by user.");
    });

    it("extracts text when shape groupings are nested exactly 20 levels deep (boundary limit)", async () => {
      const result = await service.extractText({
        storageKey: "group-depth-20.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toHaveLength(1);
      expect(result.pages![0]!.text).toBe("Innermost depth 20 text");
      expect(result.text).toBe("Innermost depth 20 text");
    });

    it("fails closed with descriptive error when shape groupings exceed 20 levels of nesting (depth 21)", async () => {
      await expect(
        service.extractText({
          storageKey: "group-depth-21.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /This presentation contains shape groupings that exceed the maximum supported nesting depth \(limit is 20 levels\)/
      );
    });

    it("fails closed when presentation.xml declares a slide relationship that is missing in relationships part", async () => {
      await expect(
        service.extractText({
          storageKey: "rel-missing-id.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /slide relationship "rId2" declared in presentation\.xml was not found in relationships/
      );
    });

    it("fails closed when a slide relationship points to a nonexistent slide part in the archive", async () => {
      await expect(
        service.extractText({
          storageKey: "rel-missing-target.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /slide part ".*missing-slide2\.xml" referenced by relationship "rId2" does not exist in the archive/
      );
    });

    it("fails closed when duplicate relationship IDs are defined in presentation relationships", async () => {
      await expect(
        service.extractText({
          storageKey: "rel-duplicate-id.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /duplicate relationship ID "rId1" declared in presentation relationships/
      );
    });

    it("fails closed when duplicate slide references are declared in presentation.xml <p:sldIdLst>", async () => {
      await expect(
        service.extractText({
          storageKey: "rel-duplicate-slide.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /duplicate slide reference "rId1" declared in presentation slide list/
      );
    });

    it("fails closed when a slide relationship declares an unsupported external target", async () => {
      await expect(
        service.extractText({
          storageKey: "rel-external-target.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /slide relationship "rId2" has an unsupported external target/
      );
    });

    it("fails closed when a slide relationship target attempts directory traversal or points outside ppt/slides/", async () => {
      await expect(
        service.extractText({
          storageKey: "rel-partially-valid.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /slide relationship "rId2" points to an invalid path/
      );
    });

    it("fails closed when presentation.xml is missing but presentation.xml.rels is present (orphaned relationships)", async () => {
      await expect(
        service.extractText({
          storageKey: "orphaned-rels.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /presentation relationships exist but presentation\.xml is missing/
      );
    });

    it("fails closed when two different relationship IDs point to the same slide target part", async () => {
      await expect(
        service.extractText({
          storageKey: "rel-duplicate-targets.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /duplicate slide target "ppt\/slides\/slide1\.xml" referenced in presentation slide list/
      );
    });

    it("fails closed when a slide relationship has an invalid or unsupported relationship type", async () => {
      await expect(
        service.extractText({
          storageKey: "rel-invalid-type.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /relationship "rId2" is not a slide relationship \(type: ".*theme"\)/
      );
    });

    it("fails closed when presentation.xml contains malformed XML syntax", async () => {
      await expect(
        service.extractText({
          storageKey: "malformed-presentation-xml.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /presentation\.xml is malformed or corrupted/
      );
    });

    it("fails closed when presentation.xml.rels contains malformed XML syntax", async () => {
      await expect(
        service.extractText({
          storageKey: "malformed-rels-xml.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /presentation relationships XML is malformed or corrupted/
      );
    });
  });

  // =========================================================================
  // 4. MIME TYPE HANDLING AND BOUNDARY VALIDATION
  // =========================================================================
  describe("MIME type and input validation", () => {
    it("handles MIME types with parameters (e.g. charset or boundary)", async () => {
      const result = await service.extractText({
        storageKey: "single-page.pdf",
        mimeType: "application/pdf; charset=UTF-8",
      });

      expect(result.text).toContain("Zenote Lecture Intelligence");
      expect(result.pages).toHaveLength(1);
    });

    it("throws a descriptive error when an unsupported MIME type is provided", async () => {
      await expect(
        service.extractText({
          storageKey: "single-page.pdf",
          mimeType: "image/png",
        })
      ).rejects.toThrow(/DocumentProcessingService cannot extract text from MIME type "image\/png"/);
    });

    it("throws when storage backend is unknown", async () => {
      vi.spyOn(storageModule, "getStorageService").mockReturnValue({} as any);

      await expect(
        service.extractText({
          storageKey: "single-page.pdf",
          mimeType: "application/pdf",
        })
      ).rejects.toThrow(/Unknown storage backend — cannot read file bytes for document extraction/);
    });
  });

  // =========================================================================
  // 5. PHASE 11.3.3C: INGESTION BOUNDARIES & GUARD VERIFICATION
  // =========================================================================
  describe("Phase 11.3.3C: Ingestion size boundaries and fail-closed guards", () => {
    it("rejects oversized documents before full buffering via LocalStorageService.readFileStats", async () => {
      const localStorage = new LocalStorageService(FIXTURES_DIR);
      const statSpy = vi.spyOn(localStorage, "readFileStats").mockResolvedValue({
        size: 55 * 1024 * 1024, // 55 MB (> 50 MB)
      } as any);
      const readFileSpy = vi.spyOn(localStorage, "readFile");
      vi.spyOn(storageModule, "getStorageService").mockReturnValue(localStorage);

      await expect(
        service.extractText({
          storageKey: "single-page.pdf",
          mimeType: "application/pdf",
        })
      ).rejects.toThrow(
        /This document exceeds the maximum supported file size for text extraction \(55 MB; limit is 50 MB\)\. The original file remains available for viewing and download\./
      );

      expect(statSpy).toHaveBeenCalledWith("single-page.pdf");
      expect(readFileSpy).not.toHaveBeenCalled();
    });

    it("rejects oversized documents before full buffering via S3StorageService.headObject", async () => {
      const s3Storage = Object.create(S3StorageService.prototype) as S3StorageService;
      s3Storage.headObject = vi.fn().mockResolvedValue({
        sizeBytes: 60 * 1024 * 1024, // 60 MB (> 50 MB)
      });
      s3Storage.getObjectBuffer = vi.fn().mockResolvedValue(Buffer.from("never reached"));
      vi.spyOn(storageModule, "getStorageService").mockReturnValue(s3Storage);

      await expect(
        service.extractText({
          storageKey: "materials/user/doc.pdf",
          mimeType: "application/pdf",
        })
      ).rejects.toThrow(
        /This document exceeds the maximum supported file size for text extraction \(60 MB; limit is 50 MB\)\. The original file remains available for viewing and download\./
      );

      expect(s3Storage.headObject).toHaveBeenCalledWith("materials/user/doc.pdf");
      expect(s3Storage.getObjectBuffer).not.toHaveBeenCalled();
    });

    it("rejects PPTX archives exceeding the maximum archive entry limit (MAX_PPTX_TOTAL_ENTRIES = 1,000)", async () => {
      const JSZipModule = await import("jszip");
      const JSZip = JSZipModule.default as any;
      const bombZip = new JSZip();
      for (let i = 0; i < 1001; i++) {
        bombZip.file(`entry_${i}.xml`, "dummy content");
      }
      const bombBuffer = await bombZip.generateAsync({ type: "nodebuffer" });

      const localStorage = new LocalStorageService(FIXTURES_DIR);
      vi.spyOn(localStorage, "readFileStats").mockResolvedValue({ size: bombBuffer.byteLength } as any);
      vi.spyOn(localStorage, "readFile").mockResolvedValue(bombBuffer);
      vi.spyOn(storageModule, "getStorageService").mockReturnValue(localStorage);

      await expect(
        service.extractText({
          storageKey: "zipbomb.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /This presentation exceeds the maximum supported archive entry count \(1001 entries; limit is 1000 entries\)\./
      );
    });

    it("fails closed when PPTX slide XML size cannot be verified safely before decompression", async () => {
      const JSZipModule = await import("jszip");
      const JSZip = JSZipModule.default as any;
      const originalLoadAsync = JSZip.loadAsync.bind(JSZip);

      vi.spyOn(JSZip, "loadAsync").mockImplementation(async (data: any) => {
        const zip = await originalLoadAsync(data);
        const slideEntry = zip.files["ppt/slides/slide1.xml"];
        if (slideEntry) {
          // Corrupt or strip size metadata to simulate untrusted/missing header
          delete slideEntry._data;
        }
        return zip;
      });

      await expect(
        service.extractText({
          storageKey: "two-slides.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /Slide 1 XML size could not be verified safely before decompression\./
      );
    });

    it("fails closed when PPTX slide XML declares a negative uncompressed size", async () => {
      const JSZipModule = await import("jszip");
      const JSZip = JSZipModule.default as any;
      const originalLoadAsync = JSZip.loadAsync.bind(JSZip);

      vi.spyOn(JSZip, "loadAsync").mockImplementation(async (data: any) => {
        const zip = await originalLoadAsync(data);
        const slideEntry = zip.files["ppt/slides/slide1.xml"];
        if (slideEntry) {
          slideEntry._data = { uncompressedSize: -100 };
        }
        return zip;
      });

      await expect(
        service.extractText({
          storageKey: "two-slides.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /Slide 1 XML size could not be verified safely before decompression\./
      );
    });

    it("accepts empty slide XML entries (_data = '') without failing closed", async () => {
      const JSZipModule = await import("jszip");
      const JSZip = JSZipModule.default as any;
      const originalLoadAsync = JSZip.loadAsync.bind(JSZip);

      vi.spyOn(JSZip, "loadAsync").mockImplementation(async (data: any) => {
        const zip = await originalLoadAsync(data);
        const slideEntry = zip.files["ppt/slides/slide1.xml"];
        if (slideEntry) {
          slideEntry._data = ""; // Empty file representation in JSZip
          slideEntry.async = vi.fn().mockResolvedValue("<p:sp></p:sp>");
        }
        return zip;
      });

      const result = await service.extractText({
        storageKey: "two-slides.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });

      expect(result.pages).toBeDefined();
    });

    it("rejects decompressed slide XML if actual byte length exceeds 2 MB (falsified header)", async () => {
      const JSZipModule = await import("jszip");
      const JSZip = JSZipModule.default as any;
      const originalLoadAsync = JSZip.loadAsync.bind(JSZip);

      vi.spyOn(JSZip, "loadAsync").mockImplementation(async (data: any) => {
        const zip = await originalLoadAsync(data);
        const slideEntry = zip.files["ppt/slides/slide1.xml"];
        if (slideEntry) {
          // Declared size is deceptively small (100 bytes)
          slideEntry._data = { uncompressedSize: 100 };
          // But decompressed string is huge (> 2 MB)
          slideEntry.async = vi.fn().mockResolvedValue("<a:t>" + "x".repeat(MAX_PPTX_SLIDE_XML_BYTES + 50) + "</a:t>");
        }
        return zip;
      });

      await expect(
        service.extractText({
          storageKey: "two-slides.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(/exceeds the maximum supported slide XML size/);
    });

    it("rejects extracted text exceeding the character storage ceiling (MAX_EXTRACTED_TEXT_CHARS = 500,000)", async () => {
      const JSZipModule = await import("jszip");
      const JSZip = JSZipModule.default as any;
      const originalLoadAsync = JSZip.loadAsync.bind(JSZip);

      vi.spyOn(JSZip, "loadAsync").mockImplementation(async (data: any) => {
        const zip = await originalLoadAsync(data);
        const slideEntry = zip.files["ppt/slides/slide1.xml"];
        if (slideEntry) {
          const hugeText = "W".repeat(MAX_EXTRACTED_TEXT_CHARS + 50);
          slideEntry._data = { uncompressedSize: hugeText.length + 50 };
          slideEntry.async = vi.fn().mockResolvedValue(`<a:t>${hugeText}</a:t>`);
        }
        return zip;
      });

      await expect(
        service.extractText({
          storageKey: "two-slides.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        })
      ).rejects.toThrow(
        /This document exceeds the maximum supported text length for extraction \(\d[\d,]* characters; limit is 500,000 characters\)\. The original file remains available for viewing and download\./
      );
    });

    it("exports all Phase 11.3.3C boundary constants with verified numerical values", () => {
      expect(MAX_DOCUMENT_EXTRACTION_BYTES).toBe(50 * 1024 * 1024);
      expect(MAX_EXTRACTED_TEXT_CHARS).toBe(500_000);
      expect(MAX_PPTX_TOTAL_ENTRIES).toBe(1_000);
    });
  });

  // =========================================================================
  // Phase 11.3.3D.2: Cooperative Cancellation and Signal Propagation
  // =========================================================================
  describe("Phase 11.3.3D.2: Cooperative Cancellation and Signal Propagation", () => {
    it("PDF extraction halts cooperatively when signal is pre-aborted", async () => {
      const controller = new AbortController();
      controller.abort(new Error("Pre-aborted PDF"));

      await expect(
        service.extractText({
          storageKey: "single-page.pdf",
          mimeType: "application/pdf",
          signal: controller.signal,
        })
      ).rejects.toThrow("Pre-aborted PDF");
    });

    it("PDF extraction halts cooperatively between pages on multi-page documents", async () => {
      const controller = new AbortController();
      const pageProto = await getPdfPagePrototype();
      const originalGetTextContent = pageProto.getTextContent;

      let callCount = 0;
      vi.spyOn(pageProto, "getTextContent").mockImplementation(async function (this: any) {
        callCount++;
        if (callCount === 1) {
          controller.abort(new Error("Mid-extraction PDF cancellation"));
        }
        return originalGetTextContent.apply(this);
      });

      await expect(
        service.extractText({
          storageKey: "multi-page.pdf",
          mimeType: "application/pdf",
          signal: controller.signal,
        })
      ).rejects.toThrow("Mid-extraction PDF cancellation");
    });

    it("DOCX extraction halts immediately if signal is pre-aborted", async () => {
      const controller = new AbortController();
      controller.abort(new Error("Pre-aborted DOCX"));

      await expect(
        service.extractText({
          storageKey: "paragraphs.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          signal: controller.signal,
        })
      ).rejects.toThrow("Pre-aborted DOCX");
    });

    it("DOCX extraction halts and discards output if cancelled while Mammoth is executing", async () => {
      const originalExtract = extractionLoopHelpers.extractDocxRawText.bind(extractionLoopHelpers);
      const controller = new AbortController();

      vi.spyOn(extractionLoopHelpers, "extractDocxRawText").mockImplementation(async (mammoth: any, buffer: Buffer) => {
        controller.abort(new Error("Cancelled during Mammoth execution"));
        return originalExtract(mammoth, buffer);
      });

      await expect(
        service.extractText({
          storageKey: "paragraphs.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          signal: controller.signal,
        })
      ).rejects.toThrow("Cancelled during Mammoth execution");
    });

    it("PPTX extraction halts immediately if signal is pre-aborted", async () => {
      const controller = new AbortController();
      controller.abort(new Error("Pre-aborted PPTX"));

      await expect(
        service.extractText({
          storageKey: "two-slides.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          signal: controller.signal,
        })
      ).rejects.toThrow("Pre-aborted PPTX");
    });

    it("LocalStorageService respects AbortSignal and aborts reading file", async () => {
      const localStorage = new LocalStorageService(FIXTURES_DIR);
      const controller = new AbortController();
      controller.abort(new Error("Storage aborted"));

      await expect(
        localStorage.readFile("single-page.pdf", undefined, controller.signal)
      ).rejects.toThrow("Storage aborted");
    });
  });
});
