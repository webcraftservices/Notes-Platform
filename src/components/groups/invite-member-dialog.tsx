"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRoleLabel } from "@/lib/group-style";

const INVITABLE_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;

export function InviteMemberDialog({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof INVITABLE_ROLES)[number]>("MEMBER");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail("");
    setRole("MEMBER");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (!res.ok) {
        // Surface the server's actual message (already-a-member, duplicate
        // pending invite, invalid email, unauthorized) rather than a
        // generic failure — Phase 6.2's routes return a specific `error`
        // string for exactly this reason.
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't create the invitation.");
        return;
      }
      // Deliberately "Invitation created," not "Email sent" — Phase 6.2
      // has no email provider configured; delivery is in-app only (a
      // Notification, if the address belongs to an existing user).
      toast.success("Invitation created");
      reset();
      onOpenChange(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Invite a member"
        description="They'll see this in their notifications if they already have an account. No email is sent."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              autoFocus
              required
            />
          </div>
          <div>
            <Label>Role</Label>
            <div className="flex gap-1.5">
              {INVITABLE_ROLES.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex-1 rounded-sm border px-3 py-2 text-sm font-medium transition-colors",
                    role === r
                      ? "border-accent bg-accent-soft text-accent-strong"
                      : "border-line text-ink-muted hover:border-ink-faint dark:border-line-dark dark:text-white/50"
                  )}
                >
                  {formatRoleLabel(r)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!email.trim()}>
              Create invitation
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
