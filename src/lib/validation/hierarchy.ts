import { z } from "zod";

export const createSubjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional(),
  icon: z.string().trim().max(60).optional(),
  color: z.string().trim().max(30).optional(),
});

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
