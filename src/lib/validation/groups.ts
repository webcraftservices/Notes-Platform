import { z } from "zod";

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
