import { z } from "zod";

const scopeFields = {
  subjectId: z.string().cuid().optional(),
  chapterId: z.string().cuid().optional(),
  topicId: z.string().cuid().optional(),
};

export const requestUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  ...scopeFields,
});

export const createLinkMaterialSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().url("Enter a valid URL"),
  ...scopeFields,
});

export const updateMaterialSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  archived: z.boolean().optional(),
  // Move to a new scope. Passing null for a field clears that level —
  // e.g. { subjectId: null } detaches from everything (moves to
  // Unorganized). Passing a value sets that level and the API derives
  // consistency (a topicId implies its chapter/subject).
  subjectId: z.string().cuid().nullable().optional(),
  chapterId: z.string().cuid().nullable().optional(),
  topicId: z.string().cuid().nullable().optional(),
});

export const listMaterialsQuerySchema = z.object({
  scope: z.enum(["all", "unorganized", "archived"]).optional(),
  subjectId: z.string().cuid().optional(),
  chapterId: z.string().cuid().optional(),
  topicId: z.string().cuid().optional(),
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(40).optional(),
});

export type RequestUploadInput = z.infer<typeof requestUploadSchema>;
export type CreateLinkMaterialInput = z.infer<typeof createLinkMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
