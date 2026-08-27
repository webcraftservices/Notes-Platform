"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TranscribableMaterial } from "@/components/topics/topic-transcripts-panel";

interface JobData {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  error: string | null;
}

const POLL_MS = 3000;

/**
 * Only shown when at least one of this topic's materials has a READY
 * transcript (the caller — NotesTabPanel — already filters for that).
 * With exactly one eligible material this is a single button; with more
 * than one, a dropdown lets the user pick which lecture to generate from
 * (spec §14's "AI should understand the lecture", singular — generation
 * is always scoped to one source recording, see runNoteGenerationJob's
 * doc comment for why).
 */
export function GenerateAINotesButton({
  materials,
  onComplete,
}: {
  materials: TranscribableMaterial[];
  onComplete: () => void;
}) {
  const [job, setJob] = useState<JobData | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const isActive = job?.status === "QUEUED" || job?.status === "RUNNING";

  useEffect(() => {
    if (!isActive || !job) return;
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/processing-jobs/${job.id}`);
      if (!res.ok) return;
      const { job: updated } = await res.json();
      setJob(updated);
      if (updated.status === "SUCCEEDED") {
        toast.success("AI notes added to this topic's notes.");
        onComplete();
      } else if (updated.status === "FAILED") {
        toast.error(updated.error ?? "AI note generation failed.");
      }
    }, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, job?.id]);

  async function generateFrom(materialId: string) {
    setStarting(true);
    try {
      const res = await fetch(`/api/materials/${materialId}/generate-notes`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't start AI note generation.");
        return;
      }
      setJob(body.job);
      toast.success("Generating AI notes… this can take a moment.");
    } finally {
      setStarting(false);
    }
  }

  if (materials.length === 1) {
    const onlyMaterial = materials[0];
    if (!onlyMaterial) return null;
    return (
      <Button variant="secondary" loading={starting || isActive} onClick={() => generateFrom(onlyMaterial.id)}>
        <Sparkles className="h-4 w-4" />
        Generate AI Notes
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" loading={starting || isActive}>
          <Sparkles className="h-4 w-4" />
          Generate AI Notes
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {materials.map((material) => (
          <DropdownMenuItem key={material.id} onClick={() => generateFrom(material.id)}>
            {material.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
