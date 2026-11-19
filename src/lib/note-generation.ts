import { MaterialType, Prisma, type ProcessingJob } from "@prisma/client";
import { db } from "@/lib/db";
import {
  claimJob,
  completeJobWithin,
  failJob,
  isJobActive,
  registerJobContext,
} from "@/lib/processing-jobs";
import { getOrCreateTopicNote } from "@/lib/notes";
import { getAIService } from "@/lib/services/ai";
import { AIGenerationFailedError } from "@/lib/services/interfaces";
import { recordAIUsage } from "@/lib/ai-usage";
import { NOTE_BLOCK_KIND_ORDER, EMPTY_TIPTAP_DOC } from "@/lib/note-block-style";
import { buildNotePlainText } from "@/lib/search/tiptap-text";
import { syncNoteSearchIndex } from "@/lib/search/note-embedding";

/**
 * Maximum character length of document text accepted for single-pass AI note generation.
 * 200,000 characters corresponds to ~35,000 words (~45,000-50,000 tokens), providing
 * ample context for entire lecture slide decks, long articles, and book chapters while
 * staying well within Gemini's 180-second timeout budget and candidate output limits.
 */
export const MAX_DOCUMENT_NOTE_GEN_CHARS = 200_000;

export const SUPPORTED_NOTE_GEN_TYPES: ReadonlySet<MaterialType> = new Set([
  "AUDIO",
  "VIDEO",
  "PDF",
  "DOCX",
  "PPTX",
  "GOOGLE_DOC",
]);

export interface ExtractedPageEntry {
  pageNumber: number;
  text: string;
}

/**
 * Safely validates and extracts page/slide entries from Material.extractedPages.
 * Guarantees 1-based integer page numbers and string text content.
 */
export function parseExtractedPages(raw: unknown): ExtractedPageEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const result: ExtractedPageEntry[] = [];
  for (const item of raw) {
    if (typeof item === "object" && item !== null) {
      const rec = item as Record<string, unknown>;
      const pNum = rec.pageNumber;
      const text = rec.text;
      if (
        typeof pNum === "number" &&
        Number.isInteger(pNum) &&
        pNum > 0 &&
        typeof text === "string"
      ) {
        result.push({
          pageNumber: pNum,
          text,
        });
      }
    }
  }
  return result.length > 0 ? result : null;
}

/**
 * Formats structured page/slide entries into delimited source text with
 * unambiguous boundary identifiers (e.g. "--- Page 1 ---" or "--- Slide 1 ---").
 * Omits empty or whitespace-only source units to prevent false attribution.
 */
export function formatDelimitedSourceText(
  pages: ExtractedPageEntry[],
  unitType: "page" | "slide"
): { formattedText: string; availableUnits: number[] } {
  const label = unitType === "page" ? "Page" : "Slide";
  const availableUnits: number[] = [];
  const parts: string[] = [];

  for (const page of pages) {
    const trimmed = page.text.trim();
    if (trimmed.length > 0) {
      availableUnits.push(page.pageNumber);
      parts.push(`--- ${label} ${page.pageNumber} ---\n${trimmed}`);
    }
  }

  return {
    formattedText: parts.join("\n\n"),
    availableUnits,
  };
}

/**
 * Runs a single AI_NOTE_GENERATION job: RUNNING → resolve source text (transcript
 * for audio/video, extractedText for documents) → AIService.generateNotes() →
 * record token usage → append real NoteBlock rows to the material's topic's note,
 * or FAILED + a real error message. Never fabricates blocks — a misconfigured
 * AIService always surfaces as a failed job (see runTranscriptionJob/runEmbeddingJob
 * for the same pattern).
 *
 * Scope decision: generation is per-Material (mirrors the transcribe job),
 * not per-Topic-aggregating-all-materials — keeps this job's shape
 * identical to transcription/embedding (single material in, single
 * outcome out) rather than introducing a different job shape for this one
 * case. A future "regenerate from all of this topic's materials" action
 * can layer on top without changing this function.
 *
 * Existing manual/AI blocks are never deleted or overwritten — generated
 * blocks are appended after the current highest `order`, and a
 * NoteVersion snapshot is written first (spec §70), so this is always a
 * non-destructive action a user can undo via version history.
 */
