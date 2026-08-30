import { z } from "zod";

export const createSubjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional(),
  icon: z.string().trim().max(60).optional(),
  color: z.string().trim().max(30).optional(),
  // Phase 6.4: creates the Subject inside a Group instead of the caller's
  // personal workspace. Omitted (not present at all) means "personal
  // workspace" — there is no client-supplied "personal" sentinel, so a
  // missing groupId is the only way to request the workspace branch.
  // workspaceId itself is never client-supplied (always resolved
  // server-side), so a caller can never submit both fields.
  groupId: z.string().cuid().optional(),
});

// Scope (workspaceId/groupId) is intentionally NOT updatable here — moving
// an existing Subject between a personal workspace and a Group is not a
// specified Phase 6.4 feature, so update only ever touches presentation
// fields and archive state, never ownership.
export const updateSubjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  icon: z.string().trim().max(60).nullable().optional(),
  color: z.string().trim().max(30).nullable().optional(),
  archived: z.boolean().optional(),
});

export const createChapterSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional(),
});

export const updateChapterSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]).optional(),
  archived: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

export const createTopicSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional(),
});

export const updateTopicSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  archived: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;
export type CreateChapterInput = z.infer<typeof createChapterSchema>;
export type UpdateChapterInput = z.infer<typeof updateChapterSchema>;
export type CreateTopicInput = z.infer<typeof createTopicSchema>;
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;
