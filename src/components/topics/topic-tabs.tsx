"use client";

import type { Material } from "@prisma/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EditableHeader } from "@/components/shared/editable-header";
import { NotesTabPanel } from "@/components/notes/notes-tab-panel";
import { MaterialsPanel } from "@/components/materials/materials-panel";
import { TopicTranscriptsPanel, type TranscribableMaterial } from "@/components/topics/topic-transcripts-panel";
import { AIChatPanel } from "@/components/ai/ai-chat-panel";
import { FlashcardsStudyToolsPanel } from "@/components/topics/flashcards-study-tools-panel";
import { QuizStudyToolsPanel } from "@/components/topics/quiz-study-tools-panel";
import { StudyProgressPanel } from "@/components/topics/study-progress-panel";

export function TopicTabs({
  topicId,
  name,
  description,
  materials,
  transcribableMaterials,
  aiTutorEnabled,
}: {
  topicId: string;
  name: string;
  description: string | null;
  materials: Material[];
  transcribableMaterials: TranscribableMaterial[];
  /** Phase 8.4 — PlanLimits.advancedFeatures.aiTutor for the current user, resolved server-side in page.tsx. Gates the Tutor entry point below; the real enforcement is server-side in the API routes (assertAiTutorEntitlement) — this is UX only, same "frontend hides, backend is authoritative" split as every other entitlement in this app. */
  aiTutorEnabled: boolean;
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
        <div className="mb-6 border-b border-line pb-6 dark:border-line-dark">
          <h3 className="text-sm font-medium text-ink dark:text-white">Your progress</h3>
          <div className="mt-4">
            <StudyProgressPanel topicId={topicId} />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <FlashcardsStudyToolsPanel topicId={topicId} />
          <QuizStudyToolsPanel topicId={topicId} />
        </div>
        <div className="mt-8 border-t border-line pt-6 dark:border-line-dark">
          <h3 className="text-sm font-medium text-ink dark:text-white">AI Tutor</h3>
          {aiTutorEnabled ? (
            <>
              <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
                A focused, private conversation grounded strictly in this topic&apos;s indexed materials — separate
                from the AI Chat tab.
              </p>
              <div className="mt-4">
                <AIChatPanel
                  scope={{ topicId }}
                  kind="TUTOR"
                  emptyStateHint="Answers are grounded in this topic's indexed materials, with clickable sources. If nothing is indexed yet, add and process some material first."
                />
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
              AI Tutor isn&apos;t available on your current plan. Upgrade your plan in Settings to use it.
            </p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