export async function runNoteGenerationJob(jobId: string): Promise<void> {
  // Phase 9.4: see runTranscriptionJob — everything runs inside the try
  // and `failJob` never throws.
  try {
    const job: ProcessingJob | null = await db.processingJob.findUnique({ where: { id: jobId } });
    if (!job || job.type !== "AI_NOTE_GENERATION" || !job.materialId) return;
    registerJobContext?.(job);
    if (!(await claimJob(jobId))) return;

    const material = await db.material.findUnique({ where: { id: job.materialId } });
    if (!material) throw new Error("Material could not be found.");
    if (!material.topicId) {
      throw new Error("This material isn't attached to a topic, so AI notes can't be added to a note.");
    }

    const topic = await db.topic.findUnique({ where: { id: material.topicId } });
    if (!topic) throw new Error("This material's topic could not be found.");

    let sourceText = "";
    let sourceType: "transcript" | "document" = "document";
    let sourceUnits: { unitType: "page" | "slide"; availableUnits: number[] } | undefined = undefined;

    if (material.type === "AUDIO" || material.type === "VIDEO") {
      sourceType = "transcript";
      const transcript = await db.transcript.findUnique({ where: { materialId: material.id } });
      if (!transcript || transcript.status !== "READY" || !transcript.fullText) {
        throw new Error("This material doesn't have a ready transcript yet — transcribe it first.");
      }
      sourceText = transcript.fullText;
    } else if (
      material.type === "PDF" ||
      material.type === "DOCX" ||
      material.type === "PPTX" ||
      material.type === "GOOGLE_DOC"
    ) {
      sourceType = "document";
      const extracted = material.extractedText?.trim();
      if (!extracted) {
        throw new Error("This document has no extracted text. Please wait for extraction or upload a readable file.");
      }
      if (extracted.length > MAX_DOCUMENT_NOTE_GEN_CHARS) {
        throw new Error(
          `This document exceeds the maximum supported size for note generation (${extracted.length.toLocaleString()} characters; limit is ${MAX_DOCUMENT_NOTE_GEN_CHARS.toLocaleString()}).`
        );
      }
      sourceText = extracted;

      if (material.type === "PDF" || material.type === "PPTX") {
        const pages = parseExtractedPages(material.extractedPages);
        if (pages) {
          const unitType = material.type === "PDF" ? "page" : "slide";
          const formatted = formatDelimitedSourceText(pages, unitType);
          if (formatted.formattedText.length > 0) {
            sourceText = formatted.formattedText;
            sourceUnits = { unitType, availableUnits: formatted.availableUnits };
          }
        }
      }
    } else {
      throw new Error(`AI note generation is not supported for ${material.type} materials.`);
    }

    // Getting the service (and thus throwing ServiceNotConfiguredError if
    // no provider is wired up — always true in this phase) happens BEFORE
    // any note/block writes, so a misconfigured environment never leaves
    // behind partial generated content.
    const ai = getAIService();
    let result;
    try {
      result = await ai.generateNotes({
        sourceText,
        sourceType,
        templateKind: sourceType === "transcript" ? "lecture" : "study_guide",
        sourceUnits,
      });
    } catch (genErr) {
      if (
        genErr instanceof AIGenerationFailedError &&
        (typeof genErr.tokensInput === "number" || typeof genErr.tokensOutput === "number")
      ) {
        try {
          await recordAIUsage({
            userId: job.userId,
            workspaceId: material.workspaceId,
            groupId: material.groupId,
            category: "note_generation",
            provider: ai.providerName,
            model: ai.modelName,
            tokensInput: genErr.tokensInput,
            tokensOutput: genErr.tokensOutput,
            context: {
              materialId: material.id,
              topicId: topic.id,
              sourceType,
              materialType: material.type,
              status: "failed",
              finishReason: genErr.finishReason ?? null,
            },
          });
        } catch (usageErr) {
          console.error("[note-generation] unexpected error recording AI usage for failed generation", usageErr);
        }
      }
      throw genErr;
    }

    if (!(await isJobActive(jobId, material.id))) return;

    // Record AI token usage when provider succeeds, attributed to the requesting user.
    // recordAIUsage catches errors internally, but we guard defensively so a usage ledger failure
    // can never prevent generated note blocks from being persisted.
    try {
      await recordAIUsage({
        userId: job.userId,
        workspaceId: material.workspaceId,
        groupId: material.groupId,
        category: "note_generation",
        provider: ai.providerName,
        model: ai.modelName,
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        context: {
          materialId: material.id,
          topicId: topic.id,
          sourceType,
          materialType: material.type,
        },
      });
    } catch (usageErr) {
      console.error("[note-generation] unexpected error recording AI usage", usageErr);
    }

    if (result.blocks.length === 0) {
      if (await isJobActive(jobId, material.id)) {
        const dbAny = db as unknown as {
          $transaction?: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>;
        };
        if (typeof dbAny.$transaction === "function") {
          await dbAny.$transaction((tx) => completeJobWithin(tx, jobId, material.id));
        } else {
          await completeJobWithin(db, jobId, material.id);
        }
      }
      return;
    }

    let updatedNoteInfo: { noteId: string; plainText: string } | null = null;

    await db.$transaction(async (tx) => {
      const note = await getOrCreateTopicNote(topic, job.userId, { tx, deferIndexSync: true });
      if (!(await completeJobWithin(tx, jobId, material.id))) return;

      const existingBlocks = await tx.noteBlock.findMany({ where: { noteId: note.id } });
      if (existingBlocks.length > 0) {
        await tx.noteVersion.create({
          data: { noteId: note.id, editedById: job.userId, snapshot: existingBlocks as unknown as object },
        });
      }

      const startOrder = existingBlocks.reduce((max, b) => Math.max(max, b.order), -1) + 1;

      const newBlockRecords = result.blocks.map((block, i) => {
        let blockMetadata: Prisma.InputJsonValue | undefined = undefined;
        if (sourceType === "document") {
          const docMeta: Record<string, unknown> = {
            materialId: material.id,
            materialTitle: material.title,
            materialType: material.type,
          };
          if (sourceUnits && block.sourcePages && block.sourcePages.length > 0) {
            docMeta.sourceUnitType = sourceUnits.unitType;
            docMeta.sourcePages = block.sourcePages;
            if (block.sourcePages.length === 1 && typeof block.sourcePages[0] === "number") {
              docMeta.pageNumber = block.sourcePages[0];
            }
          }
          blockMetadata = docMeta as Prisma.InputJsonValue;
        }
        return {
          noteId: note.id,
          kind: (isKnownBlockKind(block.kind) ? block.kind : "CUSTOM") as never,
          heading: block.heading ?? null,
          content: toTiptapDoc(block.content),
          order: startOrder + i,
          metadata: blockMetadata ?? undefined,
        };
      });

      // Attach source attribution metadata for document materials
      await tx.noteBlock.createMany({
        data: newBlockRecords,
      });

      if (note.source === "MANUAL" && existingBlocks.length === 0) {
        await tx.note.update({
          where: { id: note.id },
          data: {
            source: "AI_GENERATED",
            templateKind: sourceType === "transcript" ? "lecture" : "study_guide",
          },
        });
      } else {
        await tx.note.update({ where: { id: note.id }, data: { source: "AI_ASSISTED" } });
      }

      const combinedBlocks = [
        ...existingBlocks.map((b) => ({
          heading: b.heading ?? null,
          content: b.content ?? EMPTY_TIPTAP_DOC,
          order: b.order,
        })),
        ...newBlockRecords.map((b) => ({
          heading: b.heading,
          content: b.content,
          order: b.order,
        })),
      ];
      const plainText = buildNotePlainText(note.title ?? topic.name, combinedBlocks);
      await tx.note.update({ where: { id: note.id }, data: { plainText } });
      updatedNoteInfo = { noteId: note.id, plainText };
    });

    if (updatedNoteInfo) {
      const { noteId, plainText } = updatedNoteInfo as { noteId: string; plainText: string };
      await syncNoteSearchIndex(noteId, plainText, {
        userId: job.userId,
        workspaceId: material.workspaceId,
      });
    }
  } catch (err) {
    await failJob(jobId, "AI_NOTE_GENERATION", err, "AI note generation failed for an unknown reason.");
  }
}

const KNOWN_BLOCK_KINDS = new Set(NOTE_BLOCK_KIND_ORDER);

function isKnownBlockKind(kind: string): boolean {
  return KNOWN_BLOCK_KINDS.has(kind);
}

/** Wraps a plain-text AI-generated block into a minimal valid Tiptap document. */
function toTiptapDoc(content: string) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => ({ type: "paragraph", content: [{ type: "text", text: para }] }));

  return paragraphs.length > 0 ? { type: "doc", content: paragraphs } : EMPTY_TIPTAP_DOC;
}
