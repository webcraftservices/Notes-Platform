import { db } from "@/lib/db";
import { getAccessibleAIScope, type ResolvedAIScope } from "@/lib/access";
import { retrieveRelevantChunks } from "@/lib/retrieval";
import { buildContextBlock, chunksToSources } from "@/lib/ai-chat";
import { getAIService } from "@/lib/services/ai";
import { recordAIUsage } from "@/lib/ai-usage";
import { quizQuestionGenerationItemSchema, type LearningSourceRef } from "@/lib/validation/learning";
import type { Prisma, QuizType } from "@prisma/client";
import { z } from "zod";

/**
 * Phase 8.3 — same "generate from MY KNOWLEDGE" principle as
 * flashcard-generation.ts's InsufficientSourceMaterialError. Kept as a
 * distinct class (not a shared import) because it's a quiz-specific,
 * user-facing message — mirroring the pattern, not sharing the instance,
 * matches how the two features are validated/tested independently.
 */
export class InsufficientSourceMaterialError extends Error {
  constructor() {
    super(
      "This topic doesn't have enough indexed material yet to generate a quiz. " +
        "Add some materials, transcribe a recording, or write some notes first, then try again."
    );
    this.name = "InsufficientSourceMaterialError";
  }
}

/** Quiz analog of FlashcardGenerationOutputError — see that class's doc comment. */
export class QuizGenerationOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuizGenerationOutputError";
  }
}

// Same rationale as flashcard-generation.ts's RETRIEVAL_LIMIT — broader
// than a single chat turn's default of 8, since generation benefits from
// wide coverage of the Topic rather than narrow relevance to one query.
const RETRIEVAL_LIMIT = 20;

// Unlike flashcardGenerationItemSchema, quizQuestionGenerationItemSchema
// already makes `sources` optional on the SAME schema used for the final
// persisted shape (no separate .pick() schema is possible here anyway —
// it's a ZodEffects from .superRefine(), which doesn't expose .pick()).
// So the raw AI array is validated against the exact same schema as the
// final one; the only thing that changes between the two passes is that
// `sources` goes from absent to real, actual retrieved provenance.
const rawGeneratedArraySchema = z.array(quizQuestionGenerationItemSchema).min(1).max(15);

function buildQuizGenerationPrompt(topicName: string, topicDescription: string | null): string {
  return `Generate a study quiz for the topic "${topicName}"${
    topicDescription ? ` (${topicDescription})` : ""
  }, using ONLY the retrieved course material context supplied above as your source of truth.

Rules:
- Base every question strictly on the supplied context. Never invent a fact, definition, formula, or example that isn't actually present in it, and never rely on outside/general knowledge.
- If the context only supports a few good questions, return fewer questions — never pad the set with generic or unsupported content to reach a target count.
- Use a mix of question types where the context supports it: "MCQ" (multiple choice), "TRUE_FALSE", and "SHORT_ANSWER". Don't force a type the context doesn't suit.
- Do not create duplicate or near-duplicate questions.
- Preserve the exact terminology used in the source material rather than paraphrasing key terms away.
- Write clear, unambiguous questions, and keep explanations grounded in the source material — never introduce a new fact in the explanation that wasn't in the question or context.
- Aim for 5-15 questions when the context supports that many, but never fabricate content just to hit that range.
- Do NOT include a "sources" field in your response — the application attaches real provenance itself.

Respond with ONLY a raw JSON array — no markdown code fences, no commentary before or after it — where every item has exactly this shape:
{
  "prompt": string,
  "questionType": "MCQ" | "TRUE_FALSE" | "SHORT_ANSWER",
  "options": [{ "id": string, "text": string }] (REQUIRED for MCQ, at least 2, unique ids; OMIT entirely for TRUE_FALSE/SHORT_ANSWER),
  "correctAnswer": string (an option id, for MCQ) | boolean (for TRUE_FALSE) | string (the answer, for SHORT_ANSWER),
  "explanation": string (optional, grounded in the context)
}`;
}

/** Defensive unwrap in case the model wraps its JSON in a markdown code fence despite being told not to — same approach as flashcard-generation.ts. */
function extractJsonArrayText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

/** Quiz-level QuizType from the generated question composition (task §8) — never invents a new enum value, never forces MIXED unless the batch actually mixes types. */
function inferQuizType(questionTypes: string[]): QuizType {
  const distinct = new Set(questionTypes);
  if (distinct.size === 1) return [...distinct][0] as QuizType;
  return "MIXED";
}

export interface GenerateQuizForTopicInput {
  userId: string;
  topicId: string;
}

/**
 * The Phase 8.3 pipeline — deliberately mirrors
 * generateFlashcardsForTopic()'s shape and scope-resolution reasoning
 * (see that function's doc comment for why `getAccessibleAIScope` alone,
 * not also `resolveLearningScope`, is sufficient here) applied to Quiz/
 * QuizQuestion instead of FlashcardDeck/Flashcard. Throws rather than
 * ever persisting a partial/empty quiz.
 */
