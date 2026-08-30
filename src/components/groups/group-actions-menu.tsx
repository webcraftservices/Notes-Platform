"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Trash2, LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { MemberRole } from "@prisma/client";

/**
 * OWNER can only delete the group (spec §8/§34 — no ownership-transfer
 * feature exists, so OWNER can never "leave"). Everyone else can only
 * leave. Both are mutually exclusive by construction here rather than
 * both being offered and relying on the server to reject the wrong one —
 * the server (`DELETE /api/groups/[groupId]` requires OWNER;
 * `DELETE /api/groups/[groupId]/members/[userId]` rejects OWNER leaving
 * via `canRemoveMember`) remains the actual authority either way.
 */
export function GroupActionsMenu({
  groupId,
  groupName,
  role,
  currentUserId,
}: {
  groupId: string;
  groupName: string;
  role: MemberRole;
  currentUserId: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isOwner = role === "OWNER";

  async function handleDeleteGroup() {
    const res = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? "Couldn't delete the group.");
      return;
    }
    toast.success("Group deleted");
    router.push("/groups");
    router.refresh();
  }

  async function handleLeaveGroup() {
    const res = await fetch(`/api/groups/${groupId}/members/${currentUserId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? "Couldn't leave the group.");
      return;
    }
    toast.success(`You left ${groupName}`);
    router.push("/groups");
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-paper hover:text-ink dark:text-white/50 dark:hover:bg-graphite-800 dark:hover:text-white">
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {isOwner ? (
            <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Delete group
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
              <LogOut className="h-4 w-4" />
              Leave group
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {isOwner ? (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Delete "${groupName}"?`}
          description="This removes the group for every member. You can't undo this from here."
          confirmLabel="Delete group"
          destructive
          onConfirm={handleDeleteGroup}
        />
      ) : (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Leave "${groupName}"?`}
          description="You'll lose access to this group's shared content until someone invites you back."
          confirmLabel="Leave group"
          destructive
          onConfirm={handleLeaveGroup}
        />
      )}
    </>
  );
}
