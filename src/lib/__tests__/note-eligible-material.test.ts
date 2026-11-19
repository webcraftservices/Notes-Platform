import { describe, expect, it } from "vitest";
import {
  buildNoteEligibleMaterials,
  type NoteEligibleMaterial,
} from "@/lib/note-eligible-material";

describe("buildNoteEligibleMaterials", () => {
  it("maps ready audio and video materials when transcript is READY", () => {
    const materials = [
      { id: "audio-1", title: "Lecture Recording", type: "AUDIO" as const },
      { id: "video-1", title: "Lab Demo", type: "VIDEO" as const },
    ];
    const transcriptByMaterial = new Map([
      ["audio-1", "READY"],
      ["video-1", "READY"],
    ]);

    const result = buildNoteEligibleMaterials({
      materials,
      transcriptByMaterial,
      latestJobByMaterial: new Map(),
      readyDocIdSet: new Set(),
      processingDocIdSet: new Set(),
    });

    expect(result).toEqual<NoteEligibleMaterial[]>([
      {
        id: "audio-1",
        title: "Lecture Recording",
        type: "AUDIO",
        isReady: true,
        isProcessing: false,
      },
      {
        id: "video-1",
        title: "Lab Demo",
        type: "VIDEO",
        isReady: true,
        isProcessing: false,
      },
    ]);
  });

  it("maps audio/video materials to processing when transcript is not ready and transcription job is active", () => {
    const materials = [
      { id: "audio-queued", title: "Queued Audio", type: "AUDIO" as const },
      { id: "video-running", title: "Running Video", type: "VIDEO" as const },
    ];
    const transcriptByMaterial = new Map([
      ["audio-queued", "PROCESSING"],
      ["video-running", "PROCESSING"],
    ]);
    const latestJobByMaterial = new Map([
      ["audio-queued", { status: "QUEUED" }],
      ["video-running", { status: "RUNNING" }],
    ]);

    const result = buildNoteEligibleMaterials({
      materials,
      transcriptByMaterial,
      latestJobByMaterial,
      readyDocIdSet: new Set(),
      processingDocIdSet: new Set(),
    });

    expect(result).toEqual<NoteEligibleMaterial[]>([
      {
        id: "audio-queued",
        title: "Queued Audio",
        type: "AUDIO",
        isReady: false,
        isProcessing: true,
      },
      {
        id: "video-running",
        title: "Running Video",
        type: "VIDEO",
        isReady: false,
        isProcessing: true,
      },
    ]);
  });

  it("maps ready documents across all supported document types (PDF, DOCX, PPTX, GOOGLE_DOC)", () => {
    const materials = [
      { id: "doc-pdf", title: "Paper.pdf", type: "PDF" as const },
      { id: "doc-docx", title: "Report.docx", type: "DOCX" as const },
      { id: "doc-pptx", title: "Slides.pptx", type: "PPTX" as const },
      { id: "doc-gdoc", title: "Syllabus", type: "GOOGLE_DOC" as const },
    ];
    const readyDocIdSet = new Set(["doc-pdf", "doc-docx", "doc-pptx", "doc-gdoc"]);

    const result = buildNoteEligibleMaterials({
      materials,
      transcriptByMaterial: new Map(),
      latestJobByMaterial: new Map(),
      readyDocIdSet,
      processingDocIdSet: new Set(),
    });

    expect(result).toHaveLength(4);
    for (const item of result) {
      expect(item.isReady).toBe(true);
      expect(item.isProcessing).toBe(false);
    }
  });

  it("maps documents with active extraction jobs to processing", () => {
    const materials = [
      { id: "doc-extracting", title: "Large.pdf", type: "PDF" as const },
      { id: "gdoc-syncing", title: "Drive Doc", type: "GOOGLE_DOC" as const },
    ];
    const processingDocIdSet = new Set(["doc-extracting", "gdoc-syncing"]);

    const result = buildNoteEligibleMaterials({
      materials,
      transcriptByMaterial: new Map(),
      latestJobByMaterial: new Map(),
      readyDocIdSet: new Set(),
      processingDocIdSet,
    });

    expect(result).toEqual<NoteEligibleMaterial[]>([
      {
        id: "doc-extracting",
        title: "Large.pdf",
        type: "PDF",
        isReady: false,
        isProcessing: true,
      },
      {
        id: "gdoc-syncing",
        title: "Drive Doc",
        type: "GOOGLE_DOC",
        isReady: false,
        isProcessing: true,
      },
    ]);
  });

  it("gives ready-over-processing precedence when a document has extracted text but also an active job", () => {
    const materials = [
      { id: "doc-both", title: "Updated.pdf", type: "PDF" as const },
    ];
    // Both ready and in active job set (e.g. stale job)
    const readyDocIdSet = new Set(["doc-both"]);
    const processingDocIdSet = new Set(["doc-both"]);

    const result = buildNoteEligibleMaterials({
      materials,
      transcriptByMaterial: new Map(),
      latestJobByMaterial: new Map(),
      readyDocIdSet,
      processingDocIdSet,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual<NoteEligibleMaterial>({
      id: "doc-both",
      title: "Updated.pdf",
      type: "PDF",
      isReady: true,
      isProcessing: false,
    });
  });

  it("excludes unsupported material types like IMAGE, LINK, OTHER, and TEXT", () => {
    const materials = [
      { id: "m-img", title: "Diagram.png", type: "IMAGE" as const },
      { id: "m-link", title: "Reference Link", type: "LINK" as const },
      { id: "m-other", title: "Archive.zip", type: "OTHER" as const },
      { id: "m-text", title: "Snippet.txt", type: "TEXT" as const },
    ];

    const result = buildNoteEligibleMaterials({
      materials,
      transcriptByMaterial: new Map(),
      latestJobByMaterial: new Map(),
      readyDocIdSet: new Set(["m-img", "m-link", "m-other", "m-text"]),
      processingDocIdSet: new Set(["m-img", "m-link", "m-other", "m-text"]),
    });

    expect(result).toHaveLength(0);
  });

  it("excludes materials that have neither ready content nor active processing", () => {
    const materials = [
      { id: "audio-none", title: "No transcript", type: "AUDIO" as const },
      { id: "pdf-none", title: "Corrupt file", type: "PDF" as const },
    ];

    const result = buildNoteEligibleMaterials({
      materials,
      transcriptByMaterial: new Map(),
      latestJobByMaterial: new Map(),
      readyDocIdSet: new Set(),
      processingDocIdSet: new Set(),
    });

    expect(result).toHaveLength(0);
  });
});

