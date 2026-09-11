"use client";

import type { Chapter, Material, Subject } from "@prisma/client";
import Link from "next/link";
import { Library } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { EditableHeader } from "@/components/shared/editable-header";
import { SubjectActionsMenu } from "@/components/subjects/subject-actions-menu";
import { CreateChapterDialog } from "@/components/chapters/create-chapter-dialog";
import { ChapterActionsMenu } from "@/components/chapters/chapter-actions-menu";
import { ChapterStatusSelect } from "@/components/chapters/chapter-status-select";
import { MaterialsPanel } from "@/components/materials/materials-panel";
import { AIChatPanel } from "@/components/ai/ai-chat-panel";
import { getSubjectIcon, getSubjectColor } from "@/lib/subject-style";

type ChapterWithTopicCount = Chapter & { _count: { topics: number } };

/**
 * Same Tabs-per-scope pattern as TopicTabs/GroupTabs: "AI Chat" is a
 * TabsContent, so AIChatPanel (and its GET /api/ai/conversations?subjectId=
 * fetch) only mounts once the user actually selects that tab — Radix's
 * TabsContent doesn't render inactive panels by default, so a Subject
 * page visit alone never triggers an AI conversation fetch. Everything
 * that was the Subject page's entire body before this task is now the
 * "Overview" tab's content, unchanged — this only adds a sibling tab.
 */
export function SubjectTabs({
  subject,
  canManage,
  chapters,
  materials,
}: {
  subject: Subject;
  canManage: boolean;
  chapters: ChapterWithTopicCount[];
  materials: Material[];
}) {
  const Icon = getSubjectIcon(subject.icon);
  const palette = getSubjectColor(subject.color);

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="ai-chat">AI Chat</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded ${palette.bg}`}>
              <Icon className={`h-5 w-5 ${palette.text}`} strokeWidth={1.75} />
            </div>
            {canManage ? (
              <EditableHeader
                endpoint={`/api/subjects/${subject.id}`}
                name={subject.name}
                description={subject.description}
                titleClassName="font-display text-xl font-semibold text-ink dark:text-white"
              />
            ) : (
              <div>
                <h1 className="font-display text-xl font-semibold text-ink dark:text-white">{subject.name}</h1>
                {subject.description && (
                  <p className="mt-1 text-sm text-ink-muted dark:text-white/50">{subject.description}</p>
                )}
              </div>
            )}
          </div>
          {canManage && <SubjectActionsMenu subject={subject} />}
        </div>

        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-ink dark:text-white">Chapters</h2>
        </div>

        {chapters.length === 0 ? (
          <EmptyState
            icon={Library}
            title="No chapters yet"
            description="Break this subject into chapters, then topics inside each one."
            action={<CreateChapterDialog subjectId={subject.id} />}
          />
        ) : (
          <div className="space-y-2">
            {chapters.map((chapter) => (
              <div key={chapter.id} className="card group flex items-center justify-between gap-4 px-4 py-3.5">
                <Link href={`/subjects/${subject.id}/chapters/${chapter.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink dark:text-white">{chapter.name}</p>
                  <p className="mt-0.5 text-xs text-ink-faint dark:text-white/30">
                    {chapter._count.topics} {chapter._count.topics === 1 ? "topic" : "topics"}
                  </p>
                </Link>
                <div className="flex items-center gap-2">
                  <ChapterStatusSelect chapterId={chapter.id} status={chapter.status} />
                  <div className="opacity-0 transition-opacity group-hover:opacity-100">
                    <ChapterActionsMenu chapter={chapter} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 className="mb-4 mt-10 font-display text-base font-semibold text-ink dark:text-white">Materials</h2>
        <MaterialsPanel
          materials={materials}
          scope={{ subjectId: subject.id }}
          emptyDescription="Materials attached directly to this subject (not a specific chapter) show up here."
        />
      </TabsContent>

      <TabsContent value="ai-chat">
        <AIChatPanel
          scope={{ subjectId: subject.id }}
          emptyStateHint="Questions are answered using this subject's materials — every chapter and topic underneath it — with clickable sources."
        />
      </TabsContent>
    </Tabs>
  );
}
