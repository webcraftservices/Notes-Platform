"use client";

import type { Chapter, Material, Topic } from "@prisma/client";
import Link from "next/link";
import { ListTree } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { EditableHeader } from "@/components/shared/editable-header";
import { ChapterActionsMenu } from "@/components/chapters/chapter-actions-menu";
import { ChapterStatusSelect } from "@/components/chapters/chapter-status-select";
import { CreateTopicDialog } from "@/components/topics/create-topic-dialog";
import { TopicActionsMenu } from "@/components/topics/topic-actions-menu";
import { MaterialsPanel } from "@/components/materials/materials-panel";
import { AIChatPanel } from "@/components/ai/ai-chat-panel";

/**
 * Same Tabs-per-scope pattern as TopicTabs/GroupTabs/SubjectTabs: "AI
 * Chat" is a TabsContent, so AIChatPanel only mounts (and only then fires
 * its GET /api/ai/conversations?chapterId= fetch) once the user actually
 * selects that tab. Everything that was the Chapter page's entire body
 * before this task is now the "Overview" tab's content, unchanged — this
 * only adds a sibling tab.
 */
export function ChapterTabs({
  chapter,
  subjectId,
  topics,
  materials,
}: {
  chapter: Chapter;
  subjectId: string;
  topics: Topic[];
  materials: Material[];
}) {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="ai-chat">AI Chat</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <div className="mb-8 flex items-start justify-between gap-4">
          <EditableHeader endpoint={`/api/chapters/${chapter.id}`} name={chapter.name} description={chapter.description} />
          <div className="flex items-center gap-2">
            <ChapterStatusSelect chapterId={chapter.id} status={chapter.status} />
            <ChapterActionsMenu chapter={chapter} redirectAfterDeleteTo={`/subjects/${subjectId}`} />
          </div>
        </div>

        <h2 className="mb-4 font-display text-base font-semibold text-ink dark:text-white">Topics</h2>

        {topics.length === 0 ? (
          <EmptyState
            icon={ListTree}
            title="No topics yet"
            description="Topics are where notes, materials, transcripts, and AI chat live."
            action={<CreateTopicDialog chapterId={chapter.id} />}
          />
        ) : (
          <div className="space-y-2">
            {topics.map((topic) => (
              <div key={topic.id} className="card group flex items-center justify-between gap-4 px-4 py-3.5">
                <Link href={`/subjects/${subjectId}/chapters/${chapter.id}/topics/${topic.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink dark:text-white">{topic.name}</p>
                  {topic.description && (
                    <p className="mt-0.5 truncate text-xs text-ink-faint dark:text-white/30">{topic.description}</p>
                  )}
                </Link>
                <div className="opacity-0 transition-opacity group-hover:opacity-100">
                  <TopicActionsMenu topic={topic} />
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 className="mb-4 mt-10 font-display text-base font-semibold text-ink dark:text-white">Materials</h2>
        <MaterialsPanel
          materials={materials}
          scope={{ chapterId: chapter.id }}
          emptyDescription="Materials attached directly to this chapter (not a specific topic) show up here."
        />
      </TabsContent>

      <TabsContent value="ai-chat">
        <AIChatPanel
          scope={{ chapterId: chapter.id }}
          emptyStateHint="Questions are answered using this chapter's materials — every topic underneath it — with clickable sources."
        />
      </TabsContent>
    </Tabs>
  );
}
