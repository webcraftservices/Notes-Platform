import { db } from "@/lib/db";
import { chunkPagedText, chunkTranscriptSegments, chunkText, parseExtractedPages, type TextChunk } from "@/lib/chunking";
import { getEmbeddingService, EMBEDDING_DIMENSIONS } from "@/lib/services/embedding";
import { ServiceNotConfiguredError } from "@/lib/services/interfaces";
import { recordAIUsage } from "@/lib/ai-usage";

/**
 * Runs a single EMBEDDING job end to end: RUNNING → chunk the material's
 * available text → embed each chunk → write MaterialChunk rows, or FAILED
 * + a real error message. Never writes a fake/zero embedding — a
 * misconfigured or failing EmbeddingService always surfaces as a failed
 * job with an actionable message (CLAUDE.md's "never fake a feature"
 * rule), exactly like runTranscriptionJob.
 *
 * Text source, in priority order:
 *   1. Transcript segments (audio/video materials), chunked with
 *      chunkTranscriptSegments so each chunk keeps its startSeconds/
 *      endSeconds.
 *   2. Material.extractedPages (PDF pages, PPTX slides — populated by
 *      runDocumentExtractionJob, see document-extraction.ts), chunked
 *      per-page with chunkPagedText so each chunk keeps its pageNumber
 *      and a citation can read "PDF • Page X".
 *   3. Material.extractedText (populated by runDocumentExtractionJob for
 *      DOCX, or by the Phase 7 Google Docs importer — see
 *      lib/google-import.ts), chunked with the generic chunkText(),
 *      producing chunks with no timestamp and no page number. This is
 *      also the fallback for any PDF/PPTX material whose extractedPages
 *      predates this pipeline change (extractedText only, extractedPages
 *      null) — it keeps working exactly as it did before, just without
 *      page citations, rather than needing reprocessing.
 *
 * If none of the above have usable text yet, this job intentionally
 * no-ops (SUCCEEDED with zero chunks written) rather than failing, since
 * "nothing to index yet" isn't an error.
 *
 * Triggered fire-and-forget from runTranscriptionJob immediately after a
 * transcription SUCCEEDED (see transcription.ts), and equivalently from
 * runDocumentExtractionJob/runGoogleImportJob after a document's text is
 * extracted — same execution model and same serverless caveat as
 * transcription jobs (see that file's doc comment).
 */
export async function runEmbeddingJob(jobId: string): Promise<void> {
  const job = await db.processingJob.findUnique({ where: { id: jobId } });
  if (!job || job.type !== "EMBEDDING" || !job.materialId) return;

  await db.processingJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    const material = await db.material.findUnique({ where: { id: job.materialId } });
    if (!material) throw new Error("Material could not be found.");

    const transcript =
      material.type === "AUDIO" || material.type === "VIDEO"
        ? await db.transcript.findUnique({
            where: { materialId: material.id },
            include: { segments: { orderBy: { order: "asc" } } },
          })
        : null;

    let chunks: (TextChunk & { pageNumber: number | null; startSeconds: number | null; endSeconds: number | null })[];

    const extractedPages = parseExtractedPages(material.extractedPages);

    if (transcript && transcript.status === "READY" && transcript.segments.length > 0) {
      chunks = chunkTranscriptSegments(
        transcript.segments.map((s) => ({ text: s.text, startSeconds: s.startSeconds, endSeconds: s.endSeconds }))
      ).map((c) => ({ ...c, pageNumber: null }));
    } else if (extractedPages) {
      chunks = chunkPagedText(extractedPages).map((c) => ({ ...c, startSeconds: null, endSeconds: null }));
    } else if (material.extractedText && material.extractedText.trim().length > 0) {
      chunks = chunkText(material.extractedText).map((c) => ({ ...c, pageNumber: null, startSeconds: null, endSeconds: null }));
    } else {
      // Nothing to chunk yet for this material type/state — a real,
      // successful no-op, not an error (see doc comment above).
      await db.processingJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
      });
      return;
    }

    if (chunks.length === 0) {
      await db.processingJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
      });
      return;
    }

    // Getting the service (and thus throwing ServiceNotConfiguredError if
    // no provider is wired up — always true in this phase, see
    // lib/services/embedding.ts) happens BEFORE any DB writes, so a
    // misconfigured environment never leaves behind partial/empty chunks.
    const embeddingService = getEmbeddingService();
    if (embeddingService.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `EmbeddingService reports ${embeddingService.dimensions} dimensions, but MaterialChunk.embedding ` +
          `is a fixed vector(${EMBEDDING_DIMENSIONS}) column. This provider cannot be used without a ` +
          "deliberate schema migration — see docs/ai-setup.md."
      );
    }

    const { vectors, totalTokens } = await embeddingService.embed(chunks.map((c) => c.content));
    if (vectors.length !== chunks.length) {
      throw new Error("EmbeddingService returned a different number of vectors than chunks were requested.");
    }

    // Recorded once the embedding call itself has actually succeeded (real
    // vectors returned), same "record after success, never block on it"
    // semantics as the chat path in messages/route.ts — see lib/ai-usage.ts.
    // material.ownerId is always set for a user-owned Material; group-owned
    // materials still carry the uploading user's id there, so usage is
    // always attributed to a real person, never shared group-wide (spec §10).
    await recordAIUsage({
      userId: material.ownerId,
      workspaceId: material.workspaceId,
      category: "embedding",
      provider: embeddingService.providerName,
      model: embeddingService.modelName,
      tokensInput: totalTokens,
      context: { materialId: material.id, chunkCount: chunks.length },
    });

    await db.$transaction(async (tx) => {
      await tx.materialChunk.deleteMany({ where: { materialId: material.id } });

      for (const [i, chunk] of chunks.entries()) {
        const vector = vectors[i];
        if (!vector) throw new Error("EmbeddingService returned fewer vectors than chunks were requested.");
        const vectorLiteral = `[${vector.join(",")}]`;
        // MaterialChunk.embedding is Unsupported("vector(1536)") in the
        // Prisma schema — the typed client can neither read nor write it,
        // so raw SQL is required for this one column. Every other field
        // still goes through normal parameterized values.
        await tx.$executeRaw`
          INSERT INTO "MaterialChunk"
            (id, "materialId", content, "order", "pageNumber", "startSeconds", "endSeconds", "tokenCount", embedding, "createdAt")
          VALUES
            (${crypto.randomUUID()}, ${material.id}, ${chunk.content}, ${chunk.order}, ${chunk.pageNumber},
             ${chunk.startSeconds}, ${chunk.endSeconds}, ${chunk.tokenCount}, ${vectorLiteral}::vector, now())
        `;
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
          : "Indexing failed for an unknown reason.";

    await db.processingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
  }
}
