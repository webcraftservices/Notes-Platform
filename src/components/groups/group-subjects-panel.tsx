import { FolderOpen } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SubjectCard, type SubjectCardData } from "@/components/subjects/subject-card";
import { CreateGroupSubjectDialog } from "@/components/groups/create-group-subject-dialog";

/**
 * Phase 6.4. Data is fetched server-side in
 * app/(app)/groups/[groupId]/page.tsx (already scoped to `groupId` there,
 * inside a page that already proved membership via requireGroup) and
 * passed down as plain props — same pattern GroupMembersPanel already
 * uses, no second client-side fetch/access layer introduced here.
 */
export function GroupSubjectsPanel({
  groupId,
  subjects,
  canManage,
}: {
  groupId: string;
  subjects: SubjectCardData[];
  canManage: boolean;
}) {
  if (subjects.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No subjects yet"
        description={
          canManage
            ? "Create a subject to start organizing this group's chapters, topics, and materials."
            : "An admin hasn't created any subjects for this group yet."
        }
        action={canManage ? <CreateGroupSubjectDialog groupId={groupId} /> : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <CreateGroupSubjectDialog groupId={groupId} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {subjects.map((subject) => (
          <SubjectCard key={subject.id} subject={subject} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}
