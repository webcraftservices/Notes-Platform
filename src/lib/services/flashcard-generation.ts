import { db } from "@/lib/db";
import { getAccessibleAIScope, type ResolvedAIScope } from "@/lib/access";
import { retrieveRelevantChunks } from "@/lib/retrieval";
import { buildContextBlock, chunksToSources } from "@/lib/ai-chat";
import { getAIService } from "@/lib/services/ai";
import { recordAIUsage } from "@/lib/ai-usage";
import { flashcardGenerationItemSchema, type LearningSourceRef } from "@/lib/validation/learning";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Phase 8.2 — "Generate flashcards from MY KNOWLEDGE", not "ask an LLM to
 * make flashcards about this topic" (spec §16 for this phase). Thrown when
 * a Topic has nothing indexed yet — generation must fail honestly here
 * rather than fall back to the model's general knowledge.
 */
export class InsufficientSourceMaterialError extends Error {
  constructor() {
    super(
      "This topic doesn't have enough indexed material yet to generate flashcards. " +
        "Add some materials, transcribe a recording, or write some notes first, then try again."
    );
    this.name = "InsufficientSourceMaterialError";
  }
}

/**
 * Thrown when the AI's response can't be turned into at least one valid
 * flashcard (not valid JSON, wrong shape, or validation rejected every
 * item). Never repaired/guessed into something that was never actually
 * generated (CLAUDE.md's "never fake a feature") — this always means
 * nothing was written to the database.
 */
export class FlashcardGenerationOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlashcardGenerationOutputError";
  }
}

// Broader than AI_CHAT's default retrieval limit of 8 — a single chat
// turn answers one question, but generating a useful set of cards
// benefits from wider coverage of what this Topic actually contains.
const RETRIEVAL_LIMIT = 20;

// The model only ever produces front/back — WE attach `sources` ourselves
// from the actual retrieved chunks (see below), never asking the model to
// invent its own citations. Reusing flashcardGenerationItemSchema's own
// front/back rules (via .pick) rather than re-declaring them keeps this
// in lockstep with the Phase 8.1 contract instead of a parallel copy.
const rawGeneratedItemSchema = flashcardGenerationItemSchema.pick({ front: true, back: true });
const rawGeneratedArraySchema = z.array(rawGeneratedItemSchema).min(1).max(20);

function buildFlashcardGenerationPrompt(topicName: string, topicDescription: string | null): string {
  return `Generate study flashcards for the topic "${topicName}"${
    topicDescription ? ` (${topicDescription})` : ""
  }, using ONLY the retrieved course material context supplied above as your source of truth.

Rules:
- Base every card strictly on the supplied context. Never invent a fact, definition, formula, or example that isn't actually present in it.
- If the context only supports a few good cards, return fewer cards — never pad the set with generic or unsupported content to reach a target count.
- Each card should test one clear, meaningful piece of knowledge (a definition, a key distinction, a formula, an important fact) — avoid trivial or overly broad questions.
- Do not create near-duplicate cards or cards that are just trivial rewordings of each other.
- Preserve the exact terminology used in the source material rather than paraphrasing key terms away.
- Keep "front" a concise question or prompt, and "back" a concise, complete answer.
- Aim for 5-12 cards when the context supports that many, but never fabricate content just to hit that range.

Respond with ONLY a raw JSON array — no markdown code fences, no commentary before or after it — where every item has exactly this shape: {"front": string, "back": string}.`;
}

/** Defensive unwrap in case the model wraps its JSON in a markdown code fence despite being told not to (chat() has no responseMimeType/JSON-mode support, unlike generateNotes()'s Gemini-specific schema mode). */
function extractJsonArrayText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

export interface GenerateFlashcardsForTopicInput {
  userId: string;
  topicId: string;
}

/**
 * The full Phase 8.2 pipeline (spec's pipeline diagram): resolves and
 * re-authorizes the Topic's scope, retrieves real indexed knowledge
 * within that scope, asks the existing AIService for structured
 * flashcards grounded in that context, validates the result twice
 * (raw AI shape, then the complete persisted shape including real
 * provenance) and only then writes a FlashcardDeck + Flashcards in one
 * transaction. Throws (never returns a partial/empty deck) on any
 * failure — see InsufficientSourceMaterialError/
 * FlashcardGenerationOutputError, `NotAuthorizedError` (lib/access.ts),
 * and `ServiceNotConfiguredError`/other AIService errors, which are all
 * left to propagate to the caller (the API route) uncaught.
 *
 * Scope note: this deliberately calls `getAccessibleAIScope` ONCE — not
 * `resolveLearningScope` (lib/learning-scope.ts) as well — because a
 * `ResolvedAIScope` for a topicId input already carries every field
 * `FlashcardDeck`'s scope columns need (workspaceId/groupId as the
 * resolved owner, plus subjectId/chapterId/topicId), and both resolvers'
 * topicId branches derive that from the exact same
 * `resolveSubjectOwner(topic.chapter.subject)` call. Calling both would
 * re-authorize the same Topic a second time for identical output, not
 * reuse a second piece of logic. `resolveLearningScope` stays the right
 * tool for a future Subject/Chapter-level generation input, which this
 * phase intentionally doesn't add (spec §2 — Topic-only for 8.2).
 */
