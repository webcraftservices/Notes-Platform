"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { GraduationCap, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { DeckQueueSummary } from "@/lib/srs/due-service";

/**
 * Phase 8.2 & Phase 13 — Topic Flashcards Study Tools Panel.
 *
 * Loads existing flashcard decks for the Topic (with live FSRS-4.5 due/new/review
 * counts) so returning learners can immediately launch a study session on an
 * existing deck, while also allowing AI generation of a new deck from the
 * topic's indexed materials.
 */
export function FlashcardsStudyToolsPanel({ topicId }: { topicId: string }) {
  const [decks, setDecks] = useState<DeckQueueSummary[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatedDeckId, setGeneratedDeckId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (typeof fetch !== "function") return;

    fetch(`/api/topics/${topicId}/flashcards`)
      .then(async (res) => {
        if (!res || !res.ok) return null;
        return res.json().catch(() => null);
      })
      .then((body) => {
        if (!cancelled && body && Array.isArray(body.decks)) {
          setDecks(body.decks);
        }
      })
      .catch(() => {
        // Non-blocking: if initial list fetch fails, user can still generate flashcards
      });

    return () => {
      cancelled = true;
    };
  }, [topicId]);

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

  if (decks.length > 0) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink dark:text-white">
              Flashcard Decks ({decks.length})
            </h3>
            <p className="text-xs text-ink-muted dark:text-white/50">
              Spaced-repetition decks generated for this topic.
            </p>
          </div>
          <Button variant="secondary" onClick={handleGenerate} loading={generating}>
            {!generating && <Sparkles className="h-4 w-4" />}
            {generating ? "Generating…" : "Generate New Deck"}
          </Button>
        </div>

        {errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
        )}

        <div className="space-y-2.5">
          {decks.map((deck) => (
            <div
              key={deck.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line bg-paper-raised p-4 dark:border-line-dark dark:bg-graphite-800"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink dark:text-white">{deck.title}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="muted">{deck.stats.totalCards} cards</Badge>
                  {deck.stats.dueCount > 0 && (
                    <Badge variant="default">{deck.stats.dueCount} due</Badge>
                  )}
                  {deck.stats.newCount > 0 && (
                    <Badge variant="accent">{deck.stats.newCount} new</Badge>
                  )}
                  {deck.stats.dueCount === 0 && deck.stats.newCount === 0 && (
                    <Badge variant="success">Up to date</Badge>
                  )}
                </div>
              </div>
              <Link href={`/flashcards/${deck.id}`}>
                <Button variant="primary">
                  Study
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
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
