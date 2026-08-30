import { requireUser, requireGroup, getGroupRole } from "@/lib/access";
import { db } from "@/lib/db";
import { roleMeetsMinimum } from "@/lib/group-role";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { GroupActionsMenu } from "@/components/groups/group-actions-menu";
import { GroupTabs } from "@/components/groups/group-tabs";

export default async function GroupDetailPage({ params }: { params: { groupId: string } }) {
  const user = await requireUser();
  // requireGroup() calls Next's notFound() for both "doesn't exist" and
  // "exists but I'm not a member" — same deliberately-indistinguishable
  // 404 the rest of the app already uses for Subjects/Chapters/Topics, so
  // a non-member can't tell a real group apart from a nonexistent one.
  const group = await requireGroup(params.groupId, user.id);
  // Guaranteed non-null: requireGroup() already 404'd if the caller
  // weren't a member, so this membership row necessarily exists.
  const role = (await getGroupRole(group.id, user.id))!;
  const canManage = roleMeetsMinimum(role, "ADMIN");

  const members = await db.groupMember.findMany({
    where: { groupId: group.id },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });

  // Pending invitations are only fetched (and only ever shown) for
  // ADMIN/OWNER — same server-side gate `GET
  // /api/groups/[groupId]/invitations` enforces, so a MEMBER/VIEWER never
  // even receives this data in the page payload, not just has it hidden
  // client-side.
  const invitations = canManage
    ? await db.groupInvitation.findMany({
        where: { groupId: group.id, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // Phase 6.4: Group Subjects/Materials tabs. Both are already fully
  // scoped by `group.id` (which requireGroup above already proved the
  // caller is a member of), so no further per-row access check is needed
  // here — this mirrors how `members`/`invitations` above are fetched
  // directly rather than through a second access layer.
  const [subjects, materials] = await Promise.all([
    db.subject.findMany({
      where: { groupId: group.id, deletedAt: null, archivedAt: null },
      include: { _count: { select: { chapters: true, materials: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    db.material.findMany({
      where: { groupId: group.id, deletedAt: null, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <>
      <Topbar
        actions={
          <GroupActionsMenu
            groupId={group.id}
            groupName={group.name}
            role={role}
            currentUserId={user.id}
          />
        }
      >
        <Breadcrumbs trail={[{ label: "Groups", href: "/groups" }, { label: group.name }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <GroupTabs
            groupId={group.id}
            name={group.name}
            description={group.description}
            role={role}
            currentUserId={user.id}
            members={members.map((m) => ({
              userId: m.user.id,
              name: m.user.name,
              email: m.user.email,
              image: m.user.image,
              role: m.role,
              joinedAt: m.joinedAt.toISOString(),
            }))}
            invitations={invitations.map((inv) => ({
              id: inv.id,
              email: inv.email,
              role: inv.role,
              createdAt: inv.createdAt.toISOString(),
              expiresAt: inv.expiresAt.toISOString(),
              status: inv.status,
            }))}
            canManage={canManage}
            subjects={subjects}
            materials={materials}
          />
        </div>
      </main>
    </>
  );
}
