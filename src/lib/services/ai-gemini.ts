import { GoogleGenAI, ApiError, Type } from "@google/genai";
import type { Content, GenerateContentParameters, GenerateContentResponse, GoogleGenAIOptions, Schema } from "@google/genai";
import type { AIService, AIChatMessage, GenerateNotesInput, GenerateNotesResult, NoteGenerationSourceUnitInfo } from "./interfaces";
import { ServiceNotConfiguredError, AIProviderUnavailableError, AIGenerationFailedError } from "./interfaces";
import { NOTE_BLOCK_KIND_LABELS, NOTE_BLOCK_KIND_ORDER } from "@/lib/note-block-style";
import { AzureIdentityUnavailableError } from "@/lib/cloud/azure-identity";
import {
  createGoogleWifAuthClient,
  GoogleWifAuthError,
  isGoogleWifConfigured,
  resolveGoogleWifConfiguration,
} from "@/lib/cloud/google-wif";

/**
 * Maximum output tokens configured for Gemini note generation calls.
 * gemini-2.5-flash-lite supports up to 65,536 output tokens. 8,192 output tokens
 * provides ~6,000 words of rich structured notes (sufficient for comprehensive
 * lecture decks and book chapters) while capping single-invocation latency within
 * the 180-second timeout budget and guarding user credit consumption against runaway generation.
 */
export const GEMINI_NOTE_GENERATION_MAX_OUTPUT_TOKENS = 8192;

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
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

