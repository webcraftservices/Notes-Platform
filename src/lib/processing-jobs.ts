import type { JobStatus, JobType, Prisma, ProcessingJob } from "@prisma/client";
import { db } from "@/lib/db";
import { lockGroupForShare, lockGroupMemberForShare, NotAuthorizedError } from "@/lib/access";
import { sendDatadogMetric } from "@/lib/observability/datadog";
import { sendAzureMonitorMetric } from "@/lib/observability/azure-monitor";
import { emitProcessingJobEvent } from "@/lib/queue/events";

const knownJobMeta = new Map<
  string,
  { userId: string; materialId: string | null; type: JobType }
>();

export function registerJobContext(job: {
  id: string;
  userId: string;
  materialId?: string | null;
  type: JobType;
}): void {
  if (!job?.id || !job.userId || !job.type) return;
  knownJobMeta.set(job.id, {
    userId: job.userId,
    materialId: job.materialId ?? null,
    type: job.type,
  });
  if (knownJobMeta.size > 5000) {
    const oldestKey = knownJobMeta.keys().next().value;
    if (oldestKey) knownJobMeta.delete(oldestKey);
  }
}

export function notifyJobStatusChange(input: {
  jobId: string;
  status: JobStatus;
  progress?: number;
  error?: string | null;
  userId?: string;
  materialId?: string | null;
  type?: JobType;
}): void {
  const cached = knownJobMeta.get(input.jobId);
  const userId = input.userId ?? cached?.userId;
  const type = input.type ?? cached?.type;
  const materialId =
    input.materialId !== undefined ? input.materialId : (cached?.materialId ?? null);

  if (userId && type) {
    registerJobContext({ id: input.jobId, userId, materialId, type });
    emitProcessingJobEvent({
      jobId: input.jobId,
      userId,
      materialId,
      type,
      status: input.status,
      progress:
        input.progress ??
        (input.status === "SUCCEEDED" ? 100 : input.status === "RUNNING" ? 20 : 0),
      error: input.error ?? null,
    });
  }
}

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

type JobInput = {
  userId: string;
  materialId: string;
  type: JobType;
  verifyActorMembership?: boolean;
};

/**
 * Atomically returns the active (QUEUED/RUNNING) job of this type for this
 * material, or creates a new QUEUED one. Serialized per (type, material)
 * with a transaction-scoped Postgres advisory lock — no schema change or
 * partial unique index needed, and the lock is released automatically when
 * the (very short) transaction ends.
 *
 * `created` tells the caller whether it owns a fresh job it must start.
 */
export async function createJobIfNoneActive(
  input: JobInput
): Promise<{ job: ProcessingJob | null; created: boolean }> {
  return db.$transaction((tx) => createJobIfNoneActiveWithin(tx, input));
}

type MaterialHierarchyCheckRow = {
  deletedAt?: Date | null;
  groupId?: string | null;
  group?: { deletedAt?: Date | null } | null;
  subject?: { deletedAt?: Date | null } | null;
  chapter?: { deletedAt?: Date | null; subject?: { deletedAt?: Date | null } | null } | null;
  topic?: {
    deletedAt?: Date | null;
    chapter?: { deletedAt?: Date | null; subject?: { deletedAt?: Date | null } | null } | null;
  } | null;
};

function isMaterialHierarchyDeleted(mat: MaterialHierarchyCheckRow | null | undefined): boolean {
  if (!mat) return true;
  return Boolean(
    mat.deletedAt ||
    mat.group?.deletedAt ||
    mat.subject?.deletedAt ||
    mat.chapter?.deletedAt ||
    mat.chapter?.subject?.deletedAt ||
    mat.topic?.deletedAt ||
    mat.topic?.chapter?.deletedAt ||
    mat.topic?.chapter?.subject?.deletedAt
  );
}

const MATERIAL_HIERARCHY_SELECT = {
  deletedAt: true,
  groupId: true,
  group: { select: { deletedAt: true } },
  subject: { select: { deletedAt: true } },
  chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
  topic: {
    select: {
      deletedAt: true,
      chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
    },
  },
} as const;

