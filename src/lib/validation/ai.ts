import { z } from "zod";

/**
 * Same shape and precedence convention as materials.ts's scopeFields:
 * the narrowest present field wins (topicId > chapterId > subjectId),
 * none present means workspace-level. Not enforced as mutually exclusive
 * here — same convention as materials.ts, where the route/access-layer
 * cascade (see getAccessibleAIScope) decides precedence rather than the
 * validator rejecting "extra" fields.
 */
const aiScopeFields = {
  subjectId: z.string().cuid().optional(),
  chapterId: z.string().cuid().optional(),
  topicId: z.string().cuid().optional(),
};

export const aiScopeQuerySchema = z.object(aiScopeFields);

export const sendAIMessageSchema = z.object({
  content: z.string().trim().min(1, "Message can't be empty").max(4000, "Message is too long."),
});

export type AIScopeQuery = z.infer<typeof aiScopeQuerySchema>;
export type SendAIMessageInput = z.infer<typeof sendAIMessageSchema>;
