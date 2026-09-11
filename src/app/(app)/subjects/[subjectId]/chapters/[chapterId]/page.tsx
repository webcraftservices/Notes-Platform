import { requireUser, requireChapter } from "@/lib/access";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { CreateTopicDialog } from "@/components/topics/create-topic-dialog";
import { ChapterTabs } from "@/components/chapters/chapter-tabs";

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
          <ChapterTabs chapter={chapter} subjectId={subject.id} topics={topics} materials={materials} />
        </div>
      </main>
    </>
  );
}
