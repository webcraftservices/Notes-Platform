"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, XCircle, GraduationCap, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { materialSourceHref, materialSourceAriaLabel } from "@/lib/material-link";

type CardSources = { materialId: string; label: string; timestampSeconds?: number; page?: number }[] | null;

interface LatestReview {
  id: string;
  wasCorrect: boolean;
  reviewedAt: string;
}

export interface StudyCard {
  id: string;
  front: string;
  back: string;
  sources: CardSources;
  review: LatestReview | null;
}

/**
 * Phase 8.6 — the real study loop (task's Flashcard Study UI section):
 * one card at a time, reveal the back, then Known / Not Known, which
 * posts a real `FlashcardReview` to the server before advancing. Local
 * state here (`currentIndex`, `revealed`, review counts) is session-only
 * scaffolding for the loop itself — it is never the source of truth for
 * "was this reviewed" across visits, since revisiting re-fetches
 * `card.review` (the user's own latest review) from the server via the
 * page's server-side load, not from anything cached client-side.
 *
 * Deliberately does NOT reorder, schedule, or filter cards by review
 * state (task's Deck Revisiting section) — sequential `cards` order, as
 * given by the page (same stable `id asc` order the API already uses),
 * stays stable regardless of prior review outcomes.
 */
export function FlashcardStudyView({ deckId, title, cards }: { deckId: string; title: string; cards: StudyCard[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionResults, setSessionResults] = useState<{ knownCount: number; studiedCount: number }>({
    knownCount: 0,
    studiedCount: 0,
  });
  const [completed, setCompleted] = useState(false);

  const alreadyReviewedCount = cards.filter((c) => c.review !== null).length;

  if (cards.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No cards in this deck yet"
        description="This deck doesn't have any flashcards to study."
      />
    );
  }

  if (completed) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink dark:text-white">{title}</h1>
        </div>
        <EmptyState
          icon={CheckCircle2}
          title="Deck completed"
          description={`You studied ${sessionResults.studiedCount} card${sessionResults.studiedCount === 1 ? "" : "s"} this session — ${sessionResults.knownCount} marked Known.`}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setCurrentIndex(0);
                setRevealed(false);
                setSessionResults({ knownCount: 0, studiedCount: 0 });
                setCompleted(false);
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Study again
            </Button>
          }
        />
      </div>
    );
  }

  const card = cards[currentIndex];
  if (!card) return null;
  const cardId = card.id;
  const isLastCard = currentIndex === cards.length - 1;

  async function handleAnswer(wasCorrect: boolean) {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/flashcards/${deckId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flashcardId: cardId, wasCorrect }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const message = body?.error ?? "Couldn't save your review. Please try again.";
        setErrorMessage(message);
        toast.error(message);
        return;
      }

      setSessionResults((prev) => ({
        knownCount: prev.knownCount + (wasCorrect ? 1 : 0),
        studiedCount: prev.studiedCount + 1,
      }));

      if (isLastCard) {
        setCompleted(true);
      } else {
        setCurrentIndex((i) => i + 1);
        setRevealed(false);
      }
    } catch {
      const message = "Couldn't reach the server. Check your connection and try again.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink dark:text-white">{title}</h1>
          <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
            Card {currentIndex + 1} of {cards.length}
            {alreadyReviewedCount > 0 && ` · ${alreadyReviewedCount} previously reviewed`}
          </p>
        </div>
      </div>

      <div className="rounded-sm border border-line bg-paper-raised p-6 dark:border-line-dark dark:bg-graphite-800">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint dark:text-white/40">
            {revealed ? "Answer" : "Question"}
          </p>
          {card.review && (
            <Badge variant={card.review.wasCorrect ? "success" : "muted"}>
              {card.review.wasCorrect ? "Previously known" : "Previously not known"}
            </Badge>
          )}
        </div>

        <p className="mt-4 text-base font-medium text-ink dark:text-white">{card.front}</p>

        {revealed && (
          <p className="mt-4 border-t border-line/60 pt-4 text-sm text-ink-muted dark:border-line-dark/60 dark:text-white/60">
            {card.back}
          </p>
        )}

        {revealed && card.sources && card.sources.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line/60 pt-3 dark:border-line-dark/60">
            {card.sources.map((source, j) => (
              <Link
                key={j}
                href={materialSourceHref(source)}
                aria-label={materialSourceAriaLabel(source)}
                className="rounded-sm transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong dark:hover:bg-graphite-800"
              >
                <Badge variant="muted" className="cursor-pointer">
                  {source.label}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col items-start gap-2">
        {!revealed ? (
          <Button variant="primary" onClick={() => setRevealed(true)}>
            Reveal answer
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => handleAnswer(false)}
              loading={submitting}
              disabled={submitting}
            >
              <XCircle className="h-4 w-4" />
              Not Known
            </Button>
            <Button variant="primary" onClick={() => handleAnswer(true)} loading={submitting} disabled={submitting}>
              <CheckCircle2 className="h-4 w-4" />
              Known
            </Button>
          </div>
        )}
        {errorMessage && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
      </div>
    </div>
  );
}
