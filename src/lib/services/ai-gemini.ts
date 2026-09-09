import { GoogleGenAI, ApiError, Type } from "@google/genai";
import type { Content, GenerateContentParameters, GenerateContentResponse, Schema } from "@google/genai";
import type { AIService, AIChatMessage } from "./interfaces";
import { ServiceNotConfiguredError } from "./interfaces";
import { NOTE_BLOCK_KIND_LABELS, NOTE_BLOCK_KIND_ORDER } from "@/lib/note-block-style";

/**
 * gemini-2.5-flash-lite: Google's cheapest current-generation Gemini model
 * (as of this writing, the lowest standard per-token rate across the
 * Gemini lineup, and Flash-family models are usable free of charge within
 * rate limits) — chosen specifically because this task's stated goal is
 * keeping initial operating cost as close to zero as possible, not because
 * it's the newest or most capable model. It's also the more stable,
 * proven choice next to the fast-churning 3.x Flash line (several 3.x
 * point releases shipped and were re-priced within weeks of each other
 * around this time) — a "primary provider" pick that gets renamed or
 * re-priced every few weeks is a worse default than a cheaper, longer-
 * lived one. Swapping to a newer/cheaper model later is a one-line change
 * to this constant, not a registry-level change.
 */
const GEMINI_MODEL = "gemini-2.5-flash-lite";

/**
 * Fixed hallucination-control instruction (spec §24 / CLAUDE.md's "never
 * fake a feature" rule), owned entirely by this concrete provider rather
 * than ai-chat.ts — ai-chat.ts stays a pure, provider-agnostic formatter
 * (buildContextBlock/chunksToSources), and every provider is free to
 * phrase its own grounding instructions however suits that model best.
 */
const HALLUCINATION_CONTROL_INSTRUCTION = `You are the AI assistant built into Notes Platform, a study and knowledge
platform. You help the user understand their own uploaded course materials
(lecture recordings, PDFs, documents, and notes).

Ground rules:
- Treat any "Retrieved course material context" provided below as your
  primary factual source for questions about the user's course content.
- Do not invent facts, details, or explanations that aren't supported by
  the retrieved context or clearly-labeled general knowledge.
- If the retrieved context doesn't contain the answer, say plainly that
  the information wasn't found in the user's uploaded materials, rather
  than guessing or filling the gap with unstated assumptions. You may then
  offer a general-knowledge answer, but only after saying so explicitly
  and clearly distinguishing it from what the materials actually say.
- When you do use the retrieved context, keep material-grounded claims and
  general explanation visibly distinct (e.g. "Your notes say..." vs
  "In general,...") rather than blending them into one undifferentiated
  answer.
- Never fabricate a citation, source name, page number, or timestamp. Only
  reference a source that actually appears in the retrieved context below,
  using the numbering/label it was given there.`;

function buildSystemInstruction(context: string | undefined, extraSystemMessages: string[]): string {
  const parts = [HALLUCINATION_CONTROL_INSTRUCTION];

  if (context) {
    parts.push(`Retrieved course material context (numbered sources — cite only these, exactly as labeled):\n${context}`);
  } else {
    parts.push(
      "No course material context was retrieved for this question. If the user is asking about specific " +
        "course content, say the information wasn't found in their uploaded materials rather than guessing."
    );
  }

  if (extraSystemMessages.length > 0) parts.push(...extraSystemMessages);

  return parts.join("\n\n");
}

/** Maps AIChatMessage[] to Gemini's Content[] shape — Gemini uses "model", not "assistant", and system messages don't belong in `contents` at all (they fold into systemInstruction above). */
function toGeminiContents(messages: AIChatMessage[]): Content[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
}

function extractSystemMessages(messages: AIChatMessage[]): string[] {
  return messages.filter((m) => m.role === "system").map((m) => m.content);
}

function wrapGeminiError(err: unknown): Error {
  if (err instanceof ApiError) return new Error(`Gemini request failed (${err.status}): ${err.message}`);
  return new Error(`Gemini request failed: ${err instanceof Error ? err.message : String(err)}`);
}

const NOTE_BLOCK_KINDS = NOTE_BLOCK_KIND_ORDER as string[];

const NOTE_BLOCKS_SCHEMA: Schema = {
  type: Type.ARRAY,
  description: "Structured educational note sections extracted from the transcript.",
  items: {
    type: Type.OBJECT,
    properties: {
      kind: {
        type: Type.STRING,
        enum: NOTE_BLOCK_KINDS,
        description: "The section type. Only include sections genuinely supported by the transcript content.",
      },
      heading: { type: Type.STRING, description: "Optional short heading for this section." },
      content: { type: Type.STRING, description: "The section's body text." },
    },
    required: ["kind", "content"],
  },
};