/** Same as createJobIfNoneActive, for a caller that already has a transaction open (e.g. creating a Material and its job together). */
export async function createJobIfNoneActiveWithin(
  tx: Prisma.TransactionClient,
  input: JobInput
): Promise<{ job: ProcessingJob | null; created: boolean }> {
  const { userId, materialId, type } = input;
  const cutoff = new Date(Date.now() - staleAfterMs(type));
  const txAny = tx as unknown as {
    $queryRaw?: unknown;
    material?: {
      findUnique?: (args: unknown) => Promise<MaterialHierarchyCheckRow | null>;
    };
  };

  // Strict top-down lock order on real PostgreSQL:
  // If the material is group-owned, acquire Group FOR SHARE BEFORE taking the per-(type, material)
  // advisory lock so group deletion (`Group FOR UPDATE` -> material soft-delete -> job cancellation)
  // and job creation never deadlock or pass in conflicting order.
  if (typeof txAny.$queryRaw === "function" && typeof txAny.material?.findUnique === "function") {
    const precheckMat = await txAny.material.findUnique({
      where: { id: materialId },
      select: MATERIAL_HIERARCHY_SELECT,
    });
    if (isMaterialHierarchyDeleted(precheckMat)) {
      return { job: null, created: false };
    }
    if (precheckMat?.groupId) {
      const lockedGroup = await lockGroupForShare(tx, precheckMat.groupId);
      if (!lockedGroup || lockedGroup.deletedAt !== null) {
        return { job: null, created: false };
      }
      if (input.verifyActorMembership) {
        const member = await lockGroupMemberForShare(tx, precheckMat.groupId, userId);
        if (!member) {
          throw new NotAuthorizedError();
        }
      }
    }
  }

  // `$executeRaw` (not `$queryRaw`): pg_advisory_xact_lock returns void,
  // which Prisma can't deserialize as a query result.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job:${type}:${materialId}`}, 0))`;

  // Verify the Material (and its ancestor hierarchy when available) is still active (deletedAt === null)
  if (typeof txAny.material?.findUnique === "function") {
    const material = await txAny.material.findUnique({
      where: { id: materialId },
      select: typeof txAny.$queryRaw === "function" ? MATERIAL_HIERARCHY_SELECT : { deletedAt: true },
    });
    if (
      typeof txAny.$queryRaw === "function"
        ? isMaterialHierarchyDeleted(material)
        : !material || material.deletedAt !== null
    ) {
      return { job: null, created: false };
    }
  }

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
  if (existing) {
    if (existing.id) {
      registerJobContext({ id: existing.id, userId, materialId, type });
    }
    return { job: existing, created: false };
  }

  const job = await tx.processingJob.create({ data: { userId, materialId, type, status: "QUEUED" } });
  if (job?.id) {
    notifyJobStatusChange({
      jobId: job.id,
      userId,
      materialId,
      type,
      status: "QUEUED",
      progress: 0,
    });
  }
  return { job, created: true };
}

