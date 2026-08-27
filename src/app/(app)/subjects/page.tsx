import { Plus, BookOpen } from "lucide-react";
import { requireUser, getPrimaryWorkspace } from "@/lib/access";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SubjectCard } from "@/components/subjects/subject-card";
import { CreateSubjectDialog } from "@/components/subjects/create-subject-dialog";
import { NewSubjectButton } from "@/components/subjects/new-subject-button";

export default async function SubjectsPage() {
  const user = await requireUser();
  const workspace = await getPrimaryWorkspace(user.id);

  const subjects = await db.subject.findMany({
    where: { workspaceId: workspace.id, deletedAt: null, archivedAt: null },
    include: { _count: { select: { chapters: true, materials: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <>
      <Topbar actions={subjects.length > 0 ? <NewSubjectButton /> : null}>
        <Breadcrumbs trail={[{ label: "My Subjects" }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">My Subjects</h1>
              <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
                {subjects.length} {subjects.length === 1 ? "subject" : "subjects"}
              </p>
            </div>
          </div>

          {subjects.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No subjects yet"
              description="Create your first subject to start organizing chapters, topics, and materials."
              action={<NewSubjectButton />}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((subject) => (
                <SubjectCard key={subject.id} subject={subject} />
              ))}
            </div>
          )}
        </div>
      </main>
      <CreateSubjectDialog />
    </>
  );
}
