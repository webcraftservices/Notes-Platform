import { requireUser, requireSubject, getGroupRole } from "@/lib/access";
import { roleMeetsMinimum } from "@/lib/group-role";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { CreateChapterDialog } from "@/components/chapters/create-chapter-dialog";
import { SubjectTabs } from "@/components/subjects/subject-tabs";

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

  return (
    <>
      <Topbar actions={chapters.length > 0 ? <CreateChapterDialog subjectId={subject.id} /> : null}>
        <Breadcrumbs trail={[breadcrumbRoot, { label: subject.name }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <SubjectTabs subject={subject} canManage={canManage} chapters={chapters} materials={materials} />
        </div>
      </main>
    </>
  );
}
