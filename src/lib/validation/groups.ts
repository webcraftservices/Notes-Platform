import { z } from "zod";
import { normalizeEmail } from "@/lib/email";

// Non-owner roles assignable through the Phase 6.2 role-change and
// invitation endpoints. OWNER is deliberately excluded from both schemas
// at the validation layer (not just in lib/group-role.ts's runtime
// checks) — invalid input is rejected as early as possible, before any
// DB/authorization logic runs, per the existing getSessionUser -> Zod ->
// access.ts -> api-response.ts pipeline order.
const assignableRole = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

// Mirrors createSubjectSchema/updateSubjectSchema in lib/validation/hierarchy.ts:
// same name/description length limits, same "PATCH with an empty object is
// a valid no-op" convention (see updateSubjectSchema's precedent) rather
// than inventing a stricter rule for Group specifically.

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional(),
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

/** PATCH /api/groups/[groupId]/members/[userId] body. */
export const updateMemberRoleSchema = z.object({
  role: assignableRole,
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * POST /api/groups/[groupId]/invitations body. `email` is normalized
 * (trim + lowercase, see lib/email.ts) at parse time so every downstream
 * consumer of `parsed.data.email` — duplicate-invite check,
 * already-a-member check, the stored GroupInvitation row itself — is
 * guaranteed to already be in canonical form without each call site
 * needing to remember to normalize it.
 */
export const createInvitationSchema = z.object({
  email: z.string().trim().email("Enter a valid email").transform(normalizeEmail),
  role: assignableRole,
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
