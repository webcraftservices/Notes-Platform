import type { InvitationStatus } from "@prisma/client";

/**
 * Whether an invitation is still eligible for admin management actions
 * (cancel, resend) — only while it's PENDING. Once it's been ACCEPTED,
 * DECLINED, CANCELLED, or lazily flipped to EXPIRED, it's a terminal
 * state and neither action makes sense anymore (spec: "accepted/declined
 * invitation cannot be resent/cancelled incorrectly").
 *
 * Extracted as a pure function (same pattern as `roleMeetsMinimum` in
 * group-role.ts) so the cancel/resend routes'
 * `src/app/api/groups/[groupId]/invitations/[invitationId]/route.ts` and
 * `.../resend/route.ts` share one place this rule lives, and so it's
 * unit-testable without a database.
 */
export function canManageInvitation(status: InvitationStatus | string): boolean {
  return status === "PENDING";
}
