/**
 * Group role hierarchy (Phase 6.1, master prompt §34): OWNER > ADMIN >
 * MEMBER > VIEWER. Reuses the existing `MemberRole` enum already shared
 * with `WorkspaceMember` (see prisma/schema.prisma) rather than
 * introducing a separate Group-specific role type.
 *
 * This file intentionally imports only the `MemberRole` *type* (erased at
 * compile time, never touched at runtime) and nothing from `lib/db` or
 * `lib/access`, so it stays unit-testable in isolation — the same
 * pure/orchestration split already used by `lib/ai-chat.ts` (pure
 * formatting helpers) vs. `lib/retrieval.ts` (the DB-touching caller).
 *
 * `lib/access.ts`'s `requireGroupRole` calls `roleMeetsMinimum` rather
 * than duplicating this ranking inline, so the hierarchy only exists once.
 */

import type { MemberRole } from "@prisma/client";

const GROUP_ROLE_RANK: Record<MemberRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/** True if `role` meets or exceeds `minimum` in the OWNER > ADMIN > MEMBER > VIEWER hierarchy. */
export function roleMeetsMinimum(role: MemberRole, minimum: MemberRole): boolean {
  return GROUP_ROLE_RANK[role] >= GROUP_ROLE_RANK[minimum];
}

/**
 * Phase 6.2 permission matrix (master prompt §34 / Phase 6.2 doc §3), as a
 * pure function so it can be unit-tested exhaustively without a database —
 * same pattern as `roleMeetsMinimum` above. Route handlers
 * (`members/[userId]/route.ts`) call this instead of re-deriving the rules
 * inline, so the matrix only exists once.
 *
 * Rules:
 *  - OWNER can never be the target of a role change (can't be demoted).
 *  - OWNER can never be assigned via role change (no second OWNER, and no
 *    "promote to OWNER" path — the only way to become OWNER is creating
 *    the group; there is no ownership-transfer feature yet).
 *  - Only OWNER/ADMIN may change roles at all.
 *
 * Decision (not previously established in this repo): ADMIN may change
 * another ADMIN's role (e.g. demote a fellow ADMIN to MEMBER) — the
 * Phase 6.2 doc leaves "ADMIN modifying another ADMIN" conditional on
 * "the repository's established policy," and no such policy exists yet
 * (Phase 6.1 shipped no role-change endpoint). The matrix explicitly
 * protects OWNER only, so this is treated as the simplest rule consistent
 * with the given table rather than an invented extra restriction.
 */
export function canChangeMemberRole(
  actorRole: MemberRole,
  targetCurrentRole: MemberRole,
  newRole: MemberRole
): boolean {
  if (!roleMeetsMinimum(actorRole, "ADMIN")) return false;
  if (targetCurrentRole === "OWNER") return false;
  if (newRole === "OWNER") return false;
  return true;
}

/**
 * Phase 6.2 permission matrix for removal/leaving. A single rule covers
 * both cases the spec lists separately ("OWNER cannot be removed" and
 * "OWNER cannot leave") because `targetRole === "OWNER"` is checked
 * before the self/other branch — whether OWNER is trying to remove
 * themselves (`isSelf: true`) or an ADMIN is trying to remove them
 * (`isSelf: false`), the target is OWNER either way, so both are
 * rejected by the same line rather than two separate special cases that
 * could drift out of sync.
 *
 * - Removing someone else requires the actor to be OWNER or ADMIN.
 * - Leaving (isSelf) is allowed for ADMIN/MEMBER/VIEWER, never OWNER.
 */
export function canRemoveMember(
  actorRole: MemberRole,
  targetRole: MemberRole,
  isSelf: boolean
): boolean {
  if (targetRole === "OWNER") return false;
  if (isSelf) return true;
  return roleMeetsMinimum(actorRole, "ADMIN");
}
