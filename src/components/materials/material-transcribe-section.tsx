"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/materials/audio-player";
import { VideoViewer } from "@/components/materials/video-viewer";
import { ProcessingStatusBadge } from "@/components/materials/processing-status-badge";
import { formatDuration } from "@/lib/material-style";
import { cn } from "@/lib/utils";

interface JobData {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  error: string | null;
}

interface Segment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  speakerLabel: string | null;
  text: string;
}

interface TranscriptData {
  language: string | null;
  segments: Segment[];
}

const POLL_MS = 3000;

/**
 * Always shows the player (so the file is listenable/watchable regardless
 * of transcription status), plus whatever the transcription state actually
 * is below it: a "Transcribe" prompt, live QUEUED/RUNNING status (polled),
 * a failure with retry, or the real timestamped/speaker-labeled segment
 * list once done. One component owns this whole lifecycle so there's
 * never more than one audio/video player rendered for a given material.
 */
export function MaterialTranscribeSection({
  materialId,
  materialType,
  title,
  readUrl,
  initialTranscript,
  initialJob,
}: {
  materialId: string;
  materialType: "AUDIO" | "VIDEO";
  title: string;
  readUrl: string;
  initialTranscript: TranscriptData | null;
  initialJob: JobData | null;
}) {
  const [job, setJob] = useState<JobData | null>(initialJob);
  const [transcript, setTranscript] = useState<TranscriptData | null>(initialTranscript);
  const [starting, setStarting] = useState(false);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const playerRef = useRef<AudioPlayerHandle>(null);

  const isActive = job?.status === "QUEUED" || job?.status === "RUNNING";

  useEffect(() => {
    if (!isActive) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/materials/${materialId}`);
      if (!res.ok) return;
      const data = await res.json();
      setJob(data.latestTranscriptionJob);
      if (data.transcript) {
        setTranscript({ language: data.transcript.language, segments: data.transcript.segments });
      }
    }, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isActive, materialId]);

  async function handleTranscribe() {
    setStarting(true);
    try {
      const res = await fetch(`/api/materials/${materialId}/transcribe`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't start transcription.");
        return;
      }
      const { job: newJob } = await res.json();
      setJob(newJob);
    } finally {
      setStarting(false);
    }
  }

  function handleSegmentClick(segment: Segment) {
    setActiveSegmentId(segment.id);
    if (materialType === "AUDIO") {
      playerRef.current?.seek(segment.startSeconds);
      playerRef.current?.play();
    }
  }

  const showTranscript = job?.status === "SUCCEEDED" && transcript;
  const hasSpeakers = transcript?.segments.some((s) => s.speakerLabel) ?? false;

  return (
    <div className="space-y-4">
      {materialType === "AUDIO" ? (
        <AudioPlayer ref={playerRef} src={readUrl} title={title} />
      ) : (
        <VideoViewer src={readUrl} title={title} />
      )}

      <div className="card">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5 dark:border-line-dark">
          <h3 className="font-mono text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-white/30">
            Transcript
          </h3>
          {showTranscript && (
            <div className="flex items-center gap-2 text-[11px] text-ink-faint dark:text-white/30">
              {transcript.language && transcript.language !== "unknown" && (
                <span className="uppercase">{transcript.language}</span>
              )}
              {hasSpeakers && <span>· Speaker labels detected</span>}
            </div>
          )}
        </div>

        {!showTranscript ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            {!job ? (
              <>
                <p className="text-sm font-medium text-ink dark:text-white">Not transcribed yet</p>
                <p className="mt-1 max-w-xs text-sm text-ink-muted dark:text-white/50">
                  Send this to a cloud speech-to-text provider for a searchable, timestamped transcript.
                </p>
                <Button className="mt-4" loading={starting} onClick={handleTranscribe}>
                  Transcribe
                </Button>
              </>
            ) : job.status === "FAILED" ? (
              <>
                <div className="mb-3">
                  <ProcessingStatusBadge job={job} />
                </div>
                <Button variant="secondary" loading={starting} onClick={handleTranscribe}>
                  Try again
                </Button>
              </>
            ) : (
              <ProcessingStatusBadge job={job} />
            )}
          </div>
        ) : transcript.segments.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-faint dark:text-white/30">
            No speech was detected in this recording.
          </p>
        ) : (
          <div className="max-h-[60vh] divide-y divide-line overflow-y-auto dark:divide-line-dark">
            {transcript.segments.map((segment) => (
              <button
                key={segment.id}
                onClick={() => handleSegmentClick(segment)}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper dark:hover:bg-graphite-800",
                  activeSegmentId === segment.id && "bg-accent-soft hover:bg-accent-soft"
                )}
              >
                <span className="mt-0.5 shrink-0 font-mono text-[11px] text-ink-faint dark:text-white/30">
                  {formatDuration(segment.startSeconds)}
                </span>
                <div className="min-w-0">
                  {segment.speakerLabel && (
                    <span className="mb-0.5 block font-mono text-[11px] font-medium uppercase tracking-wide text-accent-strong">
                      {segment.speakerLabel}
                    </span>
                  )}
                  <p className="text-sm leading-relaxed text-ink dark:text-white/90">{segment.text}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
