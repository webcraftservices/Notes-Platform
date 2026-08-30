import Link from "next/link";
import { Library } from "lucide-react";
import { requireUser, requireSubject, getGroupRole } from "@/lib/access";
import { roleMeetsMinimum } from "@/lib/group-role";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { EditableHeader } from "@/components/shared/editable-header";
import { SubjectActionsMenu } from "@/components/subjects/subject-actions-menu";
import { CreateChapterDialog } from "@/components/chapters/create-chapter-dialog";
import { ChapterActionsMenu } from "@/components/chapters/chapter-actions-menu";
import { ChapterStatusSelect } from "@/components/chapters/chapter-status-select";
import { getSubjectIcon, getSubjectColor } from "@/lib/subject-style";
import { MaterialsPanel } from "@/components/materials/materials-panel";

export default async function SubjectDetailPage({ params }: { params: { subjectId: string } }) {
  const user = await requireUser();
  const subject = await requireSubject(params.subjectId, user.id);

  // Phase 6.4: this page is shared by personal/workspace Subjects and
  // group Subjects (requireSubject already handles both transparently).
  // For a group Subject, the breadcrumb should point back at the owning
  // Group instead of "My Subjects", and rename/archive/delete (the
  // EditableHeader + SubjectActionsMenu below) are only shown for
  // ADMIN/OWNER — mirroring the same ADMIN+ check PATCH/DELETE
  // /api/subjects/[subjectId] already enforce server-side via
  // assertSubjectManageAccess, so this is a UI convenience on top of
  // that, never the authorization itself.
  //
  // Deliberately NOT extended to "New Chapter" / chapter actions below —
  // Chapter/Topic mutation permissions inside a group Subject are an
  // explicit Phase 6.4 scope boundary; see PROJECT_STATE.md.
  let breadcrumbRoot: { label: string; href: string } = { label: "My Subjects", href: "/subjects" };
  let canManage = true;
  if (subject.groupId) {
    const [group, role] = await Promise.all([
      db.group.findUnique({ where: { id: subject.groupId }, select: { name: true } }),
      getGroupRole(subject.groupId, user.id),
    ]);
    breadcrumbRoot = { label: group?.name ?? "Group", href: `/groups/${subject.groupId}` };
    // requireSubject() above already proved group membership, so `role`
    // is guaranteed non-null here; the `false` fallback only exists so
    // TypeScript doesn't need a non-null assertion.
    canManage = role ? roleMeetsMinimum(role, "ADMIN") : false;
  }

  const [chapters, materials] = await Promise.all([
    db.chapter.findMany({
      where: { subjectId: subject.id, deletedAt: null, archivedAt: null },
      include: { _count: { select: { topics: true } } },
      orderBy: { order: "asc" },
    }),
    db.material.findMany({
      where: { subjectId: subject.id, chapterId: null, deletedAt: null, archivedAt: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const Icon = getSubjectIcon(subject.icon);
  const palette = getSubjectColor(subject.color);

  return (
    <>
      <Topbar actions={chapters.length > 0 ? <CreateChapterDialog subjectId={subject.id} /> : null}>
        <Breadcrumbs trail={[breadcrumbRoot, { label: subject.name }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-4xl">
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
                  <h1 className="font-display text-xl font-semibold text-ink dark:text-white">
                    {subject.name}
                  </h1>
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

          <h2 className="mb-4 mt-10 font-display text-base font-semibold text-ink dark:text-white">
            Materials
          </h2>
          <MaterialsPanel
            materials={materials}
            scope={{ subjectId: subject.id }}
            emptyDescription="Materials attached directly to this subject (not a specific chapter) show up here."
          />
        </div>
      </main>
    </>
  );
}
