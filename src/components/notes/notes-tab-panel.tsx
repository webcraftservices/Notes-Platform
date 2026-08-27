"use client";

import { useState } from "react";
import { NoteEditor } from "@/components/notes/note-editor";
import { GenerateAINotesButton } from "@/components/notes/generate-ai-notes-button";
import type { TranscribableMaterial } from "@/components/topics/topic-transcripts-panel";

/**
 * NoteEditor (Phase 3) fetches its note on mount and manages its own save
 * state entirely client-side — it has no "refetch" prop. Rather than
 * reaching into its internals (CLAUDE.md: don't redesign working Phase
 * 1-4 systems), this wrapper just remounts it via a changing `key` once
 * AI note generation finishes, which is the standard React way to force a
 * clean refetch of an uncontrolled child.
 */
export function NotesTabPanel({
  topicId,
  transcribableMaterials,
}: {
  topicId: string;
  transcribableMaterials: TranscribableMaterial[];
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const readyMaterials = transcribableMaterials.filter((m) => m.transcriptReady);

  return (
    <div>
      {readyMaterials.length > 0 && (
        <div className="mb-4 flex justify-end">
          <GenerateAINotesButton
            materials={readyMaterials}
            onComplete={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      )}
      <NoteEditor key={refreshKey} topicId={topicId} />
    </div>
  );
}
