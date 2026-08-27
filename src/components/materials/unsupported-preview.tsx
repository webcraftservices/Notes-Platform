"use client";

import { FileType } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * DOCX/PPTX previews would require converting the file server-side (or
 * shipping a heavy client-side renderer) — that's real processing work
 * this phase doesn't do, so this is honest about not rendering it rather
 * than faking a preview. Download still works; the file itself is real
 * and safely stored either way.
 */
export function UnsupportedPreview({ materialId, label }: { materialId: string; label: string }) {
  async function handleDownload() {
    const res = await fetch(`/api/materials/${materialId}`);
    if (!res.ok) {
      toast.error("Couldn't load this file.");
      return;
    }
    const { readUrl } = await res.json();
    if (!readUrl) {
      toast.error("This file isn't ready yet.");
      return;
    }
    window.open(`${readUrl}${readUrl.includes("?") ? "&" : "?"}download=1`, "_blank");
  }

  return (
    <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
      <FileType className="mb-3 h-6 w-6 text-ink-faint" strokeWidth={1.5} />
      <p className="text-sm font-medium text-ink dark:text-white">No in-app preview for {label} yet</p>
      <p className="mt-1 max-w-xs text-sm text-ink-muted dark:text-white/50">
        The file is stored safely — download it to view it for now.
      </p>
      <Button variant="secondary" className="mt-4" onClick={handleDownload}>
        Download
      </Button>
    </div>
  );
}
