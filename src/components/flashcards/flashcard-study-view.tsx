"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  GraduationCap,
  RotateCcw,
  PauseCircle,
  PlayCircle,
  Clock,
  Sparkles,
  Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { materialSourceHref, materialSourceAriaLabel } from "@/lib/material-link";
import {
  deriveCardStateFromReview,
  type CardLearningState,
  type PersistedReviewRecord,
  type ReviewRating,
} from "@/lib/srs/fsrs";
import {
  buildStudyQueue,
  computeDeckStudyStats,
  serializeCardSchedule,
  type CardScheduleSummary,
} from "@/lib/srs/study-queue";

type CardSources = { materialId: string; label: string; timestampSeconds?: number; page?: number }[] | null;

export interface LatestReview {
  id: string;
  wasCorrect: boolean;
  rating?: string | null;
  state?: string;
  reviewedAt: string;
}

export interface StudyCard {
  id: string;
  front: string;
  back: string;
  sources: CardSources;
  review: LatestReview | null;
  schedule?: CardScheduleSummary | null;
}

export type StudySessionMode = "smart" | "all";

interface SessionCounters {
  studiedCount: number;
  knownCount: number;
  ratings: Record<ReviewRating, number>;
}

const RATING_CONFIG: ReadonlyArray<{
  rating: ReviewRating;
  label: string;
  shortcut: string;
  wasCorrect: boolean;
  className: string;
}> = [
  {
    rating: "AGAIN",
    label: "Again",
    shortcut: "1",
    wasCorrect: false,
    className:
      "border-red-300 bg-red-50/70 text-red-700 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50",
  },
  {
    rating: "HARD",
    label: "Hard",
    shortcut: "2",
    wasCorrect: true,
    className:
      "border-amber-300 bg-amber-50/70 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50",
  },
  {
    rating: "GOOD",
    label: "Good",
    shortcut: "3",
    wasCorrect: true,
    className:
      "border-emerald-300 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50",
  },
  {
    rating: "EASY",
    label: "Easy",
    shortcut: "4",
    wasCorrect: true,
    className:
      "border-sky-300 bg-sky-50/70 text-sky-800 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-300 dark:hover:bg-sky-950/50",
  },
];

function getCardSchedule(card: StudyCard): CardScheduleSummary {
  if (card.schedule) {
    return card.schedule;
  }
  const derived = deriveCardStateFromReview(
    card.review as unknown as PersistedReviewRecord | null
  );
  return serializeCardSchedule(derived);
}

export function formatLearningStateBadge(state: CardLearningState): {
  label: string;
  variant: "default" | "accent" | "success" | "muted";
} {
  switch (state) {
    case "NEW":
      return { label: "New", variant: "accent" };
    case "LEARNING":
      return { label: "Learning", variant: "default" };
    case "RELEARNING":
      return { label: "Relearning", variant: "default" };
    case "REVIEW":
      return { label: "Review", variant: "success" };
    case "SUSPENDED":
      return { label: "Suspended", variant: "muted" };
  }
}

/**
 * Phase 13 (Task 13-03) — Interactive Spaced-Repetition Flashcard Study View.
 *
 * Features:
 * - FSRS-4.5 4-point rating controls (`Again (1)`, `Hard (2)`, `Good (3)`, `Easy (4)`)
 *   with live next-interval previews (`<10m`, `1d`, `2d`, `6d`, etc.) on each button.
 * - Study queue mode toggle:
 *   - `Due & New` (`smart`): prioritizes due learning/relearning -> overdue/due review -> new cards.
 *     Automatically falls back to all active cards if 0 cards are currently due/new so a user
 *     opening a deck can always study immediately or switch modes at will.
 *   - `All Active Cards` (`all`): studies all non-suspended cards in priority order.
 * - Keyboard shortcuts: `Space` or `Enter` to reveal the answer; `1`–`4` to submit
 *   `AGAIN` / `HARD` / `GOOD` / `EASY` once revealed.
 * - Per-card `Suspend` / `Unsuspend` lifecycle action and client-side `idempotencyKey` per turn.
 */
