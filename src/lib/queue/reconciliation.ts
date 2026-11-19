/**
 * Phase 15 (Workstreams A & B) — Crash Recovery, Stranded Job Reconciliation,
 * Scheduled Watch-Channel Renewal, and Job Retention Cleanup.
 *
 * Closes Phase 14 `LIM-18` by ensuring:
 *   1. Stranded `QUEUED` or stale `RUNNING` `ProcessingJob` rows across
 *      `GOOGLE_SYNC`, `DOCUMENT_EXTRACTION`, `TRANSCRIPTION`, `EMBEDDING`, and
 *      `AI_NOTE_GENERATION` are automatically recovered and re-dispatched (or
 *      settled cleanly once retry limits are reached).
 *   2. Google Drive `Material` rows left in `status: "PROCESSING"` or
 *      `externalRef.syncStatus === "SYNCING"` after an interrupted sync/webhook
 *      are detected and re-queued for `GOOGLE_SYNC`.
 *   3. Expiring Google Drive watch channels are renewed on a recurring schedule
 *      even when users do not manually trigger `/api/integrations/google/sync`.
 */

import type { JobType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createJobIfNoneActiveWithin,
  INTERRUPTED_JOB_MESSAGE,
  notifyJobStatusChange,
  staleAfterMs,
} from "@/lib/processing-jobs";
import { renewExpiringWatchChannels } from "@/lib/google-drive-sync";
import { retryPendingOrphanStorageCleanups } from "@/lib/services/storage-cleanup";

export interface ReconciliationSummary {
  scannedJobs: number;
  requeuedJobs: number;
  failedExhaustedJobs: number;
  strandedMaterialsRecovered: number;
  requeuedJobIds: string[];
  failedJobIds: string[];
}

const RECONCILE_ELIGIBLE_TYPES: JobType[] = [
  "GOOGLE_SYNC",
  "DOCUMENT_EXTRACTION",
  "TRANSCRIPTION",
  "EMBEDDING",
  "AI_NOTE_GENERATION",
];

/** Minimum age before an unclaimed `QUEUED` job is considered stranded by a restart. */
export const DEFAULT_QUEUED_STRANDED_MS = 30_000;

/**
 * Reconciles stranded `ProcessingJob` rows and stuck Google Drive `PROCESSING`
 * materials, optionally re-dispatching recovered jobs through `dispatcher`.
 */
