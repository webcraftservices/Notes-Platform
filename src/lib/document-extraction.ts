import { Prisma, type Material, type ProcessingJob } from "@prisma/client";
import { db } from "@/lib/db";
import { getDocumentProcessingService } from "@/lib/services/document-processing";
import { queueEmbeddingJob } from "@/lib/ingestion";
import { claimJob, createJobIfNoneActive, failJob } from "@/lib/processing-jobs";
import { DOCUMENT_EXTRACTION_TYPES, resolveExtractedPages, shouldQueueDocumentExtraction } from "@/lib/document-extraction-guard";

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

  // Atomic "one active extraction per material" (Phase 9.4 — this used to
  // be a separate findFirst + create, which two overlapping callers, e.g.
  // a retried /complete request, could both pass).
  try {
    const { job, created } = await createJobIfNoneActive({
      userId,
      materialId: material.id,
      type: "DOCUMENT_EXTRACTION",
    });
    if (!created) return;
    void runDocumentExtractionJob(job.id);
  } catch (err) {
    // Callers fire this without awaiting it (`void queue...(...)`), so a
    // rejection here would be unhandled. The upload/import that led here
    // has already succeeded; the material stays READY and extraction can
    // be retried by re-completing/re-importing.
    console.error("[document-extraction] could not queue extraction job", {
      materialId: material.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Runs a single DOCUMENT_EXTRACTION job end to end: RUNNING → real
 * PDF/DOCX/PPTX text extraction (DocumentProcessingService) → save
 * Material.extractedText (+ Material.extractedPages when the extractor
 * returned page-level text — PDF pages, PPTX slides) → SUCCEEDED (+ kick
 * off EMBEDDING, same pattern as runGoogleImportJob's Google Doc branch),
 * or FAILED with a real error message. Never fabricates extracted text or
 * page data (spec §92) — a corrupted or unreadable file always surfaces
 * as a failed job, never an empty-but-successful one.
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
  // Phase 9.4: see runTranscriptionJob — everything runs inside the try
  // and `failJob` never throws.
  let job: ProcessingJob | null = null;

  try {
    job = await db.processingJob.findUnique({ where: { id: jobId } });
    if (!job || job.type !== "DOCUMENT_EXTRACTION" || !job.materialId) return;
    if (!(await claimJob(jobId))) return;

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
    // Only persisted when the extractor actually produced page-level text
    // (PDF pages, PPTX slides — see document-processing-local.ts). DOCX
    // has no page concept and result.pages is undefined for it, same as
    // for a PDF/PPTX that (unusually) came back with zero pages — never
    // fabricated, left null exactly like extractedText is left null for
    // no extractable text.
    const pages = resolveExtractedPages(result);

    // Text and job completion are committed together: previously these
    // were two statements, so a failure between them left extracted text
    // saved but the job reported FAILED.
    await db.$transaction([
      db.material.update({
        where: { id: material.id },
        data: {
          extractedText: text.length > 0 ? text : null,
          // Nullable Json fields require the explicit Prisma.DbNull sentinel
          // to write a real SQL NULL — passing plain `null` here is a type
          // error under Prisma's advanced JSON-null handling (the default
          // since Prisma 3+, still in effect at the ^5.20.0 pinned in this
          // project).
          extractedPages: pages ? (pages as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      }),
      db.processingJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
      }),
    ]);

    if (text.length > 0) {
      // Real, chunkable text is now available — index it right away,
      // same pattern as runGoogleImportJob's Google Doc branch and
      // runTranscriptionJob's post-success embedding trigger. Best-effort
      // (queueEmbeddingJob never throws): extraction itself already
      // succeeded and must stay reported as such.
      await queueEmbeddingJob(job.userId, material.id);
    }
  } catch (err) {
    await failJob(jobId, "DOCUMENT_EXTRACTION", err, "Document extraction failed for an unknown reason.");
  }
}
