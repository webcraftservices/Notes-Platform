import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  processingJob: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  material: {
    findUnique: vi.fn(),
  },
  topic: {
    findUnique: vi.fn(),
  },
  transcript: {
    findUnique: vi.fn(),
  },
  note: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  noteBlock: {
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  noteVersion: {
    create: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));

const jobs = vi.hoisted(() => ({
  claimJob: vi.fn(),
  completeJobWithin: vi.fn(),
  failJob: vi.fn(),
  isJobActive: vi.fn(),
  registerJobContext: vi.fn(),
  notifyJobStatusChange: vi.fn(),
}));
vi.mock("@/lib/processing-jobs", () => jobs);

const aiService = vi.hoisted(() => ({
  providerName: "gemini",
  modelName: "gemini-2.5-flash-lite",
  generateNotes: vi.fn(),
}));
vi.mock("@/lib/services/ai", () => ({
  getAIService: () => aiService,
}));

const aiUsage = vi.hoisted(() => ({
  recordAIUsage: vi.fn(),
}));
vi.mock("@/lib/ai-usage", () => aiUsage);

vi.mock("@/lib/observability/datadog", () => ({
  sendDatadogMetric: vi.fn(),
  sendDatadogLog: vi.fn(),
}));

import {
  runNoteGenerationJob,
  MAX_DOCUMENT_NOTE_GEN_CHARS,
  parseExtractedPages,
  formatDelimitedSourceText,
} from "@/lib/note-generation";
import { AIGenerationFailedError, AIProviderUnavailableError } from "@/lib/services/interfaces";

