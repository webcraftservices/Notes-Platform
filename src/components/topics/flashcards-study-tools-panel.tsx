"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { GraduationCap, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Phase 8.2's minimal Study Tools entry point — deliberately just this,
 * not the "final premium flashcard experience" (task §10). One action
 * (generate), one real outcome (a link to the generated deck at
 * `/flashcards/[deckId]`, rendered by the deck page). No flip animations,
 * no keyboard study controls, no review UI — those are later subphases.
 *
 * Mirrors AIChatPanel's error-handling shape: a real, distinguishable
 * message for the expected failure modes (503 config, 409 insufficient
 * material, 429 quota/rate-limit, 502 malformed AI output), not a single
 * generic "something went wrong" for all of them (spec §53).
 */
export function FlashcardsStudyToolsPanel({ topicId }: { topicId: string }) {
  const [generating, setGenerating] = useState(false);
  const [generatedDeckId, setGeneratedDeckId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/topics/${topicId}/flashcards`, { method: "POST" });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          body?.error ?? "Couldn't generate flashcards for this topic. Please try again in a moment.";
        setErrorMessage(message);
        toast.error(message);
        return;
      }

      setGeneratedDeckId(body.deck.id);
      toast.success(`Generated ${body.deck.cards.length} flashcard${body.deck.cards.length === 1 ? "" : "s"}.`);
    } catch {
      const message = "Couldn't reach the server. Check your connection and try again.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  }

  if (generatedDeckId) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="Flashcards ready"
        description="Your flashcards were generated from this topic's indexed materials."
        action={
          <Link href={`/flashcards/${generatedDeckId}`}>
            <Button variant="primary">View deck</Button>
          </Link>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={GraduationCap}
      title="Generate flashcards"
      description="AI creates flashcards from this topic's indexed materials — transcripts, documents, and notes already added here. Add and process some material first if you haven't yet."
      action={
        <div className="flex flex-col items-center gap-2">
          <Button variant="primary" onClick={handleGenerate} loading={generating}>
            {!generating && <Sparkles className="h-4 w-4" />}
            {generating ? "Generating…" : "Generate Flashcards"}
          </Button>
          {errorMessage && (
            <p className="max-w-sm text-center text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
          )}
        </div>
      }
    />
  );
}