export async function generateQuizForTopic(input: GenerateQuizForTopicInput) {
  const { userId, topicId } = input;

  const scope: ResolvedAIScope = await getAccessibleAIScope({ topicId }, userId);

  const topic = await db.topic.findUnique({ where: { id: topicId } });
  if (!topic) throw new InsufficientSourceMaterialError(); // Defensive only — the route already confirmed the topic exists.

  const query = [topic.name, topic.description].filter(Boolean).join(". ");
  const chunks = await retrieveRelevantChunks(query, scope, userId, RETRIEVAL_LIMIT);
  if (chunks.length === 0) throw new InsufficientSourceMaterialError();

  const context = buildContextBlock(chunks) ?? undefined;
  const ai = getAIService();
  const result = await ai.chat({
    messages: [
      { role: "system", content: buildQuizGenerationPrompt(topic.name, topic.description) },
      { role: "user", content: "Generate the quiz now, following every rule above exactly." },
    ],
    context,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonArrayText(result.content));
  } catch {
    throw new QuizGenerationOutputError("The AI's quiz response wasn't valid JSON.");
  }

  // Never trust model-supplied citations (task §4/§6) — strip any
  // "sources" the model added anyway before validating, so a hallucinated
  // or malformed citation can't fail an otherwise-good question, and so
  // there's no ambiguity about whose sources end up persisted.
  const withoutModelSources =
    Array.isArray(parsedJson) && parsedJson.every((item) => typeof item === "object" && item !== null)
      ? parsedJson.map((item) => {
          const { sources: _ignoredModelSources, ...rest } = item as Record<string, unknown>;
          return rest;
        })
      : parsedJson;

  const rawParsed = rawGeneratedArraySchema.safeParse(withoutModelSources);
  if (!rawParsed.success) {
    throw new QuizGenerationOutputError("The AI didn't return any usable quiz questions from this topic's material.");
  }

  // Every question in one generation batch shares the same retrieved
  // context, so every question gets the same real source set — see
  // flashcard-generation.ts's identical rationale.
  const sources: LearningSourceRef[] = chunksToSources(chunks);

  // Second validation pass: the complete persisted shape (real sources
  // attached), re-checked against the exact same schema — task §5's
  // "validate complete generated result", distinct from the raw-shape
  // check above.
  const validatedItems = rawParsed.data.map((item) => quizQuestionGenerationItemSchema.parse({ ...item, sources }));

  const quizType = inferQuizType(validatedItems.map((item) => item.questionType));
  const quizTitle = `Quiz — ${topic.name}`;

  const quiz = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.quiz.create({
      data: {
        title: quizTitle,
        quizType,
        ownerId: userId,
        workspaceId: scope.workspaceId,
        groupId: scope.groupId,
        subjectId: scope.subjectId,
        chapterId: scope.chapterId,
        topicId: scope.topicId,
      },
    });

    // Sequential creates (not createMany), same reasoning as
    // flashcard-generation.ts — but QuizQuestion also has an explicit
    // `order` column (unlike Flashcard), so ordering here doesn't
    // actually depend on cuid/createdAt behavior; `order` is set directly
    // and is the authoritative sort key when reading questions back.
    let order = 0;
    for (const item of validatedItems) {
      await tx.quizQuestion.create({
        data: {
          quizId: created.id,
          prompt: item.prompt,
          questionType: item.questionType,
          // Same JSON round-trip as Flashcard.sources (see
          // flashcard-generation.ts) to satisfy Prisma's InputJsonValue
          // shape and drop `undefined` fields cleanly.
          options: item.options ? JSON.parse(JSON.stringify(item.options)) : undefined,
          correctAnswer: JSON.parse(JSON.stringify(item.correctAnswer)),
          explanation: item.explanation ?? null,
          sources: JSON.parse(JSON.stringify(item.sources)),
          order,
        },
      });
      order += 1;
    }

    return tx.quiz.findUniqueOrThrow({
      where: { id: created.id },
      include: { questions: { orderBy: { order: "asc" } } },
    });
  });

  // Best-effort, after persistence has already succeeded — same
  // placement/rationale as flashcard-generation.ts's recordAIUsage call.
  await recordAIUsage({
    userId,
    workspaceId: scope.ownerType === "workspace" ? scope.workspaceId : null,
    groupId: scope.ownerType === "group" ? scope.groupId : null,
    category: "quiz_generation",
    provider: ai.providerName,
    model: ai.modelName,
    tokensInput: result.tokensInput,
    tokensOutput: result.tokensOutput,
    context: { topicId, quizId: quiz.id },
  });

  return quiz;
}
