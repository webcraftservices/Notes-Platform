import Link from "next/link";
import { getSubjectIcon, getSubjectColor } from "@/lib/subject-style";
import { SubjectActionsMenu } from "@/components/subjects/subject-actions-menu";

export interface SubjectCardData {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  archivedAt: Date | null;
  _count: { chapters: number; materials: number };
}

export function SubjectCard({
  subject,
  canManage = true,
}: {
  subject: SubjectCardData;
  // Phase 6.4: group Subjects hide rename/archive/delete for MEMBER/VIEWER
  // (server-enforced in PATCH/DELETE /api/subjects/[subjectId] via
  // assertSubjectManageAccess — this prop only controls whether the
  // affordance is shown, never the authorization itself). Defaults to
  // true so every existing personal/workspace call site is unaffected.
  canManage?: boolean;
}) {
  const Icon = getSubjectIcon(subject.icon);
  const palette = getSubjectColor(subject.color);

  return (
    <div className="card group relative p-5 transition-shadow hover:shadow-panel">
      {canManage && (
        <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
          <SubjectActionsMenu subject={subject} />
        </div>
      )}
      <Link href={`/subjects/${subject.id}`} className="block">
        <div className={`flex h-9 w-9 items-center justify-center rounded ${palette.bg}`}>
          <Icon className={`h-[18px] w-[18px] ${palette.text}`} strokeWidth={1.75} />
        </div>
        <h3 className="mt-3 truncate font-display text-[15px] font-semibold text-ink dark:text-white">
          {subject.name}
        </h3>
        {subject.description && (
          <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted dark:text-white/50">
            {subject.description}
          </p>
        )}
        <p className="mt-3 text-xs text-ink-faint dark:text-white/30">
          {subject._count.chapters} {subject._count.chapters === 1 ? "chapter" : "chapters"}
        </p>
      </Link>
    </div>
  );
}
