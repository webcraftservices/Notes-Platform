import { requireUser, requireMaterial } from "@/lib/access";
import { db } from "@/lib/db";
import { getStorageService } from "@/lib/services/storage";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { MaterialPreview } from "@/components/materials/material-preview";
import { MaterialTranscribeSection } from "@/components/materials/material-transcribe-section";
import { MaterialInfoPanel } from "@/components/materials/material-info-panel";
import { MaterialActionsMenu } from "@/components/materials/material-actions-menu";

export default async function MaterialDetailPage({
  params,
  searchParams,
}: {
  params: { materialId: string };
  /**
   * Deep-link entry points (Phase 5 — AI chat source citation
   * click-through, see lib/material-link.ts): `page` for a PDF page
   * number, `t` for an audio/video timestamp in seconds. Both optional —
   * a normal visit to this page (no query string) behaves exactly as
   * before. Parsed and validated inline here, matching the existing
   * `scope`/`q` convention in materials/page.tsx.
   */
  searchParams: { page?: string; t?: string };
}) {
  const user = await requireUser();
  const material = await requireMaterial(params.materialId, user.id);

  const pageParam = searchParams.page != null ? Number(searchParams.page) : NaN;
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : undefined;

  const timestampParam = searchParams.t != null ? Number(searchParams.t) : NaN;
  const startAtSeconds = Number.isFinite(timestampParam) && timestampParam >= 0 ? timestampParam : undefined;

  const isTranscribable =
    (material.type === "AUDIO" || material.type === "VIDEO") && material.status === "READY";

  const [subject, chapter, topic, transcript, latestJob] = await Promise.all([
    material.subjectId ? db.subject.findUnique({ where: { id: material.subjectId } }) : null,
    material.chapterId ? db.chapter.findUnique({ where: { id: material.chapterId } }) : null,
    material.topicId ? db.topic.findUnique({ where: { id: material.topicId } }) : null,
    isTranscribable
      ? db.transcript.findUnique({
          where: { materialId: material.id },
          include: { segments: { orderBy: { order: "asc" } } },
        })
      : null,
    isTranscribable
      ? db.processingJob.findFirst({
          where: { materialId: material.id, type: "TRANSCRIPTION" },
          orderBy: { createdAt: "desc" },
        })
      : null,
  ]);

  let readUrl: string | null = null;
  if (isTranscribable && material.storageKey) {
    const storage = getStorageService();
    try {
      const { LocalStorageService } = require("@/lib/services/storage-local");
      if (storage instanceof LocalStorageService) {
        readUrl = await storage.createReadUrl(material.storageKey);
      } else {
        readUrl = `/api/storage/read?key=${encodeURIComponent(material.storageKey)}`;
      }
    } catch (e) {
      readUrl = `/api/storage/read?key=${encodeURIComponent(material.storageKey)}`;
    }
  }

  return (
    <>
      <Topbar actions={<MaterialActionsMenu material={material} redirectAfterDeleteTo="/materials" />}>
        <Breadcrumbs
          trail={[
            { label: "Materials", href: "/materials" },
            { label: material.title },
          ]}
        />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
          <div>
            <h1 className="mb-4 font-display text-xl font-semibold text-ink dark:text-white">
              {material.title}
            </h1>
            {isTranscribable && readUrl ? (
              <MaterialTranscribeSection
                materialId={material.id}
                materialType={material.type as "AUDIO" | "VIDEO"}
                title={material.title}
                readUrl={readUrl}
                durationSeconds={material.durationSeconds}
                initialTranscript={
                  transcript
                    ? { language: transcript.language, segments: transcript.segments }
                    : null
                }
                initialJob={latestJob}
                startAtSeconds={startAtSeconds}
              />
            ) : (
              <MaterialPreview material={material} page={page} />
            )}
          </div>
          <MaterialInfoPanel material={material} scope={{ subject, chapter, topic }} />
        </div>
      </main>
    </>
  );
}
