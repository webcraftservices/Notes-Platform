import React from "react";
(globalThis as any).React = React;
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotesTabPanel } from "@/components/notes/notes-tab-panel";
import type { NoteEligibleMaterial } from "@/lib/note-eligible-material";

vi.mock("@/components/notes/note-editor", () => ({
  NoteEditor: ({ topicId }: { topicId: string }) => (
    <div data-testid="note-editor" data-topic-id={topicId}>
      Note Editor Content
    </div>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div data-testid="dropdown-root">{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div data-testid="dropdown-trigger">{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div data-testid="dropdown-content">{children}</div>,
  DropdownMenuItem: ({ children, disabled, onClick, className }: any) => (
    <div
      data-testid="dropdown-item"
      data-disabled={disabled ? "true" : undefined}
      className={className}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </div>
  ),
}));

describe("NotesTabPanel", () => {
  it("renders when only document materials are ready", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "doc-1", title: "Chemistry-Textbook.pdf", type: "PDF", isReady: true, isProcessing: false },
    ];

    const html = renderToStaticMarkup(<NotesTabPanel topicId="top-1" materials={materials} />);

    expect(html).toContain("Generate AI Notes");
    expect(html).toContain("Note Editor Content");
  });

  it("renders when only audio/video materials are ready", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "audio-1", title: "Lecture-Week-1.mp3", type: "AUDIO", isReady: true, isProcessing: false },
    ];

    const html = renderToStaticMarkup(<NotesTabPanel topicId="top-1" materials={materials} />);

    expect(html).toContain("Generate AI Notes");
    expect(html).toContain("Note Editor Content");
  });

  it("renders dropdown when a combination of documents and audio/video are eligible", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "audio-1", title: "Lecture Audio", type: "AUDIO", isReady: true, isProcessing: false },
      { id: "doc-1", title: "Lecture Slides.pdf", type: "PDF", isReady: true, isProcessing: false },
      { id: "doc-2", title: "Word Summary.docx", type: "DOCX", isReady: true, isProcessing: false },
    ];

    const html = renderToStaticMarkup(<NotesTabPanel topicId="top-1" materials={materials} />);

    expect(html).toContain("Generate AI Notes");
    expect(html).toContain("lucide-chevron-down");
    expect(html).toContain("Lecture Audio");
    expect(html).toContain("Lecture Slides.pdf");
    expect(html).toContain("Word Summary.docx");
    expect(html).toContain("Note Editor Content");
  });

  it("renders disabled state when materials are processing-only", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "doc-proc", title: "Large-File.pdf", type: "PDF", isReady: false, isProcessing: true },
    ];

    const html = renderToStaticMarkup(<NotesTabPanel topicId="top-1" materials={materials} />);

    expect(html).toContain("disabled");
    expect(html).toContain("Extracting material…");
    expect(html).not.toContain("Generate AI Notes");
    expect(html).toContain("Note Editor Content");
  });

  it("renders only the NoteEditor when no materials are eligible", () => {
    // Empty array
    const htmlEmpty = renderToStaticMarkup(<NotesTabPanel topicId="top-1" materials={[]} />);
    expect(htmlEmpty).not.toContain("Generate AI Notes");
    expect(htmlEmpty).not.toContain("Extracting");
    expect(htmlEmpty).toContain("Note Editor Content");

    // Array with non-ready, non-processing materials
    const nonEligible: NoteEligibleMaterial[] = [
      { id: "audio-none", title: "Unprocessed", type: "AUDIO", isReady: false, isProcessing: false },
    ];
    const htmlNonEligible = renderToStaticMarkup(<NotesTabPanel topicId="top-1" materials={nonEligible} />);
    expect(htmlNonEligible).not.toContain("Generate AI Notes");
    expect(htmlNonEligible).toContain("Note Editor Content");
  });

  it("renders ready materials alongside processing materials in dropdown", () => {
    const materials: NoteEligibleMaterial[] = [
      { id: "doc-ready", title: "Ready Notes.docx", type: "DOCX", isReady: true, isProcessing: false },
      { id: "doc-proc", title: "Extracting Slides.pptx", type: "PPTX", isReady: false, isProcessing: true },
    ];

    const html = renderToStaticMarkup(<NotesTabPanel topicId="top-1" materials={materials} />);

    expect(html).toContain("Generate AI Notes");
    expect(html).toContain("Ready Notes.docx");
    expect(html).toContain("Extracting Slides.pptx");
    expect(html).toContain("Extracting…");
  });
});

