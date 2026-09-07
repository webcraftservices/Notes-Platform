import type { Material } from "@prisma/client";
import { db } from "@/lib/db";
import { getDocumentProcessingService } from "@/lib/services/document-processing";
import { runEmbeddingJob } from "@/lib/ingestion";
import { DOCUMENT_EXTRACTION_TYPES, shouldQueueDocumentExtraction } from "@/lib/document-extraction-guard";

/**
 * Queues a DOCUMENT_EXTRACTION job for a just-uploaded or just-imported
 * PDF/DOCX/PPTX Material and fires it, fire-and-forget — same execution
 * model (and same serverless caveat) as runTranscriptionJob/
 * runEmbeddingJob/runGoogleImportJob. Unlike audio/video transcription,
 * this is never a user-initiated action: extraction is local/free (no
 * paid API call), so there's no cost reason to gate it behind a manual
 * button the way transcription is gated.
 *
 * Safe to call unconditionally from both upload-completion paths: it
 * no-ops (returns null) for material types it doesn't handle, for
 * materials with no stored file yet, for materials that already have
 * extracted text (see shouldQueueDocumentExtraction), and if an
 * extraction job is already queued/running for this material (guards
 * against double-firing if a caller is retried).
 */
export async function queueDocumentExtractionIfNeeded(
  material: { id: string; type: Material["type"]; extractedText: string | null; storageKey: string | null },
  userId: string
): Promise<void> {
  if (!shouldQueueDocumentExtraction(material)) return;

  const existingActiveJob = await db.processingJob.findFirst({
    where: { materialId: material.id, type: "DOCUMENT_EXTRACTION", status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (existingActiveJob) return;

  const job = await db.processingJob.create({
    data: { userId, materialId: material.id, type: "DOCUMENT_EXTRACTION", status: "QUEUED" },
  });
  void runDocumentExtractionJob(job.id);
}

/**
 * Runs a single DOCUMENT_EXTRACTION job end to end: RUNNING → real
 * PDF/DOCX/PPTX text extraction (DocumentProcessingService) → save
 * Material.extractedText → SUCCEEDED (+ kick off EMBEDDING, same pattern
 * as runGoogleImportJob's Google Doc branch), or FAILED with a real error
 * message. Never fabricates extracted text (spec §92) — a corrupted or
 * unreadable file always surfaces as a failed job, never an empty-but-
 * successful one.
 *
 * A document with no extractable text (e.g. a scanned PDF with no text
 * layer) is NOT a failure: the job SUCCEEDS with extractedText left
 * empty, and no EMBEDDING job is queued (nothing to chunk/index). This
 * mirrors runEmbeddingJob's own "nothing to chunk yet" no-op for the same
 * reason — an empty result here isn't an error, it's an honest fact
 * about the source file.
 *
 * The Material's own `status` (READY) is left untouched on both success
 * and failure — extraction indexes a file for AI/RAG, it doesn't change
 * whether the file itself is viewable/downloadable, exactly like
 * transcription failure never reverts an audio Material out of READY.
 */
export async function runDocumentExtractionJob(jobId: string): Promise<void> {
  const job = await db.processingJob.findUnique({ where: { id: jobId } });
  if (!job || job.type !== "DOCUMENT_EXTRACTION" || !job.materialId) return;

  await db.processingJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    const material = await db.material.findUnique({ where: { id: job.materialId } });
    if (!material || !material.storageKey) {
      throw new Error("Material or its stored file could not be found.");
    }
    if (!DOCUMENT_EXTRACTION_TYPES.has(material.type)) {
      throw new Error(`DOCUMENT_EXTRACTION does not support material type ${material.type}.`);
    }

    const documentProcessing = getDocumentProcessingService();
    const result = await documentProcessing.extractText({
      storageKey: material.storageKey,
      mimeType: material.mimeType ?? "",
    });

    const text = result.text.trim();

    await db.material.update({
      where: { id: material.id },
      data: { extractedText: text.length > 0 ? text : null },
    });

    await db.processingJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
    });

    if (text.length > 0) {
      // Real, chunkable text is now available — index it right away,
      // same pattern as runGoogleImportJob's Google Doc branch and
      // runTranscriptionJob's post-success embedding trigger.
      const embeddingJob = await db.processingJob.create({
        data: { userId: job.userId, materialId: material.id, type: "EMBEDDING", status: "QUEUED" },
      });
      void runEmbeddingJob(embeddingJob.id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Document extraction failed for an unknown reason.";
    await db.processingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
  }
}
