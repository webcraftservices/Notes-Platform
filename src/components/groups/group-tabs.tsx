"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EditableHeader } from "@/components/shared/editable-header";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { formatRoleLabel } from "@/lib/group-style";
import {
  GroupMembersPanel,
  type GroupMemberData,
  type GroupInvitationData,
} from "@/components/groups/group-members-panel";
import { GroupSubjectsPanel } from "@/components/groups/group-subjects-panel";
import { GroupMaterialsPanel } from "@/components/groups/group-materials-panel";
import { GroupActivityPanel, type GroupActivityEntry } from "@/components/groups/group-activity-panel";
import { AIChatPanel } from "@/components/ai/ai-chat-panel";
import type { SubjectCardData } from "@/components/subjects/subject-card";
import type { MemberRole, Material } from "@prisma/client";

export function GroupTabs({
  groupId,
  name,
  description,
  role,
  currentUserId,
  members,
  invitations,
  canManage,
  subjects,
  materials,
  activity,
  activityNextCursor,
}: {
  groupId: string;
  name: string;
  description: string | null;
  role: MemberRole;
  currentUserId: string;
  members: GroupMemberData[];
  invitations: GroupInvitationData[];
  canManage: boolean;
  subjects: SubjectCardData[];
  materials: Material[];
  activity: GroupActivityEntry[];
  activityNextCursor: string | null;
}) {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="members">Members</TabsTrigger>
        <TabsTrigger value="subjects">Subjects</TabsTrigger>
        <TabsTrigger value="materials">Materials</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="ai-assistant">AI Assistant</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <div className="space-y-5">
          {canManage ? (
            <EditableHeader
              endpoint={`/api/groups/${groupId}`}
              name={name}
              description={description}
              titleClassName="font-display text-xl font-semibold text-ink dark:text-white"
            />
          ) : (
            <div>
              <h1 className="font-display text-xl font-semibold text-ink dark:text-white">{name}</h1>
              <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
                {description || "No description yet."}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={role === "OWNER" ? "accent" : "default"} className="normal-case tracking-normal">
              You&apos;re {formatRoleLabel(role)}
            </Badge>
            <span className="text-sm text-ink-muted dark:text-white/50">
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          </div>

          <div className="flex -space-x-2">
            {members.slice(0, 8).map((member) => (
              <Avatar
                key={member.userId}
                name={member.name}
                email={member.email}
                image={member.image}
                size={30}
                className="ring-2 ring-paper dark:ring-graphite-950"
              />
            ))}
            {members.length > 8 && (
              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-paper text-[11px] font-medium text-ink-muted ring-2 ring-paper dark:bg-graphite-800 dark:text-white/50 dark:ring-graphite-950">
                +{members.length - 8}
              </div>
            )}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="members">
        <GroupMembersPanel
          groupId={groupId}
          myRole={role}
          currentUserId={currentUserId}
          members={members}
          invitations={invitations}
          canManage={canManage}
        />
      </TabsContent>

      <TabsContent value="subjects">
        <GroupSubjectsPanel groupId={groupId} subjects={subjects} canManage={canManage} />
      </TabsContent>

      <TabsContent value="materials">
        <GroupMaterialsPanel materials={materials} />
      </TabsContent>

      <TabsContent value="activity">
        <GroupActivityPanel
          groupId={groupId}
          initialActivity={activity}
          initialNextCursor={activityNextCursor}
        />
      </TabsContent>

      <TabsContent value="ai-assistant">
        <AIChatPanel
          scope={{ groupId }}
          emptyStateHint="Questions are answered using everything this group has shared, with clickable sources."
        />
      </TabsContent>
    </Tabs>
  );
}
