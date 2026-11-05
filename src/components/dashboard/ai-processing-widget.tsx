"use client";

import React, { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Sparkles,
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Ban,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { DashboardProcessingJob } from "@/lib/dashboard";
import type { JobStatus, JobType } from "@prisma/client";

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  TRANSCRIPTION: "Audio Transcription",
  OCR: "OCR Processing",
  DOCUMENT_EXTRACTION: "Document Extraction",
  AI_NOTE_GENERATION: "AI Note Generation",
  SUMMARY_GENERATION: "Summary Generation",
  QUESTION_GENERATION: "Question Generation",
  EMBEDDING: "Knowledge Indexing",
  FLASHCARD_GENERATION: "Flashcard Generation",
  QUIZ_GENERATION: "Quiz Generation",
  LINK_IMPORT: "Link Import",
  GOOGLE_SYNC: "Google Drive Sync",
};

/**
 * Returns a human-readable label for any JobType, with a safe fallback
 * for newly introduced or unrecognized job types.
 */
export function getJobTypeLabel(type: string): string {
  if (type in JOB_TYPE_LABELS) {
    return JOB_TYPE_LABELS[type as JobType];
  }
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Checks whether any displayed job is currently active (QUEUED or RUNNING).
 */
export function hasActiveProcessingJobs(jobs: DashboardProcessingJob[]): boolean {
  return jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING");
}

export function formatRelativeTime(date: Date | string | number): string {
  try {
    const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "";
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return "";
  }
}

export interface SetupActiveJobPollingOptions {
  jobs: DashboardProcessingJob[];
  intervalMs?: number;
  enabled?: boolean;
  onRefresh?: () => void;
  router?: { refresh: () => void };
  getVisibilityState?: () => DocumentVisibilityState;
}

/**
 * Pure lifecycle function managing polling interval.
 * Returns a cleanup function that cancels the active timer.
 */
export function setupActiveJobPolling({
  jobs,
  intervalMs = 5000,
  enabled = true,
  onRefresh,
  router,
  getVisibilityState = () =>
    typeof document !== "undefined" ? document.visibilityState : "visible",
}: SetupActiveJobPollingOptions): () => void {
  if (!enabled || !hasActiveProcessingJobs(jobs)) {
    return () => {};
  }

  let isRefreshing = false;

  const intervalId = setInterval(() => {
    // Skip polling if the browser tab is hidden
    if (getVisibilityState() === "hidden") {
      return;
    }

    // Prevent overlapping refresh calls
    if (isRefreshing) {
      return;
    }

    isRefreshing = true;
    try {
      if (onRefresh) {
        onRefresh();
      } else if (router) {
        router.refresh();
      }
    } finally {
      isRefreshing = false;
    }
  }, intervalMs);

  return () => {
    clearInterval(intervalId);
  };
}

export interface UseActiveJobPollingOptions {
  jobs: DashboardProcessingJob[];
  intervalMs?: number;
  enabled?: boolean;
  onRefresh?: () => void;
  router?: { refresh: () => void };
}

/**
 * React hook managing polling lifecycle with Next.js App Router transition.
 */
export function useActiveJobPolling({
  jobs,
  intervalMs = 5000,
  enabled = true,
  onRefresh,
  router: injectedRouter,
}: UseActiveJobPollingOptions) {
  let defaultRouter: { refresh: () => void };
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    defaultRouter = useRouter();
  } catch {
    defaultRouter = { refresh: () => {} };
  }
  const router = injectedRouter ?? defaultRouter;
  const [isPending, startTransition] = useTransition();

  const hasActiveJobs = hasActiveProcessingJobs(jobs);

  useEffect(() => {
    return setupActiveJobPolling({
      jobs,
      intervalMs,
      enabled,
      router: {
        refresh: () => {
          startTransition(() => {
            router.refresh();
          });
        },
      },
      onRefresh,
    });
  }, [enabled, hasActiveJobs, intervalMs, jobs, onRefresh, router]);

  return { hasActiveJobs, isRefreshing: isPending };
}

export function JobStatusBadge({
  status,
  progress,
}: {
  status: JobStatus | string;
  progress: number;
}) {
  switch (status) {
    case "QUEUED":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-ink-muted dark:bg-graphite-800 dark:text-white/60">
          <Clock className="h-3 w-3" />
          Queued
        </span>
      );
    case "RUNNING":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft/40 px-2.5 py-0.5 text-xs font-medium text-accent-strong dark:text-accent">
          <Loader2 className="h-3 w-3 animate-spin" />
          {typeof progress === "number" && progress > 0 && progress <= 100
            ? `Processing (${progress}%)`
            : "Processing"}
        </span>
      );
    case "SUCCEEDED":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-signal-success/10 px-2.5 py-0.5 text-xs font-medium text-signal-success">
          <CheckCircle2 className="h-3 w-3" />
          Completed
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-signal-danger/10 px-2.5 py-0.5 text-xs font-medium text-signal-danger">
          <AlertCircle className="h-3 w-3" />
          Failed
        </span>
      );
    case "CANCELLED":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-ink-faint dark:bg-graphite-800 dark:text-white/40">
          <Ban className="h-3 w-3" />
          Cancelled
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-ink-muted dark:bg-graphite-800 dark:text-white/50">
          {status}
        </span>
      );
  }
}

export function JobRow({ job }: { job: DashboardProcessingJob }) {
  const hasValidProgress =
    job.status === "RUNNING" &&
    typeof job.progress === "number" &&
    job.progress > 0 &&
    job.progress <= 100;

  return (
    <div className="card p-3.5 transition-shadow hover:shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold uppercase tracking-wider text-accent-strong dark:text-accent">
              {getJobTypeLabel(job.type)}
            </span>
            <span className="text-xs text-ink-faint dark:text-white/30">·</span>
            <span className="shrink-0 text-xs text-ink-faint dark:text-white/30">
              {formatRelativeTime(job.createdAt)}
            </span>
          </div>

          <div className="mt-1">
            {job.material ? (
              <Link
                href={`/materials/${job.material.id}`}
                className="block truncate text-sm font-medium text-ink hover:underline dark:text-white"
                title={job.material.title}
              >
                {job.material.title || "Untitled material"}
              </Link>
            ) : (
              <span className="block truncate text-sm italic text-ink-faint dark:text-white/40">
                No linked material
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0">
          <JobStatusBadge status={job.status} progress={job.progress} />
        </div>
      </div>

      {hasValidProgress && (
        <div className="mt-2.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-line dark:bg-line-dark">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>
      )}

      {job.status === "FAILED" && job.error && (
        <div className="mt-2 flex items-start gap-1.5 rounded bg-signal-danger/5 px-2.5 py-1.5 text-xs text-signal-danger">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">{job.error}</span>
        </div>
      )}
    </div>
  );
}

export function AiProcessingWidget({
  jobs,
  refreshIntervalMs = 5000,
  pollingEnabled = true,
}: {
  jobs: DashboardProcessingJob[];
  refreshIntervalMs?: number;
  pollingEnabled?: boolean;
}) {
  useActiveJobPolling({
    jobs,
    intervalMs: refreshIntervalMs,
    enabled: pollingEnabled,
  });

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No AI activity yet"
        description="Once you record or upload material, processing status will show up here."
      />
    );
  }

  return (
    <div className="space-y-2.5">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </div>
  );
}
