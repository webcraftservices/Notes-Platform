import React from "react";
(globalThis as any).React = React;
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TopicTabs } from "@/components/topics/topic-tabs";
import type { MaterialListItem } from "@/lib/material-list-select";
import type { TranscribableMaterial } from "@/components/topics/topic-transcripts-panel";
import type { NoteEligibleMaterial } from "@/lib/note-eligible-material";

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div data-testid="tabs">{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  TabsContent: ({ children, value }: any) => <div data-tab={value}>{children}</div>,
}));

vi.mock("@/components/shared/editable-header", () => ({
  EditableHeader: () => <div data-testid="editable-header">Header</div>,
}));

vi.mock("@/components/notes/notes-tab-panel", () => ({
  NotesTabPanel: ({ materials, topicId }: { materials: NoteEligibleMaterial[]; topicId: string }) => (
    <div data-testid="notes-tab-panel" data-topic-id={topicId} data-material-count={materials.length}>
      Notes Panel ({materials.length} materials)
    </div>
  ),
}));

vi.mock("@/components/materials/materials-panel", () => ({
  MaterialsPanel: ({ materials }: { materials: MaterialListItem[] }) => (
    <div data-testid="materials-panel">Materials Panel ({materials.length})</div>
  ),
}));

vi.mock("@/components/topics/topic-transcripts-panel", () => ({
  TopicTranscriptsPanel: ({ materials }: { materials: TranscribableMaterial[] }) => (
    <div data-testid="transcripts-panel" data-count={materials.length}>
      Transcripts Panel ({materials.length} transcribable)
    </div>
  ),
}));

vi.mock("@/components/ai/ai-chat-panel", () => ({
  AIChatPanel: () => <div data-testid="ai-chat-panel">AI Chat</div>,
}));

vi.mock("@/components/topics/flashcards-study-tools-panel", () => ({
  FlashcardsStudyToolsPanel: () => <div>Flashcards</div>,
}));

vi.mock("@/components/topics/quiz-study-tools-panel", () => ({
  QuizStudyToolsPanel: () => <div>Quiz</div>,
}));

vi.mock("@/components/topics/study-progress-panel", () => ({
  StudyProgressPanel: () => <div>Progress</div>,
}));

describe("TopicTabs", () => {
  it("forwards noteEligibleMaterials to NotesTabPanel and transcribableMaterials to TopicTranscriptsPanel", () => {
    const mockMaterials: MaterialListItem[] = [
      {
        id: "mat-1",
        ownerId: "u-1",
        workspaceId: null,
        subjectId: "sub-1",
        chapterId: "ch-1",
        topicId: "top-1",
        groupId: null,
        type: "AUDIO",
        title: "Audio Lec",
        originalFilename: "audio.mp3",
        storageKey: "key-1",
        externalRef: null,
        sourceUrl: null,
        mimeType: "audio/mpeg",
        sizeBytes: 1024,
        durationSeconds: 120,
        status: "READY",
        visibility: "PRIVATE",
        tags: [],
        metadata: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ];

    const mockTranscribable: TranscribableMaterial[] = [
      {
        id: "mat-1",
        title: "Audio Lec",
        type: "AUDIO",
        durationSeconds: 120,
        transcriptReady: true,
        jobStatus: "SUCCEEDED",
      },
    ];

    const mockNoteEligible: NoteEligibleMaterial[] = [
      {
        id: "mat-1",
        title: "Audio Lec",
        type: "AUDIO",
        isReady: true,
        isProcessing: false,
      },
      {
        id: "doc-1",
        title: "Slides.pdf",
        type: "PDF",
        isReady: true,
        isProcessing: false,
      },
    ];

    const html = renderToStaticMarkup(
      <TopicTabs
        topicId="top-1"
        name="Topic 1"
        description="Description"
        materials={mockMaterials}
        transcribableMaterials={mockTranscribable}
        noteEligibleMaterials={mockNoteEligible}
        aiTutorEnabled={true}
      />
    );

    // Notes tab panel receives 2 note-eligible materials (audio + document)
    expect(html).toContain("Notes Panel (2 materials)");
    // Transcripts tab panel receives strictly the 1 transcribable material
    expect(html).toContain("Transcripts Panel (1 transcribable)");
  });
});
