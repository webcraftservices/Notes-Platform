import Link from "next/link";
import { ListTree } from "lucide-react";
import { requireUser, requireChapter } from "@/lib/access";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { EditableHeader } from "@/components/shared/editable-header";
import { ChapterActionsMenu } from "@/components/chapters/chapter-actions-menu";
import { ChapterStatusSelect } from "@/components/chapters/chapter-status-select";
import { CreateTopicDialog } from "@/components/topics/create-topic-dialog";
import { TopicActionsMenu } from "@/components/topics/topic-actions-menu";
import { MaterialsPanel } from "@/components/materials/materials-panel";

export default async function ChapterDetailPage({
  params,
}: {
  params: { subjectId: string; chapterId: string };
}) {
  const user = await requireUser();
  const chapter = await requireChapter(params.chapterId, user.id);

  const subject = await db.subject.findUniqueOrThrow({ where: { id: params.subjectId } });

  const [topics, materials] = await Promise.all([
    db.topic.findMany({
      where: { chapterId: chapter.id, deletedAt: null, archivedAt: null },
      orderBy: { order: "asc" },
    }),
    db.material.findMany({
      where: { chapterId: chapter.id, topicId: null, deletedAt: null, archivedAt: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <>
      <Topbar actions={topics.length > 0 ? <CreateTopicDialog chapterId={chapter.id} /> : null}>
        <Breadcrumbs
          trail={[
            { label: "My Subjects", href: "/subjects" },
            { label: subject.name, href: `/subjects/${subject.id}` },
            { label: chapter.name },
          ]}
        />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-start justify-between gap-4">
            <EditableHeader
              endpoint={`/api/chapters/${chapter.id}`}
              name={chapter.name}
              description={chapter.description}
            />
            <div className="flex items-center gap-2">
              <ChapterStatusSelect chapterId={chapter.id} status={chapter.status} />
              <ChapterActionsMenu chapter={chapter} redirectAfterDeleteTo={`/subjects/${subject.id}`} />
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
                  <Link
                    href={`/subjects/${subject.id}/chapters/${chapter.id}/topics/${topic.id}`}
                    className="min-w-0 flex-1"
                  >
                    <p className="truncate text-sm font-medium text-ink dark:text-white">{topic.name}</p>
                    {topic.description && (
                      <p className="mt-0.5 truncate text-xs text-ink-faint dark:text-white/30">
                        {topic.description}
                      </p>
                    )}
                  </Link>
                  <div className="opacity-0 transition-opacity group-hover:opacity-100">
                    <TopicActionsMenu topic={topic} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <h2 className="mb-4 mt-10 font-display text-base font-semibold text-ink dark:text-white">
            Materials
          </h2>
          <MaterialsPanel
            materials={materials}
            scope={{ chapterId: chapter.id }}
            emptyDescription="Materials attached directly to this chapter (not a specific topic) show up here."
          />
        </div>
      </main>
    </>
  );
}
