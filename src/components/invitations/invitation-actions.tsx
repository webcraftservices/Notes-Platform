"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function InvitationActions({
  token,
  status,
  isExpired,
  emailMatches,
  alreadyMember,
  invitedEmail,
  sessionEmail,
  groupId,
}: {
  token: string;
  status: string;
  isExpired: boolean;
  emailMatches: boolean;
  alreadyMember: boolean;
  invitedEmail: string;
  sessionEmail: string | null;
  groupId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<"accept" | "decline" | null>(null);

  // Terminal states the invitation can already be in, independent of who's
  // looking at it. Checked before the email-match/already-member cases
  // below since these are true regardless of which account is signed in.
  if (status === "ACCEPTED") {
    return <StatusMessage text="This invitation has already been accepted." />;
  }
  if (status === "DECLINED") {
    return <StatusMessage text="This invitation has already been declined." />;
  }
  if (status === "EXPIRED" || isExpired) {
    return <StatusMessage text="This invitation has expired. Ask an admin of the group to send a new one." />;
  }

  if (!emailMatches) {
    return (
      <div className="space-y-3">
        <p className="rounded-sm bg-signal-danger/10 px-3 py-2.5 text-sm text-signal-danger">
          This invitation was sent to <strong>{invitedEmail}</strong>. You&apos;re signed in as{" "}
          {sessionEmail ?? "a different account"}.
        </p>
        <p className="text-xs text-ink-faint dark:text-white/40">
          Sign out, sign in as {invitedEmail}, then come back to this same link.
        </p>
        <Button variant="secondary" className="w-full" onClick={() => signOut({ callbackUrl: "/sign-in" })}>
          Sign out
        </Button>
      </div>
    );
  }

  if (alreadyMember) {
    return (
      <div className="space-y-3">
        <StatusMessage text="You're already a member of this group." />
        <Button className="w-full" onClick={() => router.push(`/groups/${groupId}`)}>
          Go to group
        </Button>
      </div>
    );
  }

  async function respond(action: "accept" | "decline") {
    setSubmitting(action);
    try {
      const res = await fetch(`/api/invitations/${token}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't complete that.");
        return;
      }
      if (action === "accept") {
        toast.success("Joined the group");
        router.push(`/groups/${groupId}`);
      } else {
        toast.success("Invitation declined");
        router.push("/groups");
      }
      router.refresh();
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="secondary"
        className="flex-1"
        loading={submitting === "decline"}
        disabled={submitting === "accept"}
        onClick={() => respond("decline")}
      >
        Decline
      </Button>
      <Button
        className="flex-1"
        loading={submitting === "accept"}
        disabled={submitting === "decline"}
        onClick={() => respond("accept")}
      >
        Accept
      </Button>
    </div>
  );
}

function StatusMessage({ text }: { text: string }) {
  return <p className="rounded-sm bg-paper px-3 py-2.5 text-sm text-ink-muted dark:bg-graphite-800 dark:text-white/60">{text}</p>;
}
