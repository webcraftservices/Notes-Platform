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
  // Phase 6.5: bare group scope — "ask across everything this group has
  // shared." Same narrowest-wins precedence as the other fields (see
  // getAccessibleAIScope): ignored if subjectId/chapterId/topicId is set.
  groupId: z.string().cuid().optional(),
};

export const aiScopeQuerySchema = z.object(aiScopeFields);

/**
 * Phase 8.4 — selects which AIConversation.kind to get-or-create/create.
 * Defaults to "CHAT" so every pre-8.4 caller (and every existing test)
 * that never sends `kind` keeps behaving exactly as before.
 *
 * TUTOR additionally requires `topicId` (task: "do not allow creating an
 * arbitrary Tutor conversation detached from an authorized Topic" — Tutor
 * is Topic-only, matching where flashcards/quizzes already live). This is
 * enforced with `.superRefine` rather than a second schema so a single
 * `aiConversationScopeSchema.safeParse(...)` call at each route gives a
 * single, consistent 400 for both "bad kind" and "TUTOR without topicId."
 */
export const aiConversationKindSchema = z.enum(["CHAT", "TUTOR"]).default("CHAT");

export const aiConversationScopeSchema = aiScopeQuerySchema
  .extend({ kind: aiConversationKindSchema })
  .superRefine((data, ctx) => {
    if (data.kind === "TUTOR" && !data.topicId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A Tutor conversation must be created for a specific Topic.",
        path: ["topicId"],
      });
    }
  });

export const sendAIMessageSchema = z.object({
  content: z.string().trim().min(1, "Message can't be empty").max(4000, "Message is too long."),
});

export type AIScopeQuery = z.infer<typeof aiScopeQuerySchema>;
export type AIConversationScopeQuery = z.infer<typeof aiConversationScopeSchema>;
export type SendAIMessageInput = z.infer<typeof sendAIMessageSchema>;
