import { requireUser, requireTopic } from "@/lib/access";
import { db } from "@/lib/db";
import { MATERIAL_LIST_SELECT } from "@/lib/material-list-select";
import { getPlanLimits } from "@/lib/plans";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { TopicActionsMenu } from "@/components/topics/topic-actions-menu";
import { TopicTabs } from "@/components/topics/topic-tabs";
import type { TranscribableMaterial } from "@/components/topics/topic-transcripts-panel";
import { buildNoteEligibleMaterials } from "@/lib/note-eligible-material";

export default async function TopicDetailPage({
  params,
}: {
  params: { subjectId: string; chapterId: string; topicId: string };
}) {
  const user = await requireUser();
  const topic = await requireTopic(params.topicId, user.id);

  const [subject, chapter, materials, subscription] = await Promise.all([
    db.subject.findUniqueOrThrow({ where: { id: params.subjectId } }),
    db.chapter.findUniqueOrThrow({ where: { id: params.chapterId } }),
    db.material.findMany({
      where: { topicId: topic.id, deletedAt: null, archivedAt: null },
      select: MATERIAL_LIST_SELECT,
      orderBy: { createdAt: "desc" },
    }),
    // Phase 8.4 — resolved here (not inside TopicTabs, a client component)
    // so the Tutor entry point's visibility is decided server-side from
    // the same PlanLimits.advancedFeatures.aiTutor flag the API routes
    // themselves enforce (lib/ai-quota.ts's assertAiTutorEntitlement) —
    // same "getPlanLimits(subscription?.plan ?? 'FREE')" pattern already
    // used in (app)/layout.tsx and (app)/settings/page.tsx.
    db.subscription.findUnique({ where: { userId: user.id } }),
  ]);

  const aiTutorEnabled = getPlanLimits(subscription?.plan ?? "FREE").advancedFeatures.aiTutor;

  const audioVideoMaterials = materials.filter((m) => m.type === "AUDIO" || m.type === "VIDEO");
  const materialIds = audioVideoMaterials.map((m) => m.id);

  const documentMaterials = materials.filter(
    (m) => m.type === "PDF" || m.type === "DOCX" || m.type === "PPTX" || m.type === "GOOGLE_DOC"
  );
  const documentIds = documentMaterials.map((m) => m.id);

  const [transcripts, jobs, readyDocs, activeDocJobs] = await Promise.all([
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
    documentIds.length > 0
      ? db.material.findMany({
          where: {
            id: { in: documentIds },
            AND: [
              { extractedText: { not: null } },
              { NOT: { extractedText: "" } },
            ],
          },
          select: { id: true },
        })
      : [],
    documentIds.length > 0
      ? db.processingJob.findMany({
          where: {
            materialId: { in: documentIds },
            type: { in: ["DOCUMENT_EXTRACTION", "GOOGLE_SYNC"] },
            status: { in: ["QUEUED", "RUNNING"] },
          },
          select: { materialId: true, status: true },
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

  const readyDocIdSet = new Set(readyDocs.map((d) => d.id));
  const processingDocIdSet = new Set(
    activeDocJobs.map((j) => j.materialId).filter((id): id is string => Boolean(id))
  );

  const noteEligibleMaterials = buildNoteEligibleMaterials({
    materials,
    transcriptByMaterial,
    latestJobByMaterial,
    readyDocIdSet,
    processingDocIdSet,
  });

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
            noteEligibleMaterials={noteEligibleMaterials}
            aiTutorEnabled={aiTutorEnabled}
          />
        </div>
      </main>
    </>
  );
}