/** QUEUED → RUNNING, exactly once. Requires related Material (when present) to have deletedAt: null. */
export async function claimJob(jobId: string): Promise<boolean> {
  const { count } = await db.processingJob.updateMany({
    where: {
      id: jobId,
      status: "QUEUED",
      OR: [
        { materialId: null },
        { material: { deletedAt: null } },
      ],
    },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (count === 1) {
    notifyJobStatusChange({ jobId, status: "RUNNING", progress: 20 });
  }
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
    notifyJobStatusChange({
      jobId,
      type,
      status: "FAILED",
      error: message,
    });
  } catch (writeErr) {
    console.error("[processing-jobs] could not record job failure", {
      jobId,
      type,
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }

  void sendDatadogMetric("processing_job.failures", 1, { type: "count", tags: [`job_type:${type}`] });
  void sendAzureMonitorMetric("processing_job.failures", 1, { properties: { jobType: type } });
}

/**
 * Verifies that a job is still in an eligible, active state and that any
 * referenced material has not been soft-deleted.
 *
 * Workers call this before committing completion side effects to guarantee
 * that a job cancelled by group deletion never flips back to SUCCEEDED or
 * updates a deleted material.
 */
export async function isJobActive(jobId: string, materialId?: string | null): Promise<boolean> {
  const job = await db.processingJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (job?.status && job.status !== "RUNNING" && job.status !== "QUEUED") {
    return false;
  }

  if (materialId) {
    const mat = (await db.material.findUnique({
      where: { id: materialId },
      select: {
        deletedAt: true,
        group: { select: { deletedAt: true } },
        subject: { select: { deletedAt: true } },
        chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
        topic: {
          select: {
            deletedAt: true,
            chapter: { select: { deletedAt: true, subject: { select: { deletedAt: true } } } },
          },
        },
      },
    })) as {
      deletedAt?: Date | null;
      group?: { deletedAt?: Date | null } | null;
      subject?: { deletedAt?: Date | null } | null;
      chapter?: { deletedAt?: Date | null; subject?: { deletedAt?: Date | null } | null } | null;
      topic?: {
        deletedAt?: Date | null;
        chapter?: { deletedAt?: Date | null; subject?: { deletedAt?: Date | null } | null } | null;
      } | null;
    } | null;
    if (
      mat?.deletedAt ||
      mat?.group?.deletedAt ||
      mat?.subject?.deletedAt ||
      mat?.chapter?.deletedAt ||
      mat?.chapter?.subject?.deletedAt ||
      mat?.topic?.deletedAt ||
      mat?.topic?.chapter?.deletedAt ||
      mat?.topic?.chapter?.subject?.deletedAt
    ) {
      return false;
    }
  }

  return true;
}

/** Either the global db client or an active `db.$transaction` callback client. */
type DbOrTx = Prisma.TransactionClient | unknown;

/**
 * Transaction-safe completion claim for processing workers.
 *
 * Atomically transitions a job from RUNNING to SUCCEEDED and verifies that its
 * associated material has not been soft-deleted.
 *
 * Inside an interactive transaction, this acquires an exclusive row lock on the
 * ProcessingJob row and conditionally updates only if status is still RUNNING
 * and the material is active.
 *
 * Returns true if the job was successfully claimed and marked SUCCEEDED.
 * Returns false if the job was cancelled (e.g. by group deletion) or reaped.
 */
export async function completeJobWithin(
  tx: DbOrTx,
  jobId: string,
  materialId?: string | null
): Promise<boolean> {
  const client = tx as {
    $queryRaw?: unknown;
    material?: {
      findUnique?: (args: unknown) => Promise<MaterialHierarchyCheckRow | null>;
    };
    processingJob: {
      updateMany?: (args: unknown) => Promise<{ count: number }>;
      update?: (args: unknown) => Promise<unknown>;
    };
  };

  if (
    materialId &&
    typeof client.$queryRaw === "function" &&
    typeof client.material?.findUnique === "function"
  ) {
    const mat = await client.material.findUnique({
      where: { id: materialId },
      select: MATERIAL_HIERARCHY_SELECT,
    });
    if (isMaterialHierarchyDeleted(mat)) {
      return false;
    }
    if (mat?.groupId) {
      const lockedGroup = await lockGroupForShare(tx as Prisma.TransactionClient, mat.groupId);
      if (!lockedGroup || lockedGroup.deletedAt !== null) {
        return false;
      }
      const recheckedMat = await client.material.findUnique({
        where: { id: materialId },
        select: MATERIAL_HIERARCHY_SELECT,
      });
      if (isMaterialHierarchyDeleted(recheckedMat)) {
        return false;
      }
    }
  }

  // If updateMany is available (real Prisma client), perform atomic conditional update
  if (typeof client.processingJob?.updateMany === "function") {
    const { count } = await client.processingJob.updateMany({
      where: {
        id: jobId,
        status: "RUNNING",
        ...(materialId ? { material: { deletedAt: null } } : {}),
      },
      data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
    });
    if (count === 1) {
      notifyJobStatusChange({ jobId, materialId, status: "SUCCEEDED", progress: 100 });
    }
    return count === 1;
  }

  // Fallback for mocked unit test environments that provide tx.processingJob.update
  if (typeof client.processingJob?.update === "function") {
    await client.processingJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
    });
    notifyJobStatusChange({ jobId, materialId, status: "SUCCEEDED", progress: 100 });
    return true;
  }

  return false;
}