describe("runNoteGenerationJob", () => {
  const fakeJob = {
    id: "job-1",
    type: "AI_NOTE_GENERATION",
    materialId: "mat-1",
    userId: "user-1",
    status: "QUEUED",
  };

  const fakeTopic = {
    id: "topic-1",
    name: "Thermodynamics",
  };

  const fakeNote = {
    id: "note-1",
    topicId: "topic-1",
    title: "Thermodynamics",
    source: "MANUAL",
  };

  const fakeGeneratedBlocks = [
    { kind: "OVERVIEW", heading: "Introduction", content: "Overview text content." },
    { kind: "DEFINITION", heading: "First Law", content: "Energy cannot be created or destroyed." },
  ];

  beforeEach(() => {
    vi.resetAllMocks();

    jobs.claimJob.mockResolvedValue(true);
    jobs.isJobActive.mockResolvedValue(true);
    jobs.completeJobWithin.mockResolvedValue(true);
    jobs.failJob.mockResolvedValue(undefined);

    db.processingJob.findUnique.mockResolvedValue(fakeJob);
    db.processingJob.update.mockResolvedValue({ id: "job-1" });
    db.topic.findUnique.mockResolvedValue(fakeTopic);
    db.note.findFirst.mockResolvedValue(fakeNote);
    db.noteBlock.findMany.mockResolvedValue([]);
    db.noteBlock.createMany.mockResolvedValue({ count: 2 });
    db.note.update.mockResolvedValue(fakeNote);

    db.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
      return callback(db);
    });

    aiService.generateNotes.mockResolvedValue({
      blocks: fakeGeneratedBlocks,
      tokensInput: 350,
      tokensOutput: 120,
    });
    aiUsage.recordAIUsage.mockResolvedValue(undefined);
  });

  describe("Audio and Video materials (transcript pipeline)", () => {
    beforeEach(() => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-1",
        type: "AUDIO",
        title: "Lecture 1 Audio",
        topicId: "topic-1",
        workspaceId: "ws-1",
        groupId: null,
      });
      db.transcript.findUnique.mockResolvedValue({
        status: "READY",
        fullText: "Audio transcript: Welcome to thermodynamics lecture 1.",
      });
    });

    it("generates notes using transcript text and lecture template", async () => {
      await runNoteGenerationJob("job-1");

      expect(aiService.generateNotes).toHaveBeenCalledWith({
        sourceText: "Audio transcript: Welcome to thermodynamics lecture 1.",
        sourceType: "transcript",
        templateKind: "lecture",
      });

      expect(aiUsage.recordAIUsage).toHaveBeenCalledWith({
        userId: "user-1",
        workspaceId: "ws-1",
        groupId: null,
        category: "note_generation",
        provider: "gemini",
        model: "gemini-2.5-flash-lite",
        tokensInput: 350,
        tokensOutput: 120,
        context: {
          materialId: "mat-1",
          topicId: "topic-1",
          sourceType: "transcript",
          materialType: "AUDIO",
        },
      });

      expect(db.noteBlock.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            noteId: "note-1",
            kind: "OVERVIEW",
            heading: "Introduction",
            order: 0,
            metadata: undefined,
          }),
          expect.objectContaining({
            noteId: "note-1",
            kind: "DEFINITION",
            heading: "First Law",
            order: 1,
            metadata: undefined,
          }),
        ],
      });

      expect(db.note.update).toHaveBeenCalledWith({
        where: { id: "note-1" },
        data: { source: "AI_GENERATED", templateKind: "lecture" },
      });

      expect(db.note.update).toHaveBeenCalledWith({
        where: { id: "note-1" },
        data: {
          plainText:
            "Thermodynamics\n\nIntroduction\nOverview text content.\n\nFirst Law\nEnergy cannot be created or destroyed.",
        },
      });
    });

    it("fails when transcript is not ready or missing", async () => {
      db.transcript.findUnique.mockResolvedValue(null);

      await runNoteGenerationJob("job-1");

      expect(jobs.failJob).toHaveBeenCalledWith(
        "job-1",
        "AI_NOTE_GENERATION",
        expect.any(Error),
        expect.any(String)
      );
      expect(aiService.generateNotes).not.toHaveBeenCalled();
    });
  });

  describe("Document materials (PDF, DOCX, PPTX, GOOGLE_DOC)", () => {
    it.each(["PDF", "DOCX", "PPTX", "GOOGLE_DOC"] as const)(
      "generates notes from extracted text for %s with source attribution metadata",
      async (docType) => {
        db.material.findUnique.mockResolvedValue({
          id: "mat-doc-1",
          type: docType,
          title: `Sample Document ${docType}`,
          topicId: "topic-1",
          workspaceId: "ws-1",
          groupId: "group-1",
          extractedText: "Extracted textbook chapter text about heat engines and Carnot cycles.",
        });

        await runNoteGenerationJob("job-1");

        expect(aiService.generateNotes).toHaveBeenCalledWith({
          sourceText: "Extracted textbook chapter text about heat engines and Carnot cycles.",
          sourceType: "document",
          templateKind: "study_guide",
        });

        expect(aiUsage.recordAIUsage).toHaveBeenCalledWith({
          userId: "user-1",
          workspaceId: "ws-1",
          groupId: "group-1",
          category: "note_generation",
          provider: "gemini",
          model: "gemini-2.5-flash-lite",
          tokensInput: 350,
          tokensOutput: 120,
          context: {
            materialId: "mat-doc-1",
            topicId: "topic-1",
            sourceType: "document",
            materialType: docType,
          },
        });

        // Verifies document blocks contain source attribution metadata
        expect(db.noteBlock.createMany).toHaveBeenCalledWith({
          data: [
            expect.objectContaining({
              noteId: "note-1",
              kind: "OVERVIEW",
              heading: "Introduction",
              order: 0,
              metadata: {
                materialId: "mat-doc-1",
                materialTitle: `Sample Document ${docType}`,
                materialType: docType,
              },
            }),
            expect.objectContaining({
              noteId: "note-1",
              kind: "DEFINITION",
              heading: "First Law",
              order: 1,
              metadata: {
                materialId: "mat-doc-1",
                materialTitle: `Sample Document ${docType}`,
                materialType: docType,
              },
            }),
          ],
        });

        expect(db.note.update).toHaveBeenCalledWith({
          where: { id: "note-1" },
          data: { source: "AI_GENERATED", templateKind: "study_guide" },
        });
      }
    );

    it("generates notes with page attribution for PDF when extractedPages is available", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-pdf-1",
        type: "PDF",
        title: "Thermodynamics Textbook.pdf",
        topicId: "topic-1",
        workspaceId: "ws-1",
        groupId: "group-1",
        extractedText: "Page 1 content about entropy.\n\nPage 2 content about heat pumps.",
        extractedPages: [
          { pageNumber: 1, text: "Page 1 content about entropy." },
          { pageNumber: 2, text: "Page 2 content about heat pumps." },
        ],
      });

      aiService.generateNotes.mockResolvedValue({
        blocks: [
          { kind: "OVERVIEW", heading: "Entropy Intro", content: "Entropy is a measure of disorder.", sourcePages: [1] },
          { kind: "APPLICATION", heading: "Heat Engines", content: "Heat pumps transfer thermal energy.", sourcePages: [1, 2] },
          { kind: "SUMMARY", heading: "Conclusions", content: "Summary of thermodynamics laws.", sourcePages: undefined },
        ],
        tokensInput: 400,
        tokensOutput: 150,
      });

      await runNoteGenerationJob("job-1");

      expect(aiService.generateNotes).toHaveBeenCalledWith({
        sourceText: "--- Page 1 ---\nPage 1 content about entropy.\n\n--- Page 2 ---\nPage 2 content about heat pumps.",
        sourceType: "document",
        templateKind: "study_guide",
        sourceUnits: {
          unitType: "page",
          availableUnits: [1, 2],
        },
      });

      expect(db.noteBlock.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            noteId: "note-1",
            kind: "OVERVIEW",
            heading: "Entropy Intro",
            order: 0,
            metadata: {
              materialId: "mat-pdf-1",
              materialTitle: "Thermodynamics Textbook.pdf",
              materialType: "PDF",
              sourceUnitType: "page",
              sourcePages: [1],
              pageNumber: 1,
            },
          }),
          expect.objectContaining({
            noteId: "note-1",
            kind: "APPLICATION",
            heading: "Heat Engines",
            order: 1,
            metadata: {
              materialId: "mat-pdf-1",
              materialTitle: "Thermodynamics Textbook.pdf",
              materialType: "PDF",
              sourceUnitType: "page",
              sourcePages: [1, 2],
            },
          }),
          expect.objectContaining({
            noteId: "note-1",
            kind: "SUMMARY",
            heading: "Conclusions",
            order: 2,
            metadata: {
              materialId: "mat-pdf-1",
              materialTitle: "Thermodynamics Textbook.pdf",
              materialType: "PDF",
            },
          }),
        ],
      });
    });

    it("generates notes with slide attribution for PPTX when extractedPages is available", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-pptx-1",
        type: "PPTX",
        title: "Lecture Slides.pptx",
        topicId: "topic-1",
        workspaceId: "ws-1",
        groupId: "group-1",
        extractedText: "Slide 1 Title\n\nSlide 2 Graph",
        extractedPages: [
          { pageNumber: 1, text: "Slide 1 Title" },
          { pageNumber: 2, text: "Slide 2 Graph" },
        ],
      });

      aiService.generateNotes.mockResolvedValue({
        blocks: [
          { kind: "OVERVIEW", heading: "Slide Overview", content: "Presentation overview.", sourcePages: [1] },
          { kind: "EXAMPLE", heading: "Cycle Diagram", content: "Example diagram from slide 2.", sourcePages: [2] },
        ],
        tokensInput: 300,
        tokensOutput: 100,
      });

      await runNoteGenerationJob("job-1");

      expect(aiService.generateNotes).toHaveBeenCalledWith({
        sourceText: "--- Slide 1 ---\nSlide 1 Title\n\n--- Slide 2 ---\nSlide 2 Graph",
        sourceType: "document",
        templateKind: "study_guide",
        sourceUnits: {
          unitType: "slide",
          availableUnits: [1, 2],
        },
      });

      expect(db.noteBlock.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            noteId: "note-1",
            kind: "OVERVIEW",
            order: 0,
            metadata: {
              materialId: "mat-pptx-1",
              materialTitle: "Lecture Slides.pptx",
              materialType: "PPTX",
              sourceUnitType: "slide",
              sourcePages: [1],
              pageNumber: 1,
            },
          }),
          expect.objectContaining({
            noteId: "note-1",
            kind: "EXAMPLE",
            order: 1,
            metadata: {
              materialId: "mat-pptx-1",
              materialTitle: "Lecture Slides.pptx",
              materialType: "PPTX",
              sourceUnitType: "slide",
              sourcePages: [2],
              pageNumber: 2,
            },
          }),
        ],
      });
    });

    it("omits empty or whitespace pages from sourceUnits and delimiters", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-pdf-2",
        type: "PDF",
        title: "Sparse.pdf",
        topicId: "topic-1",
        workspaceId: "ws-1",
        groupId: "group-1",
        extractedText: "Content on page 1\n\nContent on page 3",
        extractedPages: [
          { pageNumber: 1, text: "Content on page 1" },
          { pageNumber: 2, text: "   \t  \n  " }, // empty
          { pageNumber: 3, text: "Content on page 3" },
        ],
      });

      aiService.generateNotes.mockResolvedValue({
        blocks: [
          { kind: "OVERVIEW", heading: "Sparse Doc", content: "Content", sourcePages: [1, 3] },
        ],
        tokensInput: 200,
        tokensOutput: 50,
      });

      await runNoteGenerationJob("job-1");

      expect(aiService.generateNotes).toHaveBeenCalledWith({
        sourceText: "--- Page 1 ---\nContent on page 1\n\n--- Page 3 ---\nContent on page 3",
        sourceType: "document",
        templateKind: "study_guide",
        sourceUnits: {
          unitType: "page",
          availableUnits: [1, 3],
        },
      });
    });

    it("fails when document extracted text is missing or whitespace only", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-doc-1",
        type: "PDF",
        title: "Empty.pdf",
        topicId: "topic-1",
        extractedText: "   \n\t  ",
      });

      await runNoteGenerationJob("job-1");

      expect(jobs.failJob).toHaveBeenCalledWith(
        "job-1",
        "AI_NOTE_GENERATION",
        expect.objectContaining({
          message: expect.stringContaining("no extracted text"),
        }),
        expect.any(String)
      );
      expect(aiService.generateNotes).not.toHaveBeenCalled();
    });

    it("fails when document extracted text exceeds 200,000 characters", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-doc-1",
        type: "PDF",
        title: "Huge.pdf",
        topicId: "topic-1",
        extractedText: "x".repeat(MAX_DOCUMENT_NOTE_GEN_CHARS + 1),
      });

      await runNoteGenerationJob("job-1");

      expect(jobs.failJob).toHaveBeenCalledWith(
        "job-1",
        "AI_NOTE_GENERATION",
        expect.objectContaining({
          message: expect.stringContaining("exceeds the maximum supported size"),
        }),
        expect.any(String)
      );
      expect(aiService.generateNotes).not.toHaveBeenCalled();
    });
  });

  describe("Version snapshotting and append behavior", () => {
    it("creates a NoteVersion snapshot and appends new blocks after existing blocks", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-doc-1",
        type: "PDF",
        title: "Lecture Notes.pdf",
        topicId: "topic-1",
        extractedText: "Valid extracted text.",
      });

      const existingBlocks = [
        { id: "b1", noteId: "note-1", kind: "CUSTOM", heading: "Old Heading", order: 0 },
        { id: "b2", noteId: "note-1", kind: "SUMMARY", heading: null, order: 3 },
      ];
      db.noteBlock.findMany.mockResolvedValue(existingBlocks);

      await runNoteGenerationJob("job-1");

      expect(db.noteVersion.create).toHaveBeenCalledWith({
        data: {
          noteId: "note-1",
          editedById: "user-1",
          snapshot: existingBlocks as unknown as Prisma.InputJsonValue,
        },
      });

      // Appends after order 3: orders should be 4 and 5
      expect(db.noteBlock.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ order: 4 }),
          expect.objectContaining({ order: 5 }),
        ],
      });

      // Updates note source to AI_ASSISTED when existing blocks were present
      expect(db.note.update).toHaveBeenCalledWith({
        where: { id: "note-1" },
        data: { source: "AI_ASSISTED" },
      });
    });
  });

  describe("Cancellation, isolation and edge cases", () => {
    it("returns early if job cannot be claimed", async () => {
      jobs.claimJob.mockResolvedValue(false);

      await runNoteGenerationJob("job-1");

      expect(db.material.findUnique).not.toHaveBeenCalled();
    });

    it("returns early if job is not active after generation (e.g. cancelled by group deletion)", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-doc-1",
        type: "PDF",
        topicId: "topic-1",
        extractedText: "Some text",
      });
      jobs.isJobActive.mockResolvedValue(false);

      await runNoteGenerationJob("job-1");

      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("aborts transaction if completeJobWithin returns false (material deleted concurrently)", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-doc-1",
        type: "PDF",
        topicId: "topic-1",
        extractedText: "Some text",
      });
      jobs.completeJobWithin.mockResolvedValue(false);

      await runNoteGenerationJob("job-1");

      expect(db.noteBlock.createMany).not.toHaveBeenCalled();
    });

    it("marks job SUCCEEDED without creating blocks when AI model returns 0 blocks", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-doc-1",
        type: "PDF",
        topicId: "topic-1",
        extractedText: "Some text",
      });
      aiService.generateNotes.mockResolvedValue({ blocks: [] });

      await runNoteGenerationJob("job-1");

      expect(jobs.completeJobWithin).toHaveBeenCalledWith(expect.anything(), "job-1", "mat-doc-1");
      expect(db.noteBlock.createMany).not.toHaveBeenCalled();
      expect(db.note.update).not.toHaveBeenCalled();
    });

    it("fails when material has unsupported type (e.g. IMAGE)", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-img",
        type: "IMAGE",
        topicId: "topic-1",
      });

      await runNoteGenerationJob("job-1");

      expect(jobs.failJob).toHaveBeenCalledWith(
        "job-1",
        "AI_NOTE_GENERATION",
        expect.objectContaining({
          message: expect.stringContaining("not supported for IMAGE materials"),
        }),
        expect.any(String)
      );
    });

    it("fails when material is not attached to a topic", async () => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-1",
        type: "PDF",
        topicId: null,
      });

      await runNoteGenerationJob("job-1");

      expect(jobs.failJob).toHaveBeenCalledWith(
        "job-1",
        "AI_NOTE_GENERATION",
        expect.objectContaining({
          message: expect.stringContaining("isn't attached to a topic"),
        }),
        expect.any(String)
      );
    });
  });

  describe("Usage accounting resilience and failure semantics", () => {
    beforeEach(() => {
      db.material.findUnique.mockResolvedValue({
        id: "mat-doc-1",
        type: "PDF",
        title: "Sample Doc.pdf",
        topicId: "topic-1",
        workspaceId: "ws-1",
        groupId: null,
        extractedText: "Some valid extracted text.",
      });
    });

    it("persists generated note blocks even if recordAIUsage rejects", async () => {
      aiUsage.recordAIUsage.mockRejectedValue(new Error("Usage database ledger unavailable"));

      await runNoteGenerationJob("job-1");

      // Verify AI generation ran
      expect(aiService.generateNotes).toHaveBeenCalled();

      // Verify recordAIUsage was attempted
      expect(aiUsage.recordAIUsage).toHaveBeenCalled();

      // Verify transaction proceeded and persisted note blocks
      expect(db.noteBlock.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            noteId: "note-1",
            kind: "OVERVIEW",
            heading: "Introduction",
          }),
        ]),
      });

      // Verify job completion succeeded without failJob being invoked
      expect(jobs.failJob).not.toHaveBeenCalled();
    });

    it("preserves recorded token usage when note persistence transaction fails afterward", async () => {
      db.$transaction.mockRejectedValue(new Error("Database deadlock during note block insert"));

      await runNoteGenerationJob("job-1");

      // Gemini was called and consumed tokens
      expect(aiService.generateNotes).toHaveBeenCalled();

      // recordAIUsage was already invoked with the consumed token counts
      expect(aiUsage.recordAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "note_generation",
          tokensInput: 350,
          tokensOutput: 120,
        })
      );

      // failJob was called to record the persistence failure
      expect(jobs.failJob).toHaveBeenCalledWith(
        "job-1",
        "AI_NOTE_GENERATION",
        expect.objectContaining({
          message: expect.stringContaining("Database deadlock"),
        }),
        expect.any(String)
      );
    });

    it("passes undefined token counts when provider reports no usage metadata", async () => {
      aiService.generateNotes.mockResolvedValue({
        blocks: fakeGeneratedBlocks,
        tokensInput: undefined,
        tokensOutput: undefined,
      });

      await runNoteGenerationJob("job-1");

      expect(aiUsage.recordAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "note_generation",
          tokensInput: undefined,
          tokensOutput: undefined,
        })
      );
    });

    it("records usage metadata on failed generation when AIGenerationFailedError reports tokens", async () => {
      const truncationError = new AIGenerationFailedError(
        "AI note generation was truncated because the response exceeded the maximum output token limit.",
        { tokensInput: 500, tokensOutput: 8192, finishReason: "MAX_TOKENS", isTruncated: true }
      );
      aiService.generateNotes.mockRejectedValue(truncationError);

      await runNoteGenerationJob("job-1");

      // Verify token usage is recorded with failed status and finish reason
      expect(aiUsage.recordAIUsage).toHaveBeenCalledTimes(1);
      expect(aiUsage.recordAIUsage).toHaveBeenCalledWith({
        userId: "user-1",
        workspaceId: "ws-1",
        groupId: null,
        category: "note_generation",
        provider: "gemini",
        model: "gemini-2.5-flash-lite",
        tokensInput: 500,
        tokensOutput: 8192,
        context: {
          materialId: "mat-doc-1",
          topicId: "topic-1",
          sourceType: "document",
          materialType: "PDF",
          status: "failed",
          finishReason: "MAX_TOKENS",
        },
      });

      // Verify failJob was called with the truncation error
      expect(jobs.failJob).toHaveBeenCalledWith(
        "job-1",
        "AI_NOTE_GENERATION",
        truncationError,
        expect.any(String)
      );

      // Verify no note blocks and no note version were created
      expect(db.noteBlock.createMany).not.toHaveBeenCalled();
      expect(db.noteVersion.create).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("does not record usage metadata when AIGenerationFailedError has no token counts", async () => {
      const blockedError = new AIGenerationFailedError(
        "AI note generation was blocked by safety filters.",
        { finishReason: "SAFETY" }
      );
      aiService.generateNotes.mockRejectedValue(blockedError);

      await runNoteGenerationJob("job-1");

      expect(aiUsage.recordAIUsage).not.toHaveBeenCalled();
      expect(jobs.failJob).toHaveBeenCalledWith(
        "job-1",
        "AI_NOTE_GENERATION",
        blockedError,
        expect.any(String)
      );
      expect(db.noteBlock.createMany).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("does not record usage metadata when generation fails with network or provider unavailable error", async () => {
      const networkError = new AIProviderUnavailableError("Gemini request failed: fetch failed");
      aiService.generateNotes.mockRejectedValue(networkError);

      await runNoteGenerationJob("job-1");

      expect(aiUsage.recordAIUsage).not.toHaveBeenCalled();
      expect(jobs.failJob).toHaveBeenCalledWith(
        "job-1",
        "AI_NOTE_GENERATION",
        networkError,
        expect.any(String)
      );
      expect(db.noteBlock.createMany).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("ensures no duplicate usage accounting on successful generation", async () => {
      await runNoteGenerationJob("job-1");

      expect(aiUsage.recordAIUsage).toHaveBeenCalledTimes(1);
      expect(aiUsage.recordAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          tokensInput: 350,
          tokensOutput: 120,
          context: expect.not.objectContaining({ status: "failed" }),
        })
      );
    });

    it("ensures no duplicate usage accounting on failed generation with usage tokens", async () => {
      const malformedJsonError = new AIGenerationFailedError(
        "Gemini's note-generation response wasn't valid JSON despite the requested JSON schema.",
        { tokensInput: 400, tokensOutput: 150, finishReason: "STOP" }
      );
      aiService.generateNotes.mockRejectedValue(malformedJsonError);

      await runNoteGenerationJob("job-1");

      expect(aiUsage.recordAIUsage).toHaveBeenCalledTimes(1);
      expect(aiUsage.recordAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          tokensInput: 400,
          tokensOutput: 150,
          context: expect.objectContaining({ status: "failed", finishReason: "STOP" }),
        })
      );
    });

    it("continues to fail the job cleanly even if recording usage for failed generation throws", async () => {
      aiUsage.recordAIUsage.mockRejectedValue(new Error("Usage DB write error"));
      const truncationError = new AIGenerationFailedError(
        "AI note generation was truncated because the response exceeded the maximum output token limit.",
        { tokensInput: 500, tokensOutput: 8192, finishReason: "MAX_TOKENS", isTruncated: true }
      );
      aiService.generateNotes.mockRejectedValue(truncationError);

      await runNoteGenerationJob("job-1");

      // Verify usage recording was attempted
      expect(aiUsage.recordAIUsage).toHaveBeenCalled();

      // Verify the job was still failed cleanly with the original generation error
      expect(jobs.failJob).toHaveBeenCalledWith(
        "job-1",
        "AI_NOTE_GENERATION",
        truncationError,
        expect.any(String)
      );

      // Verify no note blocks created
      expect(db.noteBlock.createMany).not.toHaveBeenCalled();
    });
  });

  describe("parseExtractedPages and formatDelimitedSourceText", () => {
    it("parses valid extracted page arrays safely", () => {
      const raw = [
        { pageNumber: 1, text: "Intro" },
        { pageNumber: 2, text: "Details" },
      ];
      expect(parseExtractedPages(raw)).toEqual([
        { pageNumber: 1, text: "Intro" },
        { pageNumber: 2, text: "Details" },
      ]);
    });

    it("filters out invalid, non-integer, negative, or malformed page items", () => {
      const raw = [
        { pageNumber: 1, text: "Valid" },
        { pageNumber: -1, text: "Negative" },
        { pageNumber: 2.5, text: "Float" },
        { pageNumber: "3", text: "String" },
        { pageNumber: 4 }, // missing text
        null,
        "not-an-object",
      ];
      expect(parseExtractedPages(raw)).toEqual([{ pageNumber: 1, text: "Valid" }]);
    });

    it("returns null for non-arrays or arrays with no valid entries", () => {
      expect(parseExtractedPages(null)).toBeNull();
      expect(parseExtractedPages(undefined)).toBeNull();
      expect(parseExtractedPages([])).toBeNull();
      expect(parseExtractedPages([{ invalid: true }])).toBeNull();
    });

    it("formats page and slide delimiters correctly, omitting empty units", () => {
      const pages = [
        { pageNumber: 1, text: "Introduction" },
        { pageNumber: 2, text: "   " }, // empty
        { pageNumber: 3, text: "Conclusion" },
      ];

      const pageResult = formatDelimitedSourceText(pages, "page");
      expect(pageResult.availableUnits).toEqual([1, 3]);
      expect(pageResult.formattedText).toBe("--- Page 1 ---\nIntroduction\n\n--- Page 3 ---\nConclusion");

      const slideResult = formatDelimitedSourceText(pages, "slide");
      expect(slideResult.availableUnits).toEqual([1, 3]);
      expect(slideResult.formattedText).toBe("--- Slide 1 ---\nIntroduction\n\n--- Slide 3 ---\nConclusion");
    });
  });
});