function buildNoteGenerationPrompt(transcriptText: string, templateKind: "lecture" | "meeting"): string {
  const kindList = NOTE_BLOCK_KINDS.map((k) => `${k} (${NOTE_BLOCK_KIND_LABELS[k]})`).join(", ");
  const guidance =
    templateKind === "meeting"
      ? "This is a meeting recording. Favor AGENDA, IMPORTANT_POINTS, DECISION, ACTION_ITEM, and SUMMARY sections where the transcript actually supports them."
      : "This is a lecture recording. Favor OVERVIEW, DEFINITION, CORE_CONCEPT, EXPLANATION, IMPORTANT_POINTS, EXAMPLE, FORMULA, DERIVATION, APPLICATION, COMMON_MISTAKE, EXAM_IMPORTANT, and SUMMARY sections where the transcript actually supports them.";

  return `Read the following transcript and produce structured educational notes as a JSON array of sections.

Available section kinds: ${kindList}.
${guidance}

Only include a section if the transcript actually contains content supporting it — do not invent formulas, examples, exam hints, or "important" callouts that aren't genuinely present in the transcript. Only mark a point EXAM_IMPORTANT or add a COMMON_MISTAKE section if the speaker explicitly signals that (e.g. says it's important, will be tested, or is a common error) — never infer importance on your own judgment alone.

Transcript:
"""
${transcriptText}
"""`;
}

/**
 * The one Gemini client surface this file touches, expressed as our own
 * minimal interface (mirroring embedding-openai.ts's EmbeddingsClient
 * pattern) rather than `Pick<GoogleGenAI, "models">` — keeps this file
 * trivially mockable in tests without needing a real GoogleGenAI instance.
 * A real GoogleGenAI client's `.models` still satisfies this structurally.
 */
interface GeminiClient {
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
}

/**
 * Real integration against the Gemini API via the official `@google/genai`
 * SDK (docs/ai-setup.md §2 — the point where the project stops being
 * provider-agnostic for AIService, same as embedding-openai.ts already is
 * for EmbeddingService). Untestable against the live API from this
 * sandbox — generativelanguage.googleapis.com isn't reachable here — the
 * same documented limitation as speech-openai.ts/embedding-openai.ts; this
 * class is unit-tested with the SDK client mocked instead (see
 * __tests__/ai-gemini.test.ts).
 */
export class GeminiAIService implements AIService {
  constructor(private readonly client: GeminiClient) {}

  async chat(input: {
    messages: AIChatMessage[];
    context?: string;
    stream?: boolean;
  }): Promise<{ content: string; tokensInput: number; tokensOutput: number }> {
    const systemInstruction = buildSystemInstruction(input.context, extractSystemMessages(input.messages));
    const contents = toGeminiContents(input.messages);

    if (contents.length === 0) {
      throw new Error("Cannot send a chat request to Gemini with no user/assistant messages.");
    }

    let response: GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: { systemInstruction },
      });
    } catch (err) {
      throw wrapGeminiError(err);
    }

    const text = response.text;
    if (!text || text.trim().length === 0) {
      throw new Error("Gemini returned an empty response.");
    }

    return {
      content: text,
      tokensInput: response.usageMetadata?.promptTokenCount ?? 0,
      tokensOutput: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  async generateNotes(input: {
    transcriptText: string;
    templateKind: "lecture" | "meeting";
  }): Promise<{ blocks: { kind: string; heading?: string; content: string }[] }> {
    let response: GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ text: buildNoteGenerationPrompt(input.transcriptText, input.templateKind) }] }],
        config: {
          systemInstruction: HALLUCINATION_CONTROL_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: NOTE_BLOCKS_SCHEMA,
        },
      });
    } catch (err) {
      throw wrapGeminiError(err);
    }

    const text = response.text;
    if (!text || text.trim().length === 0) {
      throw new Error("Gemini returned an empty response for note generation.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Gemini's note-generation response wasn't valid JSON despite the requested JSON schema.");
    }

    if (!Array.isArray(parsed)) {
      throw new Error("Gemini's note-generation response wasn't a JSON array as requested.");
    }

    const blocks = parsed.map((raw, i) => {
      if (
        typeof raw !== "object" ||
        raw === null ||
        typeof (raw as Record<string, unknown>).kind !== "string" ||
        typeof (raw as Record<string, unknown>).content !== "string"
      ) {
        throw new Error(`Gemini's note-generation response item ${i} is missing a required "kind" or "content" string field.`);
      }
      const heading = (raw as Record<string, unknown>).heading;
      return {
        kind: (raw as { kind: string }).kind,
        heading: typeof heading === "string" ? heading : undefined,
        content: (raw as { content: string }).content,
      };
    });

    return { blocks };
  }
}

export function createGeminiAIService(): GeminiAIService {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new ServiceNotConfiguredError("Gemini AIService", ["GOOGLE_AI_API_KEY"]);
  }
  return new GeminiAIService(new GoogleGenAI({ apiKey }));
}
