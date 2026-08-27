import { db } from "@/lib/db";
import { chunkTranscriptSegments } from "@/lib/chunking";
import { getEmbeddingService, EMBEDDING_DIMENSIONS } from "@/lib/services/embedding";
import { ServiceNotConfiguredError } from "@/lib/services/interfaces";

/**
 * Runs a single EMBEDDING job end to end: RUNNING → chunk the material's
 * available text → embed each chunk → write MaterialChunk rows, or FAILED
 * + a real error message. Never writes a fake/zero embedding — a
 * misconfigured or failing EmbeddingService always surfaces as a failed
 * job with an actionable message (CLAUDE.md's "never fake a feature"
 * rule), exactly like runTranscriptionJob.
 *
 * Text source (Phase 5 state): only Transcript segments (audio/video
 * materials) are chunked. DocumentProcessingService (PDF/DOCX/PPTX text
 * extraction) has no concrete implementation yet — see ARCHITECTURE.md —
 * so materials of those types simply have no chunks to embed until that
 * lands; this job intentionally no-ops (SUCCEEDED with zero chunks
 * written) rather than failing for those types, since "nothing to index
 * yet" isn't an error.
 *
 * Triggered fire-and-forget from runTranscriptionJob immediately after a
 * transcription SUCCEEDED (see transcription.ts) — same execution model
 * and same serverless caveat as transcription jobs (see that file's doc
 * comment).
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

    // Nothing to chunk yet for this material type/state — a real,
    // successful no-op, not an error (see doc comment above).
    if (!transcript || transcript.status !== "READY" || transcript.segments.length === 0) {
      await db.processingJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
      });
      return;
    }

    const chunks = chunkTranscriptSegments(
      transcript.segments.map((s) => ({ text: s.text, startSeconds: s.startSeconds, endSeconds: s.endSeconds }))
    );

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

    const vectors = await embeddingService.embed(chunks.map((c) => c.content));
    if (vectors.length !== chunks.length) {
      throw new Error("EmbeddingService returned a different number of vectors than chunks were requested.");
    }

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
            (${crypto.randomUUID()}, ${material.id}, ${chunk.content}, ${chunk.order}, NULL,
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
