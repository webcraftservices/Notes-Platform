import { randomBytes } from "crypto";

/**
 * Group invitations live for 7 days (spec doesn't mandate a specific
 * duration; this mirrors common invite-link conventions and keeps stale
 * invitations from lingering indefinitely). Centralized here so
 * `POST /api/groups/[groupId]/invitations` and any future
 * resend/reinvite logic can't drift apart on the TTL.
 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generates a cryptographically secure, unpredictable invitation token.
 *
 * Deliberately NOT derived from the group ID, inviter ID, or invitee
 * email — a token must not be guessable or computable from any of the
 * data it grants access to. 32 random bytes (256 bits) hex-encoded, using
 * Node's `crypto.randomBytes` (CSPRNG), matching the security bar the
 * Phase 6.2 spec requires and consistent with `crypto.randomUUID()`
 * already used elsewhere in this codebase (`lib/ingestion.ts`) for
 * cryptographically-backed IDs.
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("hex");
}

/** The Date an invitation created "now" should expire at. */
export function invitationExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITATION_TTL_MS);
}
