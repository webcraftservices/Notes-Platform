"use client";

import type { Material } from "@prisma/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EditableHeader } from "@/components/shared/editable-header";
import { NotesTabPanel } from "@/components/notes/notes-tab-panel";
import { MaterialsPanel } from "@/components/materials/materials-panel";
import { TopicTranscriptsPanel, type TranscribableMaterial } from "@/components/topics/topic-transcripts-panel";
import { AIChatPanel } from "@/components/ai/ai-chat-panel";
import { FlashcardsStudyToolsPanel } from "@/components/topics/flashcards-study-tools-panel";

export function TopicTabs({
  topicId,
  name,
  description,
  materials,
  transcribableMaterials,
}: {
  topicId: string;
  name: string;
  description: string | null;
  materials: Material[];
  transcribableMaterials: TranscribableMaterial[];
}) {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="materials">Materials</TabsTrigger>
        <TabsTrigger value="transcript">Transcript</TabsTrigger>
        <TabsTrigger value="ai-chat">AI Chat</TabsTrigger>
        <TabsTrigger value="study-tools">Study Tools</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <EditableHeader endpoint={`/api/topics/${topicId}`} name={name} description={description} />
      </TabsContent>

      <TabsContent value="notes">
        <NotesTabPanel topicId={topicId} transcribableMaterials={transcribableMaterials} />
      </TabsContent>

      <TabsContent value="materials">
        <MaterialsPanel materials={materials} scope={{ topicId }} />
      </TabsContent>

      <TabsContent value="transcript">
        <TopicTranscriptsPanel materials={transcribableMaterials} />
      </TabsContent>

      <TabsContent value="ai-chat">
        <AIChatPanel
          scope={{ topicId }}
          emptyStateHint="Questions are answered using this topic's transcribed materials, with clickable sources."
        />
      </TabsContent>

      <TabsContent value="study-tools">
        <FlashcardsStudyToolsPanel topicId={topicId} />
        <p className="mt-6 text-center text-xs text-ink-faint dark:text-white/40">
          Quizzes and the AI tutor are coming in a later update.
        </p>
      </TabsContent>
    </Tabs>
  );
}

