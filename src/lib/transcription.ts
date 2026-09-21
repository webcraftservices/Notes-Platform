import type { ProcessingJob } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorageService } from "@/lib/services/storage";
import { LocalStorageService } from "@/lib/services/storage-local";
import { S3StorageService } from "@/lib/services/storage-s3";
import { getSpeechService } from "@/lib/services/speech";
import { queueEmbeddingJob } from "@/lib/ingestion";
import { claimJob, failJob } from "@/lib/processing-jobs";

/**
 * Resolves raw audio bytes regardless of which storage backend is active.
 * Speech providers only ever see a Buffer — they never know or care
 * whether it came from local disk or S3, keeping them genuinely
 * swappable (spec §64).
 */
async function getAudioBuffer(storageKey: string): Promise<Buffer> {
  const storage = getStorageService();
  if (storage instanceof LocalStorageService) return storage.readFile(storageKey);
  if (storage instanceof S3StorageService) return storage.getObjectBuffer(storageKey);
  throw new Error("Unknown storage backend — cannot read audio bytes for transcription.");
}

/**
 * Runs a single TRANSCRIPTION job end to end: RUNNING → (real STT call) →
 * SUCCEEDED + Transcript/TranscriptSegment rows, or FAILED + a real error
 * message. Never writes a fake transcript — a misconfigured or failing
 * speech provider always surfaces as a failed job with an actionable
 * message, never as empty-but-successful output (spec §92).
 *
 * Called fire-and-forget from the /api/materials/[id]/transcribe route
 * (not awaited by the HTTP response) so the request returns immediately
 * and the client polls for status. This relies on the Node process
 * staying alive after the response is sent, which holds for `next dev`
 * and `next start` on a persistent server (Docker, a VM, etc.) but NOT
 * on request-scoped serverless platforms (e.g. Vercel functions, which
 * freeze the process once the response completes) — see
 * docs/ARCHITECTURE.md's Phase 4 notes for the production upgrade path
 * (a real queue: BullMQ+Redis, SQS, etc.) that removes this constraint.
 */
export async function runTranscriptionJob(jobId: string): Promise<void> {
  // Phase 9.4: every step — including the first two DB reads/writes — runs
  // inside this try, and the catch's own DB write (`failJob`) never
  // throws, so `void runTranscriptionJob(id)` at the call sites can never
  // turn a database blip into an unhandled promise rejection.
  let job: ProcessingJob | null = null;

  try {
    job = await db.processingJob.findUnique({ where: { id: jobId } });
    if (!job || job.type !== "TRANSCRIPTION" || !job.materialId) return;

    // Only one runner may execute a given job (see processing-jobs.ts).
    if (!(await claimJob(jobId))) return;

    const material = await db.material.findUnique({ where: { id: job.materialId } });
    if (!material || !material.storageKey) {
      throw new Error("Material or its stored file could not be found.");
    }

    const audioBuffer = await getAudioBuffer(material.storageKey);
    const speech = getSpeechService();
    const result = await speech.transcribe({
      audioBuffer,
      mimeType: material.mimeType ?? "audio/mpeg",
    });

    await db.$transaction(async (tx) => {
      const transcript = await tx.transcript.upsert({
        where: { materialId: material.id },
        create: {
          materialId: material.id,
          topicId: material.topicId,
          language: result.language,
          status: "READY",
          provider: process.env.SPEECH_PROVIDER ?? "unknown",
          fullText: result.segments.map((s) => s.text).join(" "),
        },
        update: {
          language: result.language,
          status: "READY",
          provider: process.env.SPEECH_PROVIDER ?? "unknown",
          fullText: result.segments.map((s) => s.text).join(" "),
        },
      });

      // Re-running transcription (e.g. after a failure) replaces segments
      // wholesale rather than trying to diff/merge them.
      await tx.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id } });
      if (result.segments.length > 0) {
        await tx.transcriptSegment.createMany({
          data: result.segments.map((s, i) => ({
            transcriptId: transcript.id,
            startSeconds: s.startSeconds,
            endSeconds: s.endSeconds,
            text: s.text,
            speakerLabel: s.speakerLabel ?? null,
            order: i,
          })),
        });
      }

      await tx.processingJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
      });
    });
  } catch (err) {
    // ServiceNotConfiguredError messages are already actionable and
    // user-safe, so every error type takes the same path here.
    await failJob(jobId, "TRANSCRIPTION", err, "Transcription failed for an unknown reason.");

    if (job?.materialId) {
      // A failed (re-)run must not demote a transcript that is already
      // READY and usable — only a not-yet-usable one is marked FAILED.
      await db.transcript
        .updateMany({ where: { materialId: job.materialId, status: { not: "READY" } }, data: { status: "FAILED" } })
        .catch(() => {});
    }
    return;
  }

  // Phase 5 integration point: a successful transcript is real,
  // chunkable text, so kick off indexing right away rather than making
  // the user take a separate action. Deliberately OUTSIDE the try above
  // (Phase 9.4): the transcript is already committed and the job already
  // SUCCEEDED, so a failure to *queue indexing* must not be reported as a
  // failed transcription — queueEmbeddingJob is best-effort and logs its
  // own failure. Same fire-and-forget execution model (and same
  // serverless caveat) as this function itself — see runEmbeddingJob's
  // doc comment. If no EmbeddingService is configured, that job will
  // honestly end up FAILED with a real configuration error rather than
  // silently doing nothing — the Topic's AI Chat tab surfaces that so it
  // isn't a silent gap.
  if (job?.materialId) await queueEmbeddingJob(job.userId, job.materialId);
}
