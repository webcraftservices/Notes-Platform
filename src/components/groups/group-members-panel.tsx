"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, Mail, Clock, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Avatar } from "@/components/ui/avatar";
import { InviteMemberDialog } from "@/components/groups/invite-member-dialog";
import { canChangeMemberRole, canRemoveMember } from "@/lib/group-role";
import { formatRoleLabel } from "@/lib/group-style";
import type { MemberRole } from "@prisma/client";

const ASSIGNABLE_ROLES: MemberRole[] = ["ADMIN", "MEMBER", "VIEWER"];

export interface GroupMemberData {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: MemberRole;
  joinedAt: string;
}

export interface GroupInvitationData {
  id: string;
  email: string;
  role: MemberRole;
  createdAt: string;
  expiresAt: string;
  status: string;
}

export function GroupMembersPanel({
  groupId,
  myRole,
  currentUserId,
  members,
  invitations,
  canManage,
}: {
  groupId: string;
  myRole: MemberRole;
  currentUserId: string;
  members: GroupMemberData[];
  invitations: GroupInvitationData[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; label: string; isSelf: boolean } | null>(
    null
  );
  const [cancelTarget, setCancelTarget] = useState<{ id: string; email: string } | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  async function changeRole(userId: string, role: MemberRole) {
    const res = await fetch(`/api/groups/${groupId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? "Couldn't change that member's role.");
      return;
    }
    toast.success("Role updated");
    router.refresh();
  }

  async function handleRemoveConfirmed() {
    if (!removeTarget) return;
    const res = await fetch(`/api/groups/${groupId}/members/${removeTarget.userId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? "Couldn't complete that.");
      return;
    }
    toast.success(removeTarget.isSelf ? "You left the group" : "Member removed");
    if (removeTarget.isSelf) {
      router.push("/groups");
    }
    router.refresh();
  }

  async function handleCancelInvitationConfirmed() {
    if (!cancelTarget) return;
    const res = await fetch(`/api/groups/${groupId}/invitations/${cancelTarget.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? "Couldn't cancel that invitation.");
      return;
    }
    toast.success("Invitation cancelled");
    router.refresh();
  }

  async function handleResendInvitation(invitationId: string) {
    if (resendingId) return; // guard against double-click while one is in flight
    setResendingId(invitationId);
    try {
      const res = await fetch(`/api/groups/${groupId}/invitations/${invitationId}/resend`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't resend that invitation.");
        return;
      }
      const body = await res.json();
      toast.success(body.delivered ? "Invitation resent" : "Invitation refreshed — they'll see it once they sign up");
      router.refresh();
    } finally {
      setResendingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-[15px] font-semibold text-ink dark:text-white">
            {members.length} {members.length === 1 ? "member" : "members"}
          </h3>
          {canManage && (
            <Button variant="secondary" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Invite member
            </Button>
          )}
        </div>

        <div className="divide-y divide-line rounded-lg border border-line dark:divide-line-dark dark:border-line-dark">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const removable = canRemoveMember(myRole, member.role, isSelf);
            const assignableTargets = ASSIGNABLE_ROLES.filter(
              (candidate) =>
                candidate !== member.role && canChangeMemberRole(myRole, member.role, candidate)
            );

            return (
              <div
                key={member.userId}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={member.name} email={member.email} image={member.image} size={32} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink dark:text-white">
                      {member.name ?? member.email}
                      {isSelf && (
                        <Badge variant="muted" className="normal-case tracking-normal">
                          You
                        </Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-ink-faint dark:text-white/40">{member.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:shrink-0">
                  {assignableTargets.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger className="flex items-center gap-1 rounded-sm border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-ink-faint hover:text-ink dark:border-line-dark dark:text-white/50 dark:hover:text-white">
                        {formatRoleLabel(member.role)}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {assignableTargets.map((candidate) => (
                          <DropdownMenuItem
                            key={candidate}
                            onSelect={() => changeRole(member.userId, candidate)}
                          >
                            Make {formatRoleLabel(candidate)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Badge className="normal-case tracking-normal">{formatRoleLabel(member.role)}</Badge>
                  )}

                  {removable && (
                    <Button
                      variant="ghost"
                      className="text-signal-danger hover:text-signal-danger"
                      onClick={() =>
                        setRemoveTarget({
                          userId: member.userId,
                          label: member.name ?? member.email,
                          isSelf,
                        })
                      }
                    >
                      {isSelf ? "Leave" : "Remove"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {canManage && (
        <div>
          <h3 className="mb-3 font-display text-[15px] font-semibold text-ink dark:text-white">
            Pending invitations
          </h3>
          {invitations.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No pending invitations"
              description="Invite someone by email to get them started."
            />
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line dark:divide-line-dark dark:border-line-dark">
              {invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink dark:text-white">
                      {invitation.email}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-faint dark:text-white/40">
                      <Clock className="h-3 w-3" />
                      Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:shrink-0">
                    <Badge className="w-fit normal-case tracking-normal">
                      {formatRoleLabel(invitation.role)}
                    </Badge>
                    <Button
                      variant="ghost"
                      disabled={resendingId === invitation.id}
                      onClick={() => handleResendInvitation(invitation.id)}
                    >
                      <RotateCw className={`h-3.5 w-3.5 ${resendingId === invitation.id ? "animate-spin" : ""}`} />
                      Resend
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-signal-danger hover:text-signal-danger"
                      onClick={() => setCancelTarget({ id: invitation.id, email: invitation.email })}
                    >
                      Cancel invitation
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {canManage && <InviteMemberDialog groupId={groupId} open={inviteOpen} onOpenChange={setInviteOpen} />}

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
        title={removeTarget?.isSelf ? "Leave this group?" : `Remove ${removeTarget?.label}?`}
        description={
          removeTarget?.isSelf
            ? "You'll lose access to this group's shared content until someone invites you back."
            : "They'll lose access to this group's shared content immediately."
        }
        confirmLabel={removeTarget?.isSelf ? "Leave group" : "Remove member"}
        destructive
        onConfirm={handleRemoveConfirmed}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(v) => !v && setCancelTarget(null)}
        title={`Cancel invitation to ${cancelTarget?.email}?`}
        description="They'll no longer be able to join using this invitation. You can invite them again at any time."
        confirmLabel="Cancel invitation"
        destructive
        onConfirm={handleCancelInvitationConfirmed}
      />
    </div>
  );
}
