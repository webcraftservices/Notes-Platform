import { requireUser, requireTopic } from "@/lib/access";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { TopicActionsMenu } from "@/components/topics/topic-actions-menu";
import { TopicTabs } from "@/components/topics/topic-tabs";
import type { TranscribableMaterial } from "@/components/topics/topic-transcripts-panel";

export default async function TopicDetailPage({
  params,
}: {
  params: { subjectId: string; chapterId: string; topicId: string };
}) {
  const user = await requireUser();
  const topic = await requireTopic(params.topicId, user.id);

  const [subject, chapter, materials] = await Promise.all([
    db.subject.findUniqueOrThrow({ where: { id: params.subjectId } }),
    db.chapter.findUniqueOrThrow({ where: { id: params.chapterId } }),
    db.material.findMany({
      where: { topicId: topic.id, deletedAt: null, archivedAt: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const audioVideoMaterials = materials.filter((m) => m.type === "AUDIO" || m.type === "VIDEO");
  const materialIds = audioVideoMaterials.map((m) => m.id);

  const [transcripts, jobs] = await Promise.all([
    materialIds.length > 0
      ? db.transcript.findMany({ where: { materialId: { in: materialIds } }, select: { materialId: true, status: true } })
      : [],
    materialIds.length > 0
      ? db.processingJob.findMany({
          where: { materialId: { in: materialIds }, type: "TRANSCRIPTION" },
          orderBy: { createdAt: "desc" },
          select: { materialId: true, status: true, createdAt: true },
        })
      : [],
  ]);

  const transcriptByMaterial = new Map(transcripts.map((t) => [t.materialId, t.status]));
  const latestJobByMaterial = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    if (!job.materialId) continue;
    if (!latestJobByMaterial.has(job.materialId)) latestJobByMaterial.set(job.materialId, job);
  }

  const transcribableMaterials: TranscribableMaterial[] = audioVideoMaterials.map((m) => ({
    id: m.id,
    title: m.title,
    type: m.type as "AUDIO" | "VIDEO",
    durationSeconds: m.durationSeconds,
    transcriptReady: transcriptByMaterial.get(m.id) === "READY",
    jobStatus: (latestJobByMaterial.get(m.id)?.status as TranscribableMaterial["jobStatus"]) ?? null,
  }));

  return (
    <>
      <Topbar
        actions={
          <TopicActionsMenu
            topic={topic}
            redirectAfterDeleteTo={`/subjects/${subject.id}/chapters/${chapter.id}`}
          />
        }
      >
        <Breadcrumbs
          trail={[
            { label: "My Subjects", href: "/subjects" },
            { label: subject.name, href: `/subjects/${subject.id}` },
            { label: chapter.name, href: `/subjects/${subject.id}/chapters/${chapter.id}` },
            { label: topic.name },
          ]}
        />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <TopicTabs
            topicId={topic.id}
            name={topic.name}
            description={topic.description}
            materials={materials}
            transcribableMaterials={transcribableMaterials}
          />
        </div>
      </main>
    </>
  );
}
