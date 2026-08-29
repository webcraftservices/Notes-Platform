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
