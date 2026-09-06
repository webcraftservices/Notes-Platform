import { z } from "zod";

const scopeFields = {
  subjectId: z.string().cuid().optional(),
  chapterId: z.string().cuid().optional(),
  topicId: z.string().cuid().optional(),
};

export const listGoogleFilesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  pageToken: z.string().trim().max(500).optional(),
});

export const importGoogleFileSchema = z.object({
  fileId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().min(1).max(200),
  webViewLink: z.string().trim().url().optional(),
  modifiedTime: z.string().trim().optional(),
  // Re-send with force=true to overwrite a previously-imported Material for
  // the same Drive file rather than creating a duplicate (spec §17-18).
  force: z.boolean().optional(),
  ...scopeFields,
});

export type ListGoogleFilesQuery = z.infer<typeof listGoogleFilesQuerySchema>;
export type ImportGoogleFileInput = z.infer<typeof importGoogleFileSchema>;
