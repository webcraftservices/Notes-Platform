import { Users } from "lucide-react";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { GroupCard } from "@/components/groups/group-card";
import { CreateGroupDialog } from "@/components/groups/create-group-dialog";
import { NewGroupButton } from "@/components/groups/new-group-button";

export default async function GroupsPage() {
  const user = await requireUser();

  const memberships = await db.groupMember.findMany({
    where: { userId: user.id, group: { deletedAt: null } },
    include: { group: { include: { _count: { select: { members: true } } } } },
    orderBy: { joinedAt: "desc" },
  });

  const groups = memberships.map((membership) => ({
    id: membership.group.id,
    name: membership.group.name,
    description: membership.group.description,
    role: membership.role,
    memberCount: membership.group._count.members,
  }));

  return (
    <>
      <Topbar actions={groups.length > 0 ? <NewGroupButton /> : null}>
        <Breadcrumbs trail={[{ label: "Groups" }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Groups</h1>
              <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
                Collaborate on subjects, materials, and AI answers with people you invite.
              </p>
            </div>
          </div>

          {groups.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No groups yet"
              description="Create one to start collaborating."
              action={<NewGroupButton />}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((group) => (
                <GroupCard key={group.id} group={group} />
              ))}
            </div>
          )}
        </div>
      </main>
      <CreateGroupDialog />
    </>
  );
}