export async function generateFlashcardsForTopic(input: GenerateFlashcardsForTopicInput) {
  const { userId, topicId } = input;

  const scope: ResolvedAIScope = await getAccessibleAIScope({ topicId }, userId);

  const topic = await db.topic.findUnique({ where: { id: topicId } });
  if (!topic) throw new InsufficientSourceMaterialError(); // Defensive only — the route already confirmed the topic exists before calling this.

  const query = [topic.name, topic.description].filter(Boolean).join(". ");
  const chunks = await retrieveRelevantChunks(query, scope, userId, RETRIEVAL_LIMIT);
  if (chunks.length === 0) throw new InsufficientSourceMaterialError();

  const context = buildContextBlock(chunks) ?? undefined;
  const ai = getAIService();
  const result = await ai.chat({
    messages: [
      { role: "system", content: buildFlashcardGenerationPrompt(topic.name, topic.description) },
      { role: "user", content: "Generate the flashcards now, following every rule above exactly." },
    ],
    context,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractJsonArrayText(result.content));
  } catch {
    throw new FlashcardGenerationOutputError("The AI's flashcard response wasn't valid JSON.");
  }

  const rawParsed = rawGeneratedArraySchema.safeParse(parsedJson);
  if (!rawParsed.success) {
    throw new FlashcardGenerationOutputError(
      "The AI didn't return any usable flashcards from this topic's material."
    );
  }

  // Every card in one generation batch shares the same retrieved context,
  // so every card gets the same source set — honest, since this really is
  // everything that grounded this batch (never per-card, invented
  // fine-grained attribution the model was never actually asked for).
  const sources: LearningSourceRef[] = chunksToSources(chunks);

  // Second validation pass: the *complete* shape that will be persisted
  // (front/back + real sources), not just the raw AI shape — task §4's
  // "validate the complete generated result before writing to the
  // database", distinct from the raw-shape check above.
  const validatedItems = rawParsed.data.map((item) => flashcardGenerationItemSchema.parse({ ...item, sources }));

  const deckTitle = `Flashcards — ${topic.name}`;

  const deck = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.flashcardDeck.create({
      data: {
        title: deckTitle,
        ownerId: userId,
        workspaceId: scope.workspaceId,
        groupId: scope.groupId,
        subjectId: scope.subjectId,
        chapterId: scope.chapterId,
        topicId: scope.topicId,
      },
    });

    // Sequential creates (not createMany) so each card's cuid — which is
    // time-ordered by design — is generated strictly after the previous
    // one, giving a reliable `ORDER BY id ASC` for stable ordering later.
    // createMany can't be used for this: every row would share the exact
    // same `now()` (Postgres fixes `now()` at transaction start), so
    // createdAt can't be trusted to preserve generation order here the
    // way it can for models created one-per-request elsewhere in this app.
    for (const item of validatedItems) {
      await tx.flashcard.create({
        data: {
          deckId: created.id,
          front: item.front,
          back: item.back,
          // Same JSON round-trip AIMessage.sources uses (messages/route.ts)
          // to satisfy Prisma's InputJsonValue shape and drop `undefined`
          // fields cleanly, rather than an unchecked `as` cast.
          sources: JSON.parse(JSON.stringify(item.sources)),
        },
      });
    }

    return tx.flashcardDeck.findUniqueOrThrow({
      where: { id: created.id },
      include: { cards: { orderBy: { id: "asc" } } },
    });
  });

  // Best-effort, after persistence has already succeeded — mirrors the AI
  // chat route's recordAIUsage placement exactly (lib/ai-usage.ts's doc
  // comment: a usage-ledger failure must never turn an already-successful
  // generation into a failed response).
  await recordAIUsage({
    userId,
    workspaceId: scope.ownerType === "workspace" ? scope.workspaceId : null,
    groupId: scope.ownerType === "group" ? scope.groupId : null,
    category: "flashcard_generation",
    provider: ai.providerName,
    model: ai.modelName,
    tokensInput: result.tokensInput,
    tokensOutput: result.tokensOutput,
    context: { topicId, deckId: deck.id },
  });

  return deck;
}
