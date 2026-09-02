import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { BookOpen, TrendingUp, Sparkles, Users, FolderOpen } from "lucide-react";
import { requireUser, getPrimaryWorkspace } from "@/lib/access";
import { getDashboardData } from "@/lib/dashboard";
import { Topbar } from "@/components/shell/topbar";
import { EmptyState } from "@/components/ui/empty-state";
import { SubjectCard } from "@/components/subjects/subject-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { ProgressRow } from "@/components/dashboard/progress-row";
import { CreateSubjectDialog } from "@/components/subjects/create-subject-dialog";
import { CreateGroupDialog } from "@/components/groups/create-group-dialog";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";
import { MaterialCard } from "@/components/materials/material-card";
import { UploadMaterialDialog } from "@/components/materials/upload-material-dialog";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const workspace = await getPrimaryWorkspace(user.id);
  const { recentSubjects, recentTopics, progress, subjectCount, recentMaterials } = await getDashboardData(workspace.id);
  const firstName = user.name?.split(" ")[0] ?? "there";

  return (
    <>
      <Topbar>
        <span className="font-display text-sm font-semibold text-ink dark:text-white">Home</span>
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-5xl space-y-10">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">
              {greeting()}, {firstName}.
            </h1>
            <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
              {subjectCount === 0
                ? "Create your first subject to start organizing your knowledge."
                : `${subjectCount} ${subjectCount === 1 ? "subject" : "subjects"} in your workspace.`}
            </p>
          </div>

          <section>
            <QuickActions />
          </section>

          {recentTopics.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-base font-semibold text-ink dark:text-white">
                Continue Learning
              </h2>
              <div className="space-y-1.5">
                {recentTopics.map((topic) => (
                  <Link
                    key={topic.id}
                    href={`/subjects/${topic.chapter.subject.id}/chapters/${topic.chapter.id}/topics/${topic.id}`}
                    className="card flex items-center justify-between px-4 py-3 transition-shadow hover:shadow-panel"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink dark:text-white">{topic.name}</p>
                      <p className="truncate text-xs text-ink-faint dark:text-white/30">
                        {topic.chapter.subject.name} · {topic.chapter.name}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-faint dark:text-white/30">
                      {formatDistanceToNow(new Date(topic.updatedAt), { addSuffix: true })}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-ink dark:text-white">Recent Subjects</h2>
              {recentSubjects.length > 0 && (
                <Link href="/subjects" className="text-xs font-medium text-ink-muted hover:text-ink dark:text-white/50 dark:hover:text-white">
                  View all
                </Link>
              )}
            </div>
            {recentSubjects.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No subjects yet"
                description="Create your first subject to start organizing chapters, topics, and materials."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {recentSubjects.map((subject) => (
                  <SubjectCard key={subject.id} subject={subject} />
                ))}
              </div>
            )}
          </section>

          {progress.length > 0 && (
            <section>
              <h2 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-ink dark:text-white">
                <TrendingUp className="h-4 w-4 text-ink-faint" />
                Study Progress
              </h2>
              <div className="card space-y-5 p-5">
                {progress.map((p) => (
                  <ProgressRow key={p.id} {...p} />
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink dark:text-white">
                  <FolderOpen className="h-4 w-4 text-ink-faint" />
                  Recent Materials
                </h2>
                {recentMaterials.length > 0 && (
                  <Link href="/materials" className="text-xs font-medium text-ink-muted hover:text-ink dark:text-white/50 dark:hover:text-white">
                    View all
                  </Link>
                )}
              </div>
              {recentMaterials.length === 0 ? (
                <EmptyState
                  icon={FolderOpen}
                  title="No materials yet"
                  description="Upload files or save links to get started."
                  action={<UploadMaterialDialog scope={{}} />}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {recentMaterials.map((material) => (
                    <MaterialCard key={material.id} material={material} />
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold text-ink dark:text-white">
                <Sparkles className="h-4 w-4 text-ink-faint" />
                AI Processing
              </h2>
              <PhasePlaceholder
                icon={Sparkles}
                title="No AI activity yet"
                description="Once you record or upload material, processing status will show up here."
                phase="Phase 4–5"
              />
            </section>
          </div>

          <section>
            <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold text-ink dark:text-white">
              <Users className="h-4 w-4 text-ink-faint" />
              Groups
            </h2>
            <PhasePlaceholder
              icon={Users}
              title="No groups yet"
              description="Collaborative groups for sharing subjects and materials with others."
              phase="Phase 6"
            />
          </section>
        </div>
      </main>
      <CreateSubjectDialog />
      <CreateGroupDialog />
    </>
  );
}
