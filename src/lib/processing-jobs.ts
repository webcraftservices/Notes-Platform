import type { JobType, Prisma, ProcessingJob } from "@prisma/client";
import { db } from "@/lib/db";
import { sendDatadogMetric } from "@/lib/observability/datadog";

/**
 * Phase 9.4 — small, shared lifecycle helpers for the fire-and-forget
 * ProcessingJob model (see docs/ARCHITECTURE.md → Audio/Transcription for
 * why this is deliberately not a queue). Nothing here changes that model;
 * it closes the specific gaps an audit of it found:
 *
 *   1. Check-then-create races. Every job-creating route used to do
 *      `findFirst(active job)` then `create`, two separate statements, so
 *      a double-click or a client retry after a network timeout could
 *      start two identical (and, for transcription, separately billed)
 *      jobs. `createJobIfNoneActive` makes that check-and-create atomic
 *      per (material, job type).
 *
 *   2. Jobs stranded by a process restart. A job runs inside the Node
 *      process that received the request; a deploy/restart/crash mid-job
 *      leaves its row QUEUED/RUNNING forever, and the "is a job already
 *      active?" guard then permanently blocks a retry. Active jobs older
 *      than any plausible runtime are treated as interrupted and marked
 *      FAILED (with an honest message) the next time someone asks for the
 *      same job.
 *
 *   3. Two runners for one job, and terminal-state clobbering. `claimJob`
 *      moves QUEUED → RUNNING atomically so only one runner proceeds, and
 *      `failJob` only ever writes FAILED over a job that is still
 *      QUEUED/RUNNING — a job that already reached SUCCEEDED is never
 *      flipped back to FAILED by a later, unrelated error.
 */

/**
 * How long an active job may sit in QUEUED/RUNNING before it is presumed
 * interrupted. Deliberately much longer than the longest legitimate run
 * of each type (AssemblyAI polling alone is capped at 20 minutes), so a
 * healthy long job is never reaped out from under itself.
 */
const STALE_AFTER_MS: Partial<Record<JobType, number>> = {
  TRANSCRIPTION: 45 * 60 * 1000,
  GOOGLE_SYNC: 45 * 60 * 1000, // up to 3 attempts × a 10-minute transfer budget, plus backoff
  EMBEDDING: 20 * 60 * 1000,
  DOCUMENT_EXTRACTION: 15 * 60 * 1000,
  AI_NOTE_GENERATION: 15 * 60 * 1000,
};
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

export const INTERRUPTED_JOB_MESSAGE =
  "This job was interrupted before it finished (the server may have restarted). Please try again.";

export function staleAfterMs(type: JobType): number {
  return STALE_AFTER_MS[type] ?? DEFAULT_STALE_AFTER_MS;
}

type JobInput = { userId: string; materialId: string; type: JobType };

/**
 * Atomically returns the active (QUEUED/RUNNING) job of this type for this
 * material, or creates a new QUEUED one. Serialized per (type, material)
 * with a transaction-scoped Postgres advisory lock — no schema change or
 * partial unique index needed, and the lock is released automatically when
 * the (very short) transaction ends.
 *
 * `created` tells the caller whether it owns a fresh job it must start.
 */
export async function createJobIfNoneActive(input: JobInput): Promise<{ job: ProcessingJob; created: boolean }> {
  return db.$transaction((tx) => createJobIfNoneActiveWithin(tx, input));
}

/** Same as createJobIfNoneActive, for a caller that already has a transaction open (e.g. creating a Material and its job together). */
export async function createJobIfNoneActiveWithin(
  tx: Prisma.TransactionClient,
  input: JobInput
): Promise<{ job: ProcessingJob; created: boolean }> {
  const { userId, materialId, type } = input;
  const cutoff = new Date(Date.now() - staleAfterMs(type));

  // `$executeRaw` (not `$queryRaw`): pg_advisory_xact_lock returns void,
  // which Prisma can't deserialize as a query result.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job:${type}:${materialId}`}, 0))`;

  await tx.processingJob.updateMany({
    where: {
      materialId,
      type,
      OR: [
        { status: "RUNNING", startedAt: { lt: cutoff } },
        { status: "QUEUED", createdAt: { lt: cutoff } },
      ],
    },
    data: { status: "FAILED", error: INTERRUPTED_JOB_MESSAGE, completedAt: new Date() },
  });

  const existing = await tx.processingJob.findFirst({
    where: { materialId, type, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { job: existing, created: false };

  const job = await tx.processingJob.create({ data: { userId, materialId, type, status: "QUEUED" } });
  return { job, created: true };
}

/** QUEUED → RUNNING, exactly once. Returns false if another runner (or the stale-job reaper) already took this job. */
export async function claimJob(jobId: string): Promise<boolean> {
  const { count } = await db.processingJob.updateMany({
    where: { id: jobId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  return count === 1;
}

/**
 * Records a job failure. Never throws — it is called from `catch` blocks
 * (and, transitively, from `void run...()` fire-and-forget call sites
 * that have nothing to catch a rejection), so a database error while
 * recording the failure must not become an unhandled promise rejection.
 * Only a job still QUEUED/RUNNING is overwritten; see module doc §3.
 *
 * The stored message is what the user sees in the UI, so it is capped in
 * length; callers must already have passed only user-safe text (provider
 * status + short reason — never prompts, transcripts, or retrieved
 * content).
 */
export async function failJob(jobId: string, type: JobType, err: unknown, fallbackMessage: string): Promise<void> {
  const raw = err instanceof Error && err.message ? err.message : fallbackMessage;
  const message = raw.length > 1000 ? `${raw.slice(0, 1000)}…` : raw;

  try {
    await db.processingJob.updateMany({
      where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
  } catch (writeErr) {
    console.error("[processing-jobs] could not record job failure", {
      jobId,
      type,
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }

  void sendDatadogMetric("processing_job.failures", 1, { type: "count", tags: [`job_type:${type}`] });
}
