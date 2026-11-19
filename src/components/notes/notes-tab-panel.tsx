"use client";

import { useState } from "react";
import { NoteEditor } from "@/components/notes/note-editor";
import { GenerateAINotesButton } from "@/components/notes/generate-ai-notes-button";
import type { NoteEligibleMaterial } from "@/lib/note-eligible-material";

/**
 * NoteEditor (Phase 3) fetches its note on mount and manages its own save
 * state entirely client-side — it has no "refetch" prop. Rather than
 * reaching into its internals (CLAUDE.md: don't redesign working Phase
 * 1-4 systems), this wrapper just remounts it via a changing `key` once
 * AI note generation finishes, which is the standard React way to force a
 * clean refetch of an uncontrolled child.
 *
 * Phase 11.2: Accepts generalized NoteEligibleMaterial (audio, video, PDF,
 * DOCX, PPTX, Google Docs). Passes both ready and processing materials to
 * GenerateAINotesButton so users have visibility into documents being extracted.
 */
export function NotesTabPanel({
  topicId,
  materials,
}: {
  topicId: string;
  materials: NoteEligibleMaterial[];
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const eligibleMaterials = materials.filter((m) => m.isReady || m.isProcessing);

  return (
    <div>
      {eligibleMaterials.length > 0 && (
        <div className="mb-4 flex justify-end">
          <GenerateAINotesButton
            materials={eligibleMaterials}
            onComplete={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      )}
      <NoteEditor key={refreshKey} topicId={topicId} />
    </div>
  );
}
