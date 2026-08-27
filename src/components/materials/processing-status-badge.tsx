import { Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";

interface Job {
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  error?: string | null;
}

/**
 * Cloud speech providers don't report granular progress — an honest
 * "Transcribing… this can take a few minutes" beats a fabricated
 * percentage bar (spec §92). QUEUED/RUNNING both just show activity.
 */
export function ProcessingStatusBadge({ job }: { job: Job }) {
  if (job.status === "QUEUED") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-ink-muted dark:text-white/50">
        <Clock className="h-3.5 w-3.5" />
        Queued
      </span>
    );
  }
  if (job.status === "RUNNING") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-ink-muted dark:text-white/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Transcribing… this can take a few minutes for longer recordings
      </span>
    );
  }
  if (job.status === "SUCCEEDED") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-signal-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Transcribed
      </span>
    );
  }
  if (job.status === "FAILED") {
    return (
      <span className="flex items-start gap-1.5 text-sm text-signal-danger">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{job.error || "Transcription failed."}</span>
      </span>
    );
  }
  return null;
}
