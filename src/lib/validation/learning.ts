/**
 * Phase 8.1 — shared Learning domain types + validation.
 *
 * Lives in lib/validation/ alongside the request-body schemas (ai.ts,
 * materials.ts, etc.) even though these validate future AI *output*
 * rather than an API request body — same library, same "every schema
 * gets a test" rule (CLAUDE.md), and no separate validation approach.
 *
 * `LearningSourceRef` is the provenance shape stored in
 * `Flashcard.sources`/`QuizQuestion.sources` (see the schema comments on
 * those fields). It intentionally reuses the shape already established
 * by `AIMessage.sources` ({ materialId, label, timestampSeconds?, page? })
 * rather than inventing a new one, so a future flashcard/quiz "jump to
 * source" UI (spec §23/§69) can share the same click-through logic
 * already built for AI chat citations instead of a second implementation.
 *
 * This module is intentionally just types — no generation logic. Phase
 * 8.2/8.3 will build the actual flashcard/quiz generation using the
 * existing `AIService.chat()` (see lib/services/interfaces.ts) with a
 * structured-JSON prompt, `retrieveRelevantChunks()` (lib/retrieval.ts)
 * for grounding, and the Zod schemas below to validate the model's JSON
 * output before it's ever written to the database — never trusting raw
 * model output directly, consistent with CLAUDE.md's "never fake a
 * feature" rule (an unvalidated/malformed generation should surface a
 * real error, not a corrupted Flashcard/QuizQuestion row).
 */
import { z } from "zod";

export const learningSourceRefSchema = z.object({
  materialId: z.string().cuid(),
  label: z.string().min(1),
  timestampSeconds: z.number().int().nonnegative().optional(),
  page: z.number().int().positive().optional(),
});

export type LearningSourceRef = z.infer<typeof learningSourceRefSchema>;

/**
 * Validated shape for one AI-generated flashcard, ahead of Phase 8.2
 * actually calling AIService to produce these. Not wired into any route
 * yet.
 */
export const flashcardGenerationItemSchema = z.object({
  front: z.string().trim().min(1).max(2000),
  back: z.string().trim().min(1).max(4000),
  sources: z.array(learningSourceRefSchema).max(10).optional(),
});

export type FlashcardGenerationItem = z.infer<typeof flashcardGenerationItemSchema>;

/**
 * Validated shape for one AI-generated quiz question, ahead of Phase 8.3
 * actually calling AIService to produce these. `options`/`correctAnswer`
 * stay plain `Json`-compatible fields (not a discriminated union) so the
 * shape matches `QuizQuestion`'s own single-table-for-all-types design
 * (`options`/`correctAnswer` are both nullable/Json on that model for the
 * same reason — see prisma/schema.prisma) — a discriminated union would
 * infer three incompatible TypeScript shapes for one Prisma column pair.
 * `.superRefine()` instead enforces the semantic relationship between
 * `questionType`, `options`, and `correctAnswer` (Phase 8.1 corrective
 * pass — the original version only checked "MCQ needs 2+ options" and
 * missed the rest of this, which Phase 8.2 needs to be able to trust
 * before persisting generated output):
 *
 * - MCQ: `options` present with >= 2 entries, option `id`s unique,
 *   `correctAnswer` a string that matches one of those `id`s.
 * - TRUE_FALSE: `correctAnswer` a boolean, `options` absent.
 * - SHORT_ANSWER: `correctAnswer` a string, `options` absent.
 *
 * `questionType`'s `z.enum([...])` already excludes `MIXED` — `MIXED` is
 * a quiz-level composition value (`QuizType` on `Quiz`, spec §42), never
 * the type of one individual generated question, so it was never in this
 * enum and still isn't.
 */
export const quizQuestionGenerationItemSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    questionType: z.enum(["MCQ", "TRUE_FALSE", "SHORT_ANSWER"]),
    options: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).optional(),
    correctAnswer: z.union([z.string().min(1), z.boolean()]),
    explanation: z.string().trim().max(2000).optional(),
    sources: z.array(learningSourceRefSchema).max(10).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.questionType === "MCQ") {
      const options = value.options;
      if (!options || options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MCQ questions need at least two options.",
          path: ["options"],
        });
        return; // Nothing further to check against options that don't exist.
      }

      const ids = options.map((option) => option.id);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MCQ option ids must be unique.",
          path: ["options"],
        });
      }

      if (typeof value.correctAnswer !== "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MCQ correctAnswer must be a string referencing an option id.",
          path: ["correctAnswer"],
        });
      } else if (!ids.includes(value.correctAnswer)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MCQ correctAnswer must match one of the provided option ids.",
          path: ["correctAnswer"],
        });
      }
      return;
    }

    // TRUE_FALSE and SHORT_ANSWER never carry options — those question
    // types don't have a persisted option list at all (QuizQuestion.
    // options is only ever populated for MCQ; see prisma/schema.prisma).
    if (value.options !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.questionType} questions must not include options.`,
        path: ["options"],
      });
    }

    if (value.questionType === "TRUE_FALSE" && typeof value.correctAnswer !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "TRUE_FALSE correctAnswer must be a boolean.",
        path: ["correctAnswer"],
      });
    }

    if (value.questionType === "SHORT_ANSWER" && typeof value.correctAnswer !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SHORT_ANSWER correctAnswer must be a string.",
        path: ["correctAnswer"],
      });
    }
  });

export type QuizQuestionGenerationItem = z.infer<typeof quizQuestionGenerationItemSchema>;
