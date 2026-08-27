import { db } from "@/lib/db";
import { getOrCreateTopicNote } from "@/lib/notes";
import { getAIService } from "@/lib/services/ai";
import { ServiceNotConfiguredError } from "@/lib/services/interfaces";
import { NOTE_BLOCK_KIND_ORDER, EMPTY_TIPTAP_DOC } from "@/lib/note-block-style";

/**
 * Runs a single AI_NOTE_GENERATION job: RUNNING → real transcript text →
 * AIService.generateNotes() → append real NoteBlock rows to the material's
 * topic's note, or FAILED + a real error message. Never fabricates
 * blocks — a misconfigured AIService always surfaces as a failed job
 * (see runTranscriptionJob/runEmbeddingJob for the same pattern).
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
  const job = await db.processingJob.findUnique({ where: { id: jobId } });
  if (!job || job.type !== "AI_NOTE_GENERATION" || !job.materialId) return;

  await db.processingJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    const material = await db.material.findUnique({ where: { id: job.materialId } });
    if (!material) throw new Error("Material could not be found.");
    if (!material.topicId) {
      throw new Error("This material isn't attached to a topic, so AI notes can't be added to a note.");
    }

    const topic = await db.topic.findUnique({ where: { id: material.topicId } });
    if (!topic) throw new Error("This material's topic could not be found.");

    const transcript = await db.transcript.findUnique({ where: { materialId: material.id } });
    if (!transcript || transcript.status !== "READY" || !transcript.fullText) {
      throw new Error("This material doesn't have a ready transcript yet — transcribe it first.");
    }

    // Getting the service (and thus throwing ServiceNotConfiguredError if
    // no provider is wired up — always true in this phase) happens BEFORE
    // any note/block writes, so a misconfigured environment never leaves
    // behind partial generated content.
    const ai = getAIService();
    const result = await ai.generateNotes({ transcriptText: transcript.fullText, templateKind: "lecture" });

    if (result.blocks.length === 0) {
      await db.processingJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
      });
      return;
    }

    await db.$transaction(async (tx) => {
      const note = await getOrCreateTopicNote(topic, job.userId);

      const existingBlocks = await tx.noteBlock.findMany({ where: { noteId: note.id } });
      if (existingBlocks.length > 0) {
        await tx.noteVersion.create({
          data: { noteId: note.id, editedById: job.userId, snapshot: existingBlocks as unknown as object },
        });
      }

      const startOrder = existingBlocks.reduce((max, b) => Math.max(max, b.order), -1) + 1;

      await tx.noteBlock.createMany({
        data: result.blocks.map((block, i) => ({
          noteId: note.id,
          kind: (isKnownBlockKind(block.kind) ? block.kind : "CUSTOM") as never,
          heading: block.heading ?? null,
          content: toTiptapDoc(block.content),
          order: startOrder + i,
        })),
      });

      if (note.source === "MANUAL" && existingBlocks.length === 0) {
        await tx.note.update({ where: { id: note.id }, data: { source: "AI_GENERATED", templateKind: "lecture" } });
      } else {
        await tx.note.update({ where: { id: note.id }, data: { source: "AI_ASSISTED" } });
      }

      await tx.processingJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
      });
    });
  } catch (err) {
    const message =
      err instanceof ServiceNotConfiguredError
        ? err.message
        : err instanceof Error
          ? err.message
          : "AI note generation failed for an unknown reason.";

    await db.processingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
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