export function FlashcardStudyView({
  deckId,
  title,
  cards: propCards,
  onCardsChange,
}: {
  deckId: string;
  title: string;
  cards: StudyCard[];
  onCardsChange?: (cards: StudyCard[]) => void;
}) {
  const [localCards, setLocalCards] = useState<StudyCard[]>(propCards);
  useEffect(() => {
    setLocalCards(propCards);
  }, [propCards]);

  const updateCards = useCallback(
    (updater: (prev: StudyCard[]) => StudyCard[]) => {
      setLocalCards((prev) => {
        const next = updater(prev);
        onCardsChange?.(next);
        return next;
      });
    },
    [onCardsChange]
  );

  const deckStats = useMemo(() => computeDeckStudyStats(localCards), [localCards]);

  // Default to "smart" (Due & New) when there are due or new cards; otherwise "all" so the deck is immediately playable
  const [mode, setMode] = useState<StudySessionMode>(() => {
    const initialStats = computeDeckStudyStats(propCards);
    return initialStats.dueCount + initialStats.newCount > 0 ? "smart" : "all";
  });

  // Snapshot the ordered card IDs for the current session pass so rating a card doesn't
  // unexpectedly shift the underlying array index mid-turn
  const [sessionCardIds, setSessionCardIds] = useState<string[]>(() => {
    const initialStats = computeDeckStudyStats(propCards);
    const effectiveMode = initialStats.dueCount + initialStats.newCount > 0 ? "smart" : "all";
    const partitioned = buildStudyQueue(propCards, { mode: effectiveMode, limit: 200 });
    return partitioned.queue.map((c) => c.id);
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [turnNonce, setTurnNonce] = useState(0);
  const [sessionResults, setSessionResults] = useState<SessionCounters>({
    studiedCount: 0,
    knownCount: 0,
    ratings: { AGAIN: 0, HARD: 0, GOOD: 0, EASY: 0 },
  });
  const [completed, setCompleted] = useState(false);

  const startNewSession = useCallback(
    (targetMode: StudySessionMode, sourceCards: StudyCard[] = localCards) => {
      const partitioned = buildStudyQueue(sourceCards, { mode: targetMode, limit: 200 });
      const ids =
        partitioned.queue.length > 0
          ? partitioned.queue.map((c) => c.id)
          : buildStudyQueue(sourceCards, { mode: "all", limit: 200 }).queue.map((c) => c.id);
      setMode(targetMode);
      setSessionCardIds(ids);
      setCurrentIndex(0);
      setRevealed(false);
      setErrorMessage(null);
      setTurnNonce((n) => n + 1);
      setSessionResults({
        studiedCount: 0,
        knownCount: 0,
        ratings: { AGAIN: 0, HARD: 0, GOOD: 0, EASY: 0 },
      });
      setCompleted(false);
    },
    [localCards]
  );

  const cardById = useMemo(
    () => new Map(localCards.map((c) => [c.id, c])),
    [localCards]
  );

  const activeSessionCards = useMemo(
    () =>
      sessionCardIds
        .map((id) => cardById.get(id))
        .filter((c): c is StudyCard => Boolean(c)),
    [sessionCardIds, cardById]
  );

  const card = activeSessionCards[currentIndex] ?? null;
  const cardSchedule = useMemo(() => (card ? getCardSchedule(card) : null), [card]);
  const isLastCard = currentIndex >= activeSessionCards.length - 1;

  const handleRate = useCallback(
    async (rating: ReviewRating) => {
      if (!card || submitting) return;
      setSubmitting(true);
      setErrorMessage(null);

      const wasCorrect = rating !== "AGAIN";
      const idempotencyKey = `rev-${deckId}-${card.id}-${turnNonce}-${rating}`;

      try {
        const res = await fetch(`/api/flashcards/${deckId}/reviews`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flashcardId: card.id,
            rating,
            wasCorrect,
            idempotencyKey,
          }),
        });
        const body = await res.json().catch(() => null);

        if (!res.ok) {
          const message = body?.error ?? "Couldn't save your review. Please try again.";
          setErrorMessage(message);
          toast.error(message);
          return;
        }

        const updatedReview: LatestReview = body?.review
          ? {
              id: body.review.id,
              wasCorrect: body.review.wasCorrect,
              rating: body.review.rating ?? rating,
              state: body.review.state ?? body.schedule?.state,
              reviewedAt:
                typeof body.review.reviewedAt === "string"
                  ? body.review.reviewedAt
                  : new Date().toISOString(),
            }
          : {
              id: `local-${Date.now()}`,
              wasCorrect,
              rating,
              reviewedAt: new Date().toISOString(),
            };

        updateCards((prev) =>
          prev.map((c) =>
            c.id === card.id
              ? {
                  ...c,
                  review: updatedReview,
                  schedule: body?.schedule ?? c.schedule,
                }
              : c
          )
        );

        setSessionResults((prev) => ({
          studiedCount: prev.studiedCount + 1,
          knownCount: prev.knownCount + (wasCorrect ? 1 : 0),
          ratings: {
            ...prev.ratings,
            [rating]: (prev.ratings[rating] ?? 0) + 1,
          },
        }));

        if (isLastCard) {
          setCompleted(true);
        } else {
          setCurrentIndex((i) => i + 1);
          setRevealed(false);
          setTurnNonce((n) => n + 1);
        }
      } catch {
        const message = "Couldn't reach the server. Check your connection and try again.";
        setErrorMessage(message);
        toast.error(message);
      } finally {
        setSubmitting(false);
      }
    },
    [card, submitting, deckId, turnNonce, isLastCard, updateCards]
  );

  const handleSuspendToggle = useCallback(async () => {
    if (!card || !cardSchedule || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);

    const action = cardSchedule.state === "SUSPENDED" ? "UNSUSPEND" : "SUSPEND";
    try {
      const res = await fetch(`/api/flashcards/${deckId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flashcardId: card.id,
          action,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message = body?.error ?? "Couldn't update card state.";
        setErrorMessage(message);
        toast.error(message);
        return;
      }

      updateCards((prev) =>
        prev.map((c) =>
          c.id === card.id
            ? {
                ...c,
                review: body?.review ?? c.review,
                schedule: body?.schedule ?? c.schedule,
              }
            : c
        )
      );

      toast.success(action === "SUSPEND" ? "Card suspended from due queue." : "Card unsuspended.");

      if (action === "SUSPEND") {
        if (isLastCard) {
          setCompleted(true);
        } else {
          setCurrentIndex((i) => i + 1);
          setRevealed(false);
          setTurnNonce((n) => n + 1);
        }
      }
    } catch {
      const message = "Couldn't reach the server. Check your connection and try again.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }, [card, cardSchedule, submitting, deckId, isLastCard, updateCards]);

  // Keyboard shortcuts: Space/Enter reveals answer; 1/2/3/4 submits rating when revealed
  useEffect(() => {
    if (completed || !card) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (!revealed && (e.key === " " || e.key === "Spacebar")) {
        e.preventDefault();
        setRevealed(true);
        return;
      }

      if (revealed && !submitting) {
        if (e.key === "1") {
          e.preventDefault();
          void handleRate("AGAIN");
        } else if (e.key === "2") {
          e.preventDefault();
          void handleRate("HARD");
        } else if (e.key === "3") {
          e.preventDefault();
          void handleRate("GOOD");
        } else if (e.key === "4") {
          e.preventDefault();
          void handleRate("EASY");
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [completed, card, revealed, submitting, handleRate]);

  if (localCards.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No cards in this deck yet"
        description="This deck doesn't have any flashcards to study."
      />
    );
  }

  if (activeSessionCards.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-xl font-semibold text-ink dark:text-white">{title}</h1>
        </div>
        <EmptyState
          icon={CheckCircle2}
          title="All caught up for today"
          description={
            deckStats.suspendedCount === localCards.length
              ? "All cards in this deck are currently suspended. Unsuspend cards in the Overview tab to study them."
              : "No flashcards are currently due in this deck. You can review all active cards anytime."
          }
          action={
            deckStats.suspendedCount < localCards.length ? (
              <Button variant="secondary" onClick={() => startNewSession("all")}>
                <RotateCcw className="h-4 w-4" />
                Review all active cards
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  if (completed) {
    const accuracy =
      sessionResults.studiedCount > 0
        ? Math.round((sessionResults.knownCount / sessionResults.studiedCount) * 100)
        : 0;

    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink dark:text-white">{title}</h1>
        </div>
        <EmptyState
          icon={CheckCircle2}
          title="Deck completed"
          description={`You studied ${sessionResults.studiedCount} card${sessionResults.studiedCount === 1 ? "" : "s"} this session — ${sessionResults.knownCount} recalled (${accuracy}% accuracy).`}
          action={
            <div className="flex flex-col items-center gap-4">
              <div className="flex flex-wrap justify-center gap-2 text-xs">
                <Badge variant="muted">Again: {sessionResults.ratings.AGAIN}</Badge>
                <Badge variant="default">Hard: {sessionResults.ratings.HARD}</Badge>
                <Badge variant="success">Good: {sessionResults.ratings.GOOD}</Badge>
                <Badge variant="accent">Easy: {sessionResults.ratings.EASY}</Badge>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {deckStats.dueCount + deckStats.newCount > 0 && (
                  <Button variant="primary" onClick={() => startNewSession("smart")}>
                    <Flame className="h-4 w-4" />
                    Study due cards ({deckStats.dueCount + deckStats.newCount})
                  </Button>
                )}
                <Button variant="secondary" onClick={() => startNewSession("all")}>
                  <RotateCcw className="h-4 w-4" />
                  Study again
                </Button>
              </div>
            </div>
          }
        />
      </div>
    );
  }

  if (!card || !cardSchedule) return null;

  const stateBadge = formatLearningStateBadge(cardSchedule.state);
  const progressPct = Math.round(((currentIndex + 1) / activeSessionCards.length) * 100);

  return (
    <div className="space-y-6">
      {/* Header & Deck Queue Summary Badges */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink dark:text-white">{title}</h1>
          <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
            Card {currentIndex + 1} of {activeSessionCards.length}
            {deckStats.studiedCount > 0 && ` · ${deckStats.studiedCount} previously reviewed`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <Badge variant={deckStats.dueCount > 0 ? "default" : "muted"}>
              Due: {deckStats.dueCount}
            </Badge>
            <Badge variant={deckStats.newCount > 0 ? "accent" : "muted"}>
              New: {deckStats.newCount}
            </Badge>
            <Badge variant="success">Review: {deckStats.reviewCount}</Badge>
            {deckStats.suspendedCount > 0 && (
              <Badge variant="muted">Suspended: {deckStats.suspendedCount}</Badge>
            )}
          </div>

          <div
            className="inline-flex rounded-sm border border-line bg-paper p-0.5 text-xs dark:border-line-dark dark:bg-graphite-900"
            role="group"
            aria-label="Study queue mode"
          >
            <button
              type="button"
              onClick={() => startNewSession("smart")}
              className={`rounded-sm px-2.5 py-1 font-medium transition-colors ${
                mode === "smart"
                  ? "bg-paper-raised text-ink shadow-xs dark:bg-graphite-800 dark:text-white"
                  : "text-ink-muted hover:text-ink dark:text-white/50 dark:hover:text-white"
              }`}
            >
              Due &amp; New
            </button>
            <button
              type="button"
              onClick={() => startNewSession("all")}
              className={`rounded-sm px-2.5 py-1 font-medium transition-colors ${
                mode === "all"
                  ? "bg-paper-raised text-ink shadow-xs dark:bg-graphite-800 dark:text-white"
                  : "text-ink-muted hover:text-ink dark:text-white/50 dark:hover:text-white"
              }`}
            >
              All Cards
            </button>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-line/60 dark:bg-line-dark/60"
        role="progressbar"
        aria-valuenow={currentIndex + 1}
        aria-valuemin={1}
        aria-valuemax={activeSessionCards.length}
        aria-label="Study session progress"
      >
        <div
          className="h-full bg-accent-strong transition-all duration-200"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Active Flashcard */}
      <div className="rounded-sm border border-line bg-paper-raised p-6 dark:border-line-dark dark:bg-graphite-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint dark:text-white/40">
              {revealed ? "Answer" : "Question"}
            </p>
            <Badge variant={stateBadge.variant}>{stateBadge.label}</Badge>
            {cardSchedule.reps > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-ink-faint dark:text-white/40">
                <Clock className="h-3 w-3" />
                Stability {cardSchedule.stability.toFixed(1)}d · {cardSchedule.reps} rep
                {cardSchedule.reps === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {card.review && (
              <Badge variant={card.review.wasCorrect ? "success" : "muted"}>
                {card.review.wasCorrect ? "Previously known" : "Previously not known"}
              </Badge>
            )}
            <button
              type="button"
              onClick={handleSuspendToggle}
              disabled={submitting}
              className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-paper hover:text-ink dark:text-white/50 dark:hover:bg-graphite-700 dark:hover:text-white"
              title={
                cardSchedule.state === "SUSPENDED"
                  ? "Unsuspend card"
                  : "Suspend card from future due queues"
              }
            >
              {cardSchedule.state === "SUSPENDED" ? (
                <>
                  <PlayCircle className="h-3.5 w-3.5" />
                  Unsuspend
                </>
              ) : (
                <>
                  <PauseCircle className="h-3.5 w-3.5" />
                  Suspend
                </>
              )}
            </button>
          </div>
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

      {/* Controls: Reveal Answer or 4-Point FSRS Rating Buttons */}
      <div className="flex flex-col items-start gap-3">
        {!revealed ? (
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={() => setRevealed(true)}>
              Reveal answer
            </Button>
            <span className="text-xs text-ink-faint dark:text-white/40">
              Press <kbd className="rounded-xs border border-line px-1.5 py-0.5 font-mono text-[11px] dark:border-line-dark">Space</kbd> to flip
            </span>
          </div>
        ) : (
          <div className="w-full space-y-2">
            <div className="grid w-full grid-cols-2 gap-2.5 sm:grid-cols-4">
              {RATING_CONFIG.map(({ rating, label, shortcut, wasCorrect, className }) => {
                const preview = cardSchedule.intervals[rating];
                return (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => void handleRate(rating)}
                    disabled={submitting}
                    aria-label={`${label} (${preview?.label ?? ""})`}
                    className={`flex flex-col items-center justify-center rounded-sm border px-3 py-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-50 ${className}`}
                  >
                    <span className="text-[11px] font-medium opacity-80">
                      {preview?.label ?? "—"}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold">
                      {wasCorrect ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      {label}
                    </span>
                    <span className="mt-0.5 font-mono text-[10px] opacity-65">
                      Key {shortcut}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-ink-faint dark:text-white/40">
              <Sparkles className="mr-1 inline h-3 w-3" />
              FSRS-4.5 intervals adapt to your recall stability. Use keys 1–4 for rapid rating.
            </p>
          </div>
        )}
        {errorMessage && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
      </div>
    </div>
  );
}
