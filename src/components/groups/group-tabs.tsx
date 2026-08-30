"use client";

import { FolderOpen, FileText, Activity, Sparkles } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PhasePlaceholder } from "@/components/shared/phase-placeholder";
import { EditableHeader } from "@/components/shared/editable-header";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { formatRoleLabel } from "@/lib/group-style";
import {
  GroupMembersPanel,
  type GroupMemberData,
  type GroupInvitationData,
} from "@/components/groups/group-members-panel";
import type { MemberRole } from "@prisma/client";

export function GroupTabs({
  groupId,
  name,
  description,
  role,
  currentUserId,
  members,
  invitations,
  canManage,
}: {
  groupId: string;
  name: string;
  description: string | null;
  role: MemberRole;
  currentUserId: string;
  members: GroupMemberData[];
  invitations: GroupInvitationData[];
  canManage: boolean;
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
        <PhasePlaceholder
          icon={FolderOpen}
          title="Group Subjects arrive in Phase 6.4"
          description="Subjects, chapters, and topics shared with the whole group will live here."
          phase="Phase 6.4 · Group content"
        />
      </TabsContent>

      <TabsContent value="materials">
        <PhasePlaceholder
          icon={FileText}
          title="Group Materials arrive in Phase 6.4"
          description="Recordings, documents, and other materials shared with the group will live here."
          phase="Phase 6.4 · Group content"
        />
      </TabsContent>

      <TabsContent value="activity">
        <PhasePlaceholder
          icon={Activity}
          title="Activity arrives in Phase 6.6"
          description="A feed of who uploaded, edited, or invited what will live here."
          phase="Phase 6.6 · Activity & notifications"
        />
      </TabsContent>

      <TabsContent value="ai-assistant">
        <PhasePlaceholder
          icon={Sparkles}
          title="Group AI arrives in Phase 6.5"
          description="Ask questions across everything the group has shared, with sources."
          phase="Phase 6.5 · Group AI"
        />
      </TabsContent>
    </Tabs>
  );
}