function resolveGeminiModel(): string {
  return process.env.GOOGLE_GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

/**
 * Phase 9.4 — explicit request bounds. The SDK's own defaults are: no
 * timeout at all (a stalled connection waits on the runtime's socket
 * timeouts, i.e. minutes) and no retries. Both are set deliberately here:
 *
 * - `GEMINI_TIMEOUT_MS` bounds ONE attempt (the SDK gives each attempt a
 *   fresh signal), sized for a chat/flashcard/quiz-sized completion.
 * - Note generation feeds an entire transcript through the model and
 *   returns a long structured response, so it gets its own, longer
 *   per-request budget (`GEMINI_NOTE_GENERATION_TIMEOUT_MS`).
 * - Retries are limited to ONE extra attempt and only for 5xx statuses,
 *   which are transient by definition. 429 is intentionally NOT retried
 *   (it usually means the project's quota/rate limit is exhausted, where an
 *   immediate retry only adds load), and 4xx validation/auth failures are
 *   never retried. A generation call has no side effects, so a retry is
 *   safe — the worst case is one extra billed attempt during an outage.
 */
const GEMINI_TIMEOUT_MS = 60_000;
const GEMINI_NOTE_GENERATION_TIMEOUT_MS = 180_000;
const GEMINI_RETRY_OPTIONS = { attempts: 2, initialDelay: 1, maxDelay: 4, httpStatusCodes: [500, 502, 503, 504] };

/**
 * Fixed hallucination-control instruction (spec §24 / CLAUDE.md's "never
 * fake a feature" rule), owned entirely by this concrete provider rather
 * than ai-chat.ts — ai-chat.ts stays a pure, provider-agnostic formatter
 * (buildContextBlock/chunksToSources), and every provider is free to
 * phrase its own grounding instructions however suits that model best.
 */
const HALLUCINATION_CONTROL_INSTRUCTION = `You are the AI assistant built into Zenote, a study and knowledge
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

/**
 * Statuses that mean "the provider itself is unavailable right now" rather
 * than "we sent it a bad request" — 429 (rate-limited upstream, from the
 * caller's perspective indistinguishable from unavailability) and any 5xx.
 * A 4xx other than 429 (e.g. 400 bad request) indicates a real bug in how
 * this file calls the API, so it is deliberately NOT included here (spec
 * §17: don't turn every error into 503).
 */
function isUpstreamUnavailableStatus(status: number | undefined): boolean {
  return status === 429 || (typeof status === "number" && status >= 500);
}

/**
 * Wraps anything thrown by the one `this.client.models.generateContent(...)`
 * call this file makes (Phase 9.1, spec §16-17). Anything that isn't a
 * structured `ApiError` from the SDK — a network failure, a timeout, a
 * connection reset — can only have come from the transport layer trying
 * and failing to reach Gemini at all, so it's treated as provider
 * unavailability too. Message text/format is unchanged from before this
 * phase (existing tests assert on it); only the resulting Error's type
 * changed, so callers can distinguish "try again shortly" (503) from a
 * genuine bug without parsing message strings.
 */
function wrapGeminiError(err: unknown): Error {
  if (err instanceof AzureIdentityUnavailableError || err instanceof GoogleWifAuthError) {
    return new AIProviderUnavailableError(err.message);
  }
  if (err instanceof ApiError) {
    const message = `Gemini request failed (${err.status}): ${err.message}`;
    return isUpstreamUnavailableStatus(err.status) ? new AIProviderUnavailableError(message) : new Error(message);
  }
  return new AIProviderUnavailableError(`Gemini request failed: ${err instanceof Error ? err.message : String(err)}`);
}

const NOTE_BLOCK_KINDS = NOTE_BLOCK_KIND_ORDER as string[];
const SUPPORTED_NOTE_BLOCK_KINDS = new Set<string>(NOTE_BLOCK_KINDS);

const NOTE_BLOCKS_SCHEMA: Schema = {
  type: Type.ARRAY,
  description: "Structured educational note sections extracted from the source content.",
  items: {
    type: Type.OBJECT,
    properties: {
      kind: {
        type: Type.STRING,
        enum: NOTE_BLOCK_KINDS,
        description: "The section type. Only include sections genuinely supported by the source content.",
      },
      heading: { type: Type.STRING, description: "Optional short heading for this section." },
      content: { type: Type.STRING, description: "The section's body text." },
      sourcePageNumbers: {
        type: Type.ARRAY,
        items: { type: Type.INTEGER },
        description:
          "Array of 1-based integer page or slide numbers directly supporting this section, exactly matching the delimiters in the source (e.g. [1] or [1, 2]). Only include numbers explicitly present in the source headers.",
      },
      sourceQuote: {
        type: Type.STRING,
        description:
          "Optional short verbatim excerpt or key phrase (5-20 words) from the referenced page(s) that directly provides the evidence for this block. Must match the text in the source document.",
      },
    },
    required: ["kind", "content"],
  },
};

/**
 * Normalizes text for case-insensitive, punctuation-agnostic phrase matching.
 * Collapses whitespace and strips punctuation to handle minor formatting differences.
 */
export function normalizeForGroundingSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts the text content of each source unit from delimited source text
 * (e.g. "--- Page 1 ---\n...").
 */
export function extractSourceUnitTexts(sourceText: string): Map<number, string> {
  const map = new Map<number, string>();
  const regex = /(?:^|\n)--- (?:Page|Slide) (\d+) ---\n/g;
  let match: RegExpExecArray | null;
  const matches: { unitNumber: number; startIndex: number; contentStartIndex: number }[] = [];

  while ((match = regex.exec(sourceText)) !== null) {
    const numStr = match[1];
    if (!numStr) continue;
    const unitNumber = parseInt(numStr, 10);
    matches.push({
      unitNumber,
      startIndex: match.index,
      contentStartIndex: match.index + match[0].length,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (!current) continue;
    const nextMatch = matches[i + 1];
    const nextStart = nextMatch ? nextMatch.startIndex : sourceText.length;
    const content = sourceText.slice(current.contentStartIndex, nextStart).trim();
    map.set(current.unitNumber, content);
  }

  return map;
}

function buildNoteGenerationPrompt(transcriptText: string, templateKind: "lecture" | "meeting" | "study_guide" = "lecture"): string {
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

function buildDocumentNoteGenerationPrompt(
  documentText: string,
  _templateKind?: string,
  sourceUnits?: NoteGenerationSourceUnitInfo
): string {
  const kindList = NOTE_BLOCK_KINDS.map((k) => `${k} (${NOTE_BLOCK_KIND_LABELS[k]})`).join(", ");

  let unitInstructions = "";
  if (sourceUnits && sourceUnits.availableUnits.length > 0) {
    const label = sourceUnits.unitType === "page" ? "Page" : "Slide";
    unitInstructions = `
Source attribution instructions:
- The document content is divided into explicit ${sourceUnits.unitType}s labeled "--- ${label} <number> ---".
- For every note section, populate "sourcePageNumbers" with the exact integer ${sourceUnits.unitType} number(s) that provide the evidence or explanation for that section.
- If a section synthesizes information across multiple ${sourceUnits.unitType}s, include all relevant numbers in "sourcePageNumbers" (e.g. [1, 2]).
- You must ONLY cite ${sourceUnits.unitType} numbers that appear as headers in the document text below. Available ${sourceUnits.unitType} numbers: ${sourceUnits.availableUnits.join(", ")}.
- If citing a ${sourceUnits.unitType}, you may optionally provide a short verbatim "sourceQuote" (5-20 words) from that specific ${sourceUnits.unitType}'s text directly supporting the section.
- If a section summarizes general high-level themes not attributable to specific ${sourceUnits.unitType}s, omit "sourcePageNumbers" or provide an empty array [].
- Never invent, estimate, or extrapolate ${sourceUnits.unitType} numbers.
`;
  }

  return `Read the following document and produce structured educational study notes as a JSON array of sections.

Available section kinds: ${kindList}.
Favor OVERVIEW, DEFINITION, CORE_CONCEPT, EXPLANATION, IMPORTANT_POINTS, EXAMPLE, FORMULA, DERIVATION, APPLICATION, and SUMMARY sections where the document text supports them.

Instructions:
- Base every section strictly on the provided document text.
- Capture major headings, fundamental definitions, core concepts, step-by-step explanations, and key takeaways.
- Preserve formulas, equations, and illustrative examples exactly as presented in the document.
- Only include a section if the document content genuinely supports it — do not invent concepts, formulas, or examples not present in the text.
- Only mark a point EXAM_IMPORTANT or add a COMMON_MISTAKE section if the document explicitly highlights it as a critical note, common error, or exam emphasis.
${unitInstructions}
Document content:
"""
${documentText}
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
  readonly providerName = "gemini";
  readonly modelName: string;

  constructor(private readonly client: GeminiClient, modelName: string = resolveGeminiModel()) {
    this.modelName = modelName;
  }

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
        model: this.modelName,
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

  async generateNotes(input: GenerateNotesInput): Promise<GenerateNotesResult> {
    const rawText = input.sourceText ?? input.transcriptText ?? "";
    const textToProcess = typeof rawText === "string" ? rawText.trim() : "";
    if (textToProcess.length === 0) {
      throw new Error("Cannot generate notes: source text is empty or missing.");
    }
    const sourceType = input.sourceType ?? (input.transcriptText ? "transcript" : "document");
    const templateKind = input.templateKind ?? (sourceType === "transcript" ? "lecture" : "study_guide");

    const promptText =
      sourceType === "transcript"
        ? buildNoteGenerationPrompt(textToProcess, templateKind === "meeting" ? "meeting" : "lecture")
        : buildDocumentNoteGenerationPrompt(textToProcess, templateKind, input.sourceUnits);

    let response: GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        config: {
          systemInstruction: HALLUCINATION_CONTROL_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: NOTE_BLOCKS_SCHEMA,
          maxOutputTokens: GEMINI_NOTE_GENERATION_MAX_OUTPUT_TOKENS,
          httpOptions: { timeout: GEMINI_NOTE_GENERATION_TIMEOUT_MS },
        },
      });
    } catch (err) {
      throw wrapGeminiError(err);
    }

    const tokensInput =
      typeof response.usageMetadata?.promptTokenCount === "number"
        ? response.usageMetadata.promptTokenCount
        : undefined;
    const tokensOutput =
      typeof response.usageMetadata?.candidatesTokenCount === "number"
        ? response.usageMetadata.candidatesTokenCount
        : undefined;

    if (response.promptFeedback?.blockReason) {
      const blockReason = response.promptFeedback.blockReason;
      throw new AIGenerationFailedError(
        `AI note generation was blocked by safety policy (${blockReason}). Please ensure the source text complies with content guidelines.`,
        { tokensInput, tokensOutput, finishReason: blockReason }
      );
    }

    if (!response.candidates || response.candidates.length === 0) {
      throw new AIGenerationFailedError(
        "AI note generation produced no response candidates.",
        { tokensInput, tokensOutput }
      );
    }

    const candidate = response.candidates[0];
    const finishReason = candidate?.finishReason;

    if (!finishReason) {
      throw new AIGenerationFailedError(
        "AI note generation response candidate is missing an explicit finish reason.",
        { tokensInput, tokensOutput }
      );
    }

    if (finishReason === "MAX_TOKENS") {
      throw new AIGenerationFailedError(
        "AI note generation was truncated because the response exceeded the maximum output token limit. Please try splitting the document into smaller sections.",
        { tokensInput, tokensOutput, finishReason: "MAX_TOKENS", isTruncated: true }
      );
    }

    if (finishReason === "SAFETY") {
      throw new AIGenerationFailedError(
        "AI note generation was blocked by safety filters. Please review the document content.",
        { tokensInput, tokensOutput, finishReason: "SAFETY" }
      );
    }

    if (finishReason === "RECITATION") {
      throw new AIGenerationFailedError(
        "AI note generation was blocked due to recitation check.",
        { tokensInput, tokensOutput, finishReason: "RECITATION" }
      );
    }

    if (finishReason === "BLOCKLIST" || finishReason === "PROHIBITED_CONTENT" || finishReason === "SPII") {
      throw new AIGenerationFailedError(
        `AI note generation was blocked (${finishReason}).`,
        { tokensInput, tokensOutput, finishReason }
      );
    }

    if (finishReason === "FINISH_REASON_UNSPECIFIED") {
      throw new AIGenerationFailedError(
        "AI note generation finished with unspecified finish reason.",
        { tokensInput, tokensOutput, finishReason: "FINISH_REASON_UNSPECIFIED" }
      );
    }

    if (finishReason !== "STOP") {
      throw new AIGenerationFailedError(
        `AI note generation failed with unexpected finish reason: ${finishReason}.`,
        { tokensInput, tokensOutput, finishReason }
      );
    }

    const text = response.text;
    if (!text || text.trim().length === 0) {
      throw new AIGenerationFailedError(
        "Gemini returned an empty response for note generation.",
        { tokensInput, tokensOutput, finishReason: "STOP" }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AIGenerationFailedError(
        "Gemini's note-generation response wasn't valid JSON despite the requested JSON schema.",
        { tokensInput, tokensOutput, finishReason: "STOP" }
      );
    }

    if (!Array.isArray(parsed)) {
      throw new AIGenerationFailedError(
        "Gemini's note-generation response wasn't a JSON array as requested.",
        { tokensInput, tokensOutput, finishReason: "STOP" }
      );
    }

    if (parsed.length === 0) {
      throw new AIGenerationFailedError(
        "Gemini returned an empty note array with no sections.",
        { tokensInput, tokensOutput, finishReason: "STOP" }
      );
    }

    const validUnitsSet =
      sourceType === "document" && input.sourceUnits && input.sourceUnits.availableUnits.length > 0
        ? new Set(input.sourceUnits.availableUnits)
        : null;

    const unitTextMap = validUnitsSet ? extractSourceUnitTexts(textToProcess) : null;

    const blocks = parsed.map((raw, i) => {
      if (
        typeof raw !== "object" ||
        raw === null ||
        typeof (raw as Record<string, unknown>).kind !== "string" ||
        typeof (raw as Record<string, unknown>).content !== "string"
      ) {
        throw new AIGenerationFailedError(
          `Gemini's note-generation response item ${i} is missing a required "kind" or "content" string field.`,
          { tokensInput, tokensOutput, finishReason: "STOP" }
        );
      }
      const rawKind = (raw as Record<string, unknown>).kind as string;
      if (!SUPPORTED_NOTE_BLOCK_KINDS.has(rawKind)) {
        throw new AIGenerationFailedError(
          `Gemini's note-generation response item ${i} has an unsupported kind: "${rawKind}".`,
          { tokensInput, tokensOutput, finishReason: "STOP" }
        );
      }
      const rawContent = (raw as { content: string }).content;
      if (rawContent.trim().length === 0) {
        throw new AIGenerationFailedError(
          `Gemini's note-generation response item ${i} contains empty content.`,
          { tokensInput, tokensOutput, finishReason: "STOP" }
        );
      }
      const heading = (raw as Record<string, unknown>).heading;

      let validatedSourcePages: number[] | undefined = undefined;
      let validatedSourceQuote: string | undefined = undefined;
      const rawPages = (raw as Record<string, unknown>).sourcePageNumbers;
      const rawQuote = (raw as Record<string, unknown>).sourceQuote;

      if (validUnitsSet && Array.isArray(rawPages)) {
        const filtered: number[] = [];
        for (const p of rawPages) {
          if (typeof p === "number" && Number.isInteger(p) && validUnitsSet.has(p)) {
            filtered.push(p);
          }
        }
        if (filtered.length > 0) {
          const candidatePages = Array.from(new Set(filtered)).sort((a, b) => a - b);

          // Content grounding verification when sourceQuote is provided
          if (typeof rawQuote === "string" && rawQuote.trim().length >= 5 && unitTextMap) {
            const normalizedQuote = normalizeForGroundingSearch(rawQuote);
            if (normalizedQuote.length >= 5) {
              const groundedPages = candidatePages.filter((pageNum) => {
                const unitText = unitTextMap.get(pageNum);
                if (!unitText) return false;
                return normalizeForGroundingSearch(unitText).includes(normalizedQuote);
              });

              if (groundedPages.length > 0) {
                validatedSourcePages = groundedPages;
                validatedSourceQuote = rawQuote.trim();
              } else {
                // The quote does not appear on any of the cited pages (fabricated or cross-page quotation).
                // Fail closed: discard ungrounded page attribution rather than guessing.
                validatedSourcePages = undefined;
              }
            } else {
              validatedSourcePages = candidatePages;
            }
          } else {
            // No verbatim quotation provided: retain candidate pages under reference-membership validation
            validatedSourcePages = candidatePages;
          }
        }
      }

      return {
        kind: rawKind,
        heading: typeof heading === "string" ? heading : undefined,
        content: rawContent,
        sourcePages: validatedSourcePages,
        sourceQuote: validatedSourceQuote,
      };
    });

    if (blocks.length === 0) {
      throw new AIGenerationFailedError(
        "Gemini returned no valid note blocks.",
        { tokensInput, tokensOutput, finishReason: "STOP" }
      );
    }

    const result: GenerateNotesResult = {
      blocks,
      tokensInput,
      tokensOutput,
    };

    return result;
  }
}

export type GeminiAuthMode = "auto" | "api_key" | "vertex_wif" | "vertex_adc";

export interface ResolvedGeminiAuthConfig {
  mode: "api_key" | "vertex_wif" | "vertex_adc";
  project?: string;
  location?: string;
}

/**
 * Resolves the Gemini authentication mode (preserving existing `GOOGLE_AI_API_KEY`
 * behavior by default while supporting Vertex AI via Google Workload Identity
 * Federation / Azure Managed Identity or standard Vertex ADC).
 */
export function resolveGeminiAuthConfig(
  env: Record<string, string | undefined> = process.env
): ResolvedGeminiAuthConfig {
  const requested = (env.GEMINI_AUTH_MODE?.trim() || "auto") as GeminiAuthMode;
  const project =
    env.GOOGLE_CLOUD_PROJECT?.trim() ||
    env.GCP_PROJECT_ID?.trim() ||
    env.GOOGLE_VERTEX_PROJECT?.trim();
  const location =
    env.GOOGLE_CLOUD_LOCATION?.trim() ||
    env.GCP_LOCATION?.trim() ||
    env.GOOGLE_VERTEX_LOCATION?.trim() ||
    "us-central1";
  const vertexFlag = env.GOOGLE_GENAI_USE_VERTEXAI === "true";

  if (requested === "api_key") {
    if (!env.GOOGLE_AI_API_KEY?.trim()) {
      throw new ServiceNotConfiguredError("Gemini AIService", ["GOOGLE_AI_API_KEY"]);
    }
    return { mode: "api_key" };
  }

  if (requested === "vertex_wif") {
    const wif = resolveGoogleWifConfiguration(env);
    if (!wif || !isGoogleWifConfigured(env)) {
      throw new ServiceNotConfiguredError("Gemini Vertex WIF AIService", [
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_WIF_AUDIENCE",
        "IDENTITY_ENDPOINT / IDENTITY_HEADER (or AZURE_IMDS_ENABLED=true)",
      ]);
    }
    return { mode: "vertex_wif", project: wif.project, location: wif.location };
  }

  if (requested === "vertex_adc") {
    if (!project) {
      throw new ServiceNotConfiguredError("Gemini Vertex ADC AIService", [
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_APPLICATION_CREDENTIALS",
      ]);
    }
    return { mode: "vertex_adc", project, location };
  }

  if (requested !== "auto") {
    throw new ServiceNotConfiguredError("Gemini AIService", [
      `GEMINI_AUTH_MODE must be one of "auto", "api_key", "vertex_wif", or "vertex_adc" (got "${requested}")`,
    ]);
  }

  if (isGoogleWifConfigured(env)) {
    const wif = resolveGoogleWifConfiguration(env)!;
    return { mode: "vertex_wif", project: wif.project, location: wif.location };
  }

  if (vertexFlag) {
    if (project) {
      return { mode: "vertex_adc", project, location };
    }
    throw new ServiceNotConfiguredError("Gemini Vertex AIService", [
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_WIF_AUDIENCE or GOOGLE_APPLICATION_CREDENTIALS",
    ]);
  }

  if (env.GOOGLE_AI_API_KEY?.trim()) {
    return { mode: "api_key" };
  }

  throw new ServiceNotConfiguredError("Gemini AIService", ["GOOGLE_AI_API_KEY"]);
}

export function createGeminiAIService(): GeminiAIService {
  const authConfig = resolveGeminiAuthConfig(process.env);
  const httpOptions = { timeout: GEMINI_TIMEOUT_MS, retryOptions: GEMINI_RETRY_OPTIONS };
  const modelName = resolveGeminiModel();

  if (authConfig.mode === "vertex_wif") {
    const authClient = createGoogleWifAuthClient();
    const googleAuthOptions = {
      authClient,
    } as unknown as NonNullable<GoogleGenAIOptions["googleAuthOptions"]>;
    return new GeminiAIService(
      new GoogleGenAI({
        vertexai: true,
        project: authConfig.project,
        location: authConfig.location,
        googleAuthOptions,
        httpOptions,
      }),
      modelName
    );
  }

  if (authConfig.mode === "vertex_adc") {
    return new GeminiAIService(
      new GoogleGenAI({
        vertexai: true,
        project: authConfig.project,
        location: authConfig.location,
        httpOptions,
      }),
      modelName
    );
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY!;
  return new GeminiAIService(
    new GoogleGenAI({ vertexai: false, apiKey, httpOptions }),
    modelName
  );
}
