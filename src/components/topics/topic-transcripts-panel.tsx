import Link from "next/link";
import { AudioLines, FileVideo, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDuration } from "@/lib/material-style";

export interface TranscribableMaterial {
  id: string;
  title: string;
  type: "AUDIO" | "VIDEO";
  durationSeconds: number | null;
  transcriptReady: boolean;
  jobStatus: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | null;
}

export function TopicTranscriptsPanel({ materials }: { materials: TranscribableMaterial[] }) {
  if (materials.length === 0) {
    return (
      <EmptyState
        icon={AudioLines}
        title="No recordings yet"
        description="Record a lecture or upload an existing audio/video file in the Materials tab to see transcripts here."
      />
    );
  }

  return (
    <div className="space-y-2">
      {materials.map((m) => (
        <Link
          key={m.id}
          href={`/materials/${m.id}`}
          className="card flex items-center justify-between gap-4 px-4 py-3.5 transition-shadow hover:shadow-panel"
        >
          <div className="flex min-w-0 items-center gap-3">
            {m.type === "AUDIO" ? (
              <AudioLines className="h-4 w-4 shrink-0 text-ink-faint" />
            ) : (
              <FileVideo className="h-4 w-4 shrink-0 text-ink-faint" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink dark:text-white">{m.title}</p>
              {m.durationSeconds ? (
                <p className="text-xs text-ink-faint dark:text-white/30">
                  {formatDuration(m.durationSeconds)}
                </p>
              ) : null}
            </div>
          </div>
          <StatusPill transcriptReady={m.transcriptReady} jobStatus={m.jobStatus} />
        </Link>
      ))}
    </div>
  );
}

function StatusPill({
  transcriptReady,
  jobStatus,
}: {
  transcriptReady: boolean;
  jobStatus: TranscribableMaterial["jobStatus"];
}) {
  if (transcriptReady) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-signal-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> Transcribed
      </span>
    );
  }
  if (jobStatus === "RUNNING") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted dark:text-white/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing
      </span>
    );
  }
  if (jobStatus === "QUEUED") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted dark:text-white/50">
        <Clock className="h-3.5 w-3.5" /> Queued
      </span>
    );
  }
  if (jobStatus === "FAILED") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-signal-danger">
        <AlertCircle className="h-3.5 w-3.5" /> Failed
      </span>
    );
  }
  return <span className="shrink-0 text-xs text-ink-faint dark:text-white/30">Not transcribed</span>;
}
