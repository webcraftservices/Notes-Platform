"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getMaterialIcon, getMaterialLabel } from "@/lib/material-style";
import type { NoteEligibleMaterial } from "@/lib/note-eligible-material";

export interface JobData {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  error: string | null;
}

export const POLL_MS = 3000;

/**
 * Submits an AI note-generation request for a specific material.
 * Supports both 202 (newly queued) and 200 (existing duplicate active job).
 */
export async function submitNoteGeneration(
  materialId: string
): Promise<{ ok: true; job: JobData } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/materials/${materialId}/generate-notes`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = body?.error ?? "Couldn't start AI note generation.";
      toast.error(error);
      return { ok: false, error };
    }
    if (!body?.job?.id) {
      const error = "Couldn't start AI note generation.";
      toast.error(error);
      return { ok: false, error };
    }
    toast.success("Generating AI notes… this can take a moment.");
    return { ok: true, job: body.job };
  } catch {
    const error = "Couldn't start AI note generation.";
    toast.error(error);
    return { ok: false, error };
  }
}

export interface SetupNoteGenerationPollingOptions {
  jobId: string;
  intervalMs?: number;
  onSucceeded?: (job: JobData) => void;
  onFailed?: (error: string) => void;
  onCancelled?: () => void;
  onUpdate?: (job: JobData) => void;
}

/**
 * Sets up active job status polling via GET /api/processing-jobs/[jobId].
 * Stops immediately on terminal statuses (SUCCEEDED, FAILED, CANCELLED) and
 * triggers callbacks exactly once. Returns a cancellation function.
 */
export function setupNoteGenerationPolling({
  jobId,
  intervalMs = POLL_MS,
  onSucceeded,
  onFailed,
  onCancelled,
  onUpdate,
}: SetupNoteGenerationPollingOptions): () => void {
  let isFetching = false;
  let completed = false;
  let eventSource: EventSource | null = null;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const stopAll = () => {
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
    if (eventSource) {
      try {
        eventSource.close();
      } catch {
        // Ignore close errors
      }
      eventSource = null;
    }
  };

  const applyJobState = (updated: JobData) => {
    if (completed) return;
    onUpdate?.(updated);

    if (updated.status === "SUCCEEDED") {
      completed = true;
      stopAll();
      toast.success("AI notes added to this topic's notes.");
      onSucceeded?.(updated);
    } else if (updated.status === "FAILED") {
      completed = true;
      stopAll();
      toast.error(updated.error ?? "AI note generation failed.");
      onFailed?.(updated.error ?? "AI note generation failed.");
    } else if (updated.status === "CANCELLED") {
      completed = true;
      stopAll();
      toast.error("AI note generation was cancelled.");
      onCancelled?.();
    }
  };

  if (typeof EventSource === "function") {
    try {
      eventSource = new EventSource(
        `/api/processing-jobs/stream?jobId=${encodeURIComponent(jobId)}`
      );
      eventSource.addEventListener("job-status", (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed?.job?.id && parsed?.job?.status) {
            applyJobState({
              id: parsed.job.id,
              status: parsed.job.status,
              error: parsed.job.error ?? null,
            });
          }
        } catch {
          // Ignore malformed event payloads; polling fallback remains active
        }
      });
      eventSource.onerror = () => {
        if (eventSource) {
          try {
            eventSource.close();
          } catch {
            // Ignore
          }
          eventSource = null;
        }
      };
    } catch {
      eventSource = null;
    }
  }

  intervalId = setInterval(async () => {
    if (isFetching || completed) return;
    isFetching = true;
    try {
      const res = await fetch(`/api/processing-jobs/${jobId}`);
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const updated: JobData | undefined = data?.job;
      if (!updated) return;

      applyJobState(updated);
    } finally {
      isFetching = false;
    }
  }, intervalMs);

  return () => {
    stopAll();
  };
}

/**
 * Handles AI note generation triggering and polling for topics.
 * Supports audio/video (via transcript) and documents (PDF, DOCX, PPTX, GOOGLE_DOC).
 *
 * UX states:
 * - One ready material, no processing: Single button.
 * - Multiple eligible materials (ready or ready + processing): Dropdown with icons, format labels, and disabled extracting items.
 * - Only processing materials: Disabled button indicating extraction in progress.
 * - No eligible materials: Empty state (handled by caller or returns null).
 */
export function GenerateAINotesButton({
  materials,
  onComplete,
  defaultOpen,
}: {
  materials: NoteEligibleMaterial[];
  onComplete: () => void;
  defaultOpen?: boolean;
}) {
  const [job, setJob] = useState<JobData | null>(null);
  const [starting, setStarting] = useState(false);

  const isActive = job?.status === "QUEUED" || job?.status === "RUNNING";

  const readyMaterials = materials.filter((m) => m.isReady);
  const processingMaterials = materials.filter((m) => m.isProcessing && !m.isReady);
  const readyCount = readyMaterials.length;
  const processingCount = processingMaterials.length;

  useEffect(() => {
    if (!isActive || !job) return;

    return setupNoteGenerationPolling({
      jobId: job.id,
      intervalMs: POLL_MS,
      onUpdate: (updated) => setJob(updated),
      onSucceeded: (updated) => {
        setJob(updated);
        onComplete();
      },
      onFailed: (err) => {
        setJob((prev) => (prev ? { ...prev, status: "FAILED", error: err } : null));
      },
      onCancelled: () => {
        setJob((prev) => (prev ? { ...prev, status: "CANCELLED" } : null));
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, job?.id, onComplete]);

  async function generateFrom(materialId: string) {
    setStarting(true);
    try {
      const result = await submitNoteGeneration(materialId);
      if (result.ok) {
        setJob(result.job);
      }
    } finally {
      setStarting(false);
    }
  }

  // No materials at all or no ready/processing materials
  if (materials.length === 0 || (readyCount === 0 && processingCount === 0)) {
    return null;
  }

  // Only processing materials exist: show a clear disabled/preparing state
  if (readyCount === 0 && processingCount > 0) {
    return (
      <Button variant="secondary" disabled className="cursor-not-allowed">
        <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />
        {processingCount === 1 ? "Extracting material…" : "Extracting materials…"}
      </Button>
    );
  }

  // Exactly one ready material and no processing materials: single button
  if (materials.length === 1 && readyCount === 1 && processingCount === 0) {
    const onlyMaterial = materials[0];
    if (!onlyMaterial) return null;
    return (
      <Button variant="secondary" loading={starting || isActive} onClick={() => generateFrom(onlyMaterial.id)}>
        <Sparkles className="h-4 w-4" />
        Generate AI Notes
      </Button>
    );
  }

  // Multiple eligible materials (multiple ready, or ready + processing)
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" loading={starting || isActive}>
          <Sparkles className="h-4 w-4" />
          Generate AI Notes
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {materials.map((material) => {
          const Icon = getMaterialIcon(material.type);
          const label = getMaterialLabel(material.type);
          const isProcessing = material.isProcessing && !material.isReady;
          const isSelectable = material.isReady && !isProcessing;
          const processingLabel =
            material.type === "AUDIO" || material.type === "VIDEO" ? "Transcribing…" : "Extracting…";

          return (
            <DropdownMenuItem
              key={material.id}
              disabled={!isSelectable}
              onClick={() => {
                if (isSelectable) {
                  generateFrom(material.id);
                }
              }}
            >
              <Icon className="mr-2 h-4 w-4 text-ink-muted dark:text-white/60" />
              <span className="truncate">{material.title}</span>
              {isProcessing ? (
                <span className="ml-auto flex items-center gap-1 pl-2 text-xs text-ink-faint dark:text-white/40">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {processingLabel}
                </span>
              ) : (
                <span className="ml-auto pl-2 text-xs text-ink-faint dark:text-white/40">
                  {label}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