export async function reconcileStrandedProcessingJobs(
  options: {
    queuedStrandedAfterMs?: number;
    runningStaleOverrideMs?: number;
    maxJobs?: number;
    dispatchFn?: (jobId: string, type: JobType) => Promise<void> | void;
  } = {}
): Promise<ReconciliationSummary> {
  const queuedStrandedMs = options.queuedStrandedAfterMs ?? DEFAULT_QUEUED_STRANDED_MS;
  const maxJobs = options.maxJobs ?? 50;
  const now = Date.now();
  const queuedCutoff = new Date(now - queuedStrandedMs);

  const summary: ReconciliationSummary = {
    scannedJobs: 0,
    requeuedJobs: 0,
    failedExhaustedJobs: 0,
    strandedMaterialsRecovered: 0,
    requeuedJobIds: [],
    failedJobIds: [],
  };

  // Find candidate active jobs that are either QUEUED past the pickup window or RUNNING
  const candidates = await db.processingJob.findMany({
    where: {
      type: { in: RECONCILE_ELIGIBLE_TYPES },
      status: { in: ["QUEUED", "RUNNING"] },
    },
    orderBy: { createdAt: "asc" },
    take: maxJobs,
  });

  summary.scannedJobs = candidates.length;

  for (const job of candidates) {
    const staleThreshold = options.runningStaleOverrideMs ?? staleAfterMs(job.type);
    const runningCutoff = new Date(now - staleThreshold);
    const attempts = typeof job.attempts === "number" ? job.attempts : 0;
    const maxAttempts = typeof job.maxAttempts === "number" ? job.maxAttempts : 3;

    // For initial QUEUED jobs (attempts === 0), measure pickup wait from createdAt.
    // Once recovered (attempts > 0), measure from updatedAt so back-to-back reconciler
    // runs grant a fresh pickup grace window instead of burning retry attempts immediately.
    const queuedSince =
      attempts > 0 && job.updatedAt ? job.updatedAt : job.createdAt;
    const isStrandedQueued =
      job.status === "QUEUED" && queuedSince.getTime() <= queuedCutoff.getTime();
    const isStaleRunning =
      job.status === "RUNNING" &&
      ((job.startedAt && job.startedAt.getTime() <= runningCutoff.getTime()) ||
        (!job.startedAt && job.createdAt.getTime() <= runningCutoff.getTime()));

    if (!isStrandedQueued && !isStaleRunning) {
      continue;
    }

    // Check if the associated Material was soft-deleted
    if (job.materialId) {
      const mat = await db.material.findUnique({
        where: { id: job.materialId },
        select: { deletedAt: true, extractedText: true, storageKey: true },
      });
      if (!mat || mat.deletedAt !== null) {
        await db.processingJob.updateMany({
          where: { id: job.id, status: { in: ["QUEUED", "RUNNING"] } },
          data: { status: "CANCELLED", completedAt: new Date() },
        });
        notifyJobStatusChange({
          jobId: job.id,
          userId: job.userId,
          materialId: job.materialId,
          type: job.type,
          status: "CANCELLED",
        });
        continue;
      }
    }

    if (attempts + 1 <= maxAttempts) {
      // Optimistic CAS on (id, status, attempts) guarantees concurrent reconcilers cannot
      // double-increment attempts or dispatch duplicate recovery executions for one row.
      const { count } = await db.processingJob.updateMany({
        where: { id: job.id, status: job.status, attempts },
        data: {
          status: "QUEUED",
          startedAt: null,
          attempts: attempts + 1,
          error: null,
        },
      });
      if (count === 1) {
        summary.requeuedJobs += 1;
        summary.requeuedJobIds.push(job.id);
        notifyJobStatusChange({
          jobId: job.id,
          userId: job.userId,
          materialId: job.materialId,
          type: job.type,
          status: "QUEUED",
          progress: 0,
        });
        if (options.dispatchFn) {
          await options.dispatchFn(job.id, job.type);
        }
      }
    } else {
      // Retry budget exhausted: mark FAILED (CAS-guarded) and settle any stuck PROCESSING material
      const { count } = await db.processingJob.updateMany({
        where: { id: job.id, status: job.status, attempts },
        data: {
          status: "FAILED",
          error: INTERRUPTED_JOB_MESSAGE,
          completedAt: new Date(),
        },
      });
      if (count === 1) {
        summary.failedExhaustedJobs += 1;
        summary.failedJobIds.push(job.id);
        notifyJobStatusChange({
          jobId: job.id,
          userId: job.userId,
          materialId: job.materialId,
          type: job.type,
          status: "FAILED",
          error: INTERRUPTED_JOB_MESSAGE,
        });
        if (job.materialId) {
          await settleStrandedMaterial(job.materialId);
        }
      }
    }
  }

  // Also scan for Google Drive Materials stuck in status="PROCESSING" that have no
  // active GOOGLE_SYNC job (e.g., process crashed after Material update or job expired).
  if (typeof db.material?.findMany === "function") {
    const processingMaterials = await db.material.findMany({
      where: {
        deletedAt: null,
        status: "PROCESSING",
        createdAt: { lte: queuedCutoff },
      },
      take: maxJobs,
    });

    for (const mat of processingMaterials) {
      const ref = mat.externalRef as Record<string, unknown> | null;
      if (!ref || ref.provider !== "google_drive" || typeof ref.fileId !== "string") {
        continue;
      }

      const activeJob = await db.processingJob.findFirst({
        where: {
          materialId: mat.id,
          type: "GOOGLE_SYNC",
          status: { in: ["QUEUED", "RUNNING"] },
        },
      });
      if (activeJob) continue;

      // Check how many failed GOOGLE_SYNC jobs already exist for this material recently
      const recentFailedCount =
        typeof db.processingJob?.count === "function"
          ? await db.processingJob.count({
              where: {
                materialId: mat.id,
                type: "GOOGLE_SYNC",
                status: "FAILED",
              },
            })
          : 0;

      if (recentFailedCount >= 3) {
        await settleStrandedMaterial(mat.id);
        continue;
      }

      const created = await db.$transaction((tx) =>
        createJobIfNoneActiveWithin(tx, {
          userId: mat.ownerId,
          materialId: mat.id,
          type: "GOOGLE_SYNC",
        })
      );

      if (created.created && created.job) {
        summary.strandedMaterialsRecovered += 1;
        summary.requeuedJobIds.push(created.job.id);
        if (options.dispatchFn) {
          await options.dispatchFn(created.job.id, "GOOGLE_SYNC");
        }
      }
    }
  }

  // Best-effort durable retry of any pending OrphanStorageCleanup rows so failed
  // object deletions survive web/worker restarts without blocking job recovery.
  try {
    if (typeof retryPendingOrphanStorageCleanups === "function") {
      await retryPendingOrphanStorageCleanups();
    }
  } catch {
    // Non-fatal: storage outages will retry on the next reconciliation cycle.
  }

  return summary;
}

async function settleStrandedMaterial(materialId: string): Promise<void> {
  try {
    const mat = await db.material.findUnique({
      where: { id: materialId },
      select: { extractedText: true, storageKey: true, externalRef: true },
    });
    if (!mat) return;
    const hadPriorContent = mat.extractedText !== null || mat.storageKey !== null;
    const existingRef =
      mat.externalRef && typeof mat.externalRef === "object"
        ? (mat.externalRef as Record<string, unknown>)
        : null;
    const updatedRef =
      existingRef && existingRef.syncStatus === "SYNCING"
        ? ({ ...existingRef, syncStatus: "ERROR" } as Prisma.InputJsonValue)
        : undefined;

    await db.material.updateMany({
      where: { id: materialId, status: "PROCESSING" },
      data: {
        status: hadPriorContent ? "READY" : "FAILED",
        ...(updatedRef ? { externalRef: updatedRef } : {}),
      },
    });
  } catch {
    // Best-effort settlement
  }
}

/**
 * Executes scheduled Google Drive watch-channel renewal across all accounts
 * approaching expiration.
 */
export async function runScheduledWatchChannelRenewal(
  thresholdMs?: number
): Promise<{ checked: number; renewed: number; failed: number }> {
  return renewExpiringWatchChannels(thresholdMs);
}

/**
 * Prunes terminal `ProcessingJob` rows (`SUCCEEDED`, `FAILED`, `CANCELLED`) older
 * than `retentionDays` (default 30 days) to prevent unbounded database growth.
 */
export async function pruneCompletedProcessingJobs(
  retentionDays: number = 30
): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await db.processingJob.deleteMany({
    where: {
      status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
      completedAt: { lt: cutoff },
    },
  });
  return { deletedCount: count };
}

