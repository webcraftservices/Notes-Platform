import { notFound } from "next/navigation";
import { requireUser } from "@/lib/access";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import { InvitationActions } from "@/components/invitations/invitation-actions";

export default async function InvitationPage({ params }: { params: { token: string } }) {
  // Same auth gate as every other page in this app (`requireUser()`
  // redirects to /sign-in). There is no existing return-URL/callbackUrl
  // convention anywhere in this repo to preserve the token through that
  // redirect (sign-in always lands on "/" — see sign-in-form.tsx) — not
  // inventing one here per the Phase 6.3 doc's explicit instruction not
  // to build a second auth system. The honest fallback is stated in the
  // UI below: come back to this same link after signing in.
  const user = await requireUser();

  const invitation = await db.groupInvitation.findUnique({
    where: { token: params.token },
    include: { group: { select: { id: true, name: true, description: true } } },
  });

  // Genuinely-nonexistent token. Unlike Group access (which deliberately
  // returns an indistinguishable 404 for "doesn't exist" vs "exists but
  // you're not a member" to avoid leaking existence), an invitation token
  // is itself the secret — there's no separate membership check to
  // conflate this with, so a plain notFound() is the right shape here.
  if (!invitation) notFound();

  const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { email: true } });
  const sessionEmail = dbUser?.email ?? null;
  const emailMatches = sessionEmail
    ? normalizeEmail(sessionEmail) === normalizeEmail(invitation.email)
    : false;

  const alreadyMember = emailMatches
    ? await db.groupMember.findUnique({
        where: { groupId_userId: { groupId: invitation.groupId, userId: user.id } },
      })
    : null;

  const isExpired = invitation.expiresAt < new Date();

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card p-6">
        <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-paper dark:bg-graphite-800">
          <span className="font-display text-sm font-semibold text-ink dark:text-white">
            {invitation.group.name.slice(0, 1).toUpperCase()}
          </span>
        </div>
        <h1 className="mt-3 font-display text-xl font-semibold text-ink dark:text-white">
          Join {invitation.group.name}
        </h1>
        <p className="mt-1.5 text-sm text-ink-muted dark:text-white/50">
          You&apos;ve been invited as{" "}
          {invitation.role.charAt(0) + invitation.role.slice(1).toLowerCase()}
          {invitation.group.description ? ` — ${invitation.group.description}` : "."}
        </p>

        <div className="mt-6">
          <InvitationActions
            token={params.token}
            status={invitation.status}
            isExpired={isExpired}
            emailMatches={emailMatches}
            alreadyMember={!!alreadyMember}
            invitedEmail={invitation.email}
            sessionEmail={sessionEmail}
            groupId={invitation.groupId}
          />
        </div>
      </div>
    </div>
  );
}
