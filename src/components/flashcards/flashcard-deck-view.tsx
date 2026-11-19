"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, PauseCircle, PlayCircle, Check, X } from "lucide-react";
import { materialSourceHref, materialSourceAriaLabel } from "@/lib/material-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatLearningStateBadge,
  type StudyCard,
} from "@/components/flashcards/flashcard-study-view";
import { deriveCardStateFromReview, type PersistedReviewRecord } from "@/lib/srs/fsrs";
import { serializeCardSchedule, type CardScheduleSummary } from "@/lib/srs/study-queue";

function resolveSchedule(card: StudyCard): CardScheduleSummary {
  if (card.schedule) return card.schedule;
  return serializeCardSchedule(
    deriveCardStateFromReview(card.review as unknown as PersistedReviewRecord | null)
  );
}

/**
 * Phase 8.2 & Phase 13 — Flashcard Deck Overview & Card Management View.
 *
 * Displays all cards in the deck along with their current FSRS-4.5 learning
 * state (`New`, `Learning`, `Review`, `Relearning`, `Suspended`), memory
 * stability, next due date, source provenance links, and inline card/deck
 * management (add card, edit card, delete card, suspend/unsuspend, rename deck)
 * when `canManage` is enabled.
 */
export function FlashcardDeckView({
  deckId,
  title,
  cards,
  canManage = false,
  onTitleChange,
  onCardsChange,
}: {
  deckId?: string;
  title: string;
  cards: StudyCard[];
  canManage?: boolean;
  onTitleChange?: (newTitle: string) => void;
  onCardsChange?: (nextCards: StudyCard[]) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [savingTitle, setSavingTitle] = useState(false);

  const [addingCard, setAddingCard] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");
  const [savingNewCard, setSavingNewCard] = useState(false);

  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [savingCardId, setSavingCardId] = useState<string | null>(null);

  async function handleSaveTitle() {
    if (!deckId || !titleDraft.trim()) return;
    setSavingTitle(true);
    try {
      const res = await fetch(`/api/flashcards/${deckId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleDraft.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't rename deck.");
        return;
      }
      onTitleChange?.(body.deck.title);
      setEditingTitle(false);
      toast.success("Deck renamed.");
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSavingTitle(false);
    }
  }

  async function handleAddCard() {
    if (!deckId || !newFront.trim() || !newBack.trim()) return;
    setSavingNewCard(true);
    try {
      const res = await fetch(`/api/flashcards/${deckId}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: newFront.trim(), back: newBack.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't add card.");
        return;
      }
      onCardsChange?.([...cards, body.card]);
      setNewFront("");
      setNewBack("");
      setAddingCard(false);
      toast.success("Card added to deck.");
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSavingNewCard(false);
    }
  }

  async function handleSaveCardEdit(cardId: string) {
    if (!deckId || !editFront.trim() || !editBack.trim()) return;
    setSavingCardId(cardId);
    try {
      const res = await fetch(`/api/flashcards/${deckId}/cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: editFront.trim(), back: editBack.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't update card.");
        return;
      }
      onCardsChange?.(
        cards.map((c) =>
          c.id === cardId
            ? { ...c, front: body.card.front, back: body.card.back }
            : c
        )
      );
      setEditingCardId(null);
      toast.success("Card updated.");
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSavingCardId(null);
    }
  }

  async function handleDeleteCard(cardId: string) {
    if (!deckId) return;
    setSavingCardId(cardId);
    try {
      const res = await fetch(`/api/flashcards/${deckId}/cards/${cardId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't delete card.");
        return;
      }
      onCardsChange?.(cards.filter((c) => c.id !== cardId));
      toast.success("Card removed.");
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSavingCardId(null);
    }
  }

  async function handleToggleSuspend(card: StudyCard) {
    if (!deckId) return;
    const schedule = resolveSchedule(card);
    const action = schedule.state === "SUSPENDED" ? "UNSUSPEND" : "SUSPEND";
    setSavingCardId(card.id);
    try {
      const res = await fetch(`/api/flashcards/${deckId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flashcardId: card.id, action }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't update card state.");
        return;
      }
      onCardsChange?.(
        cards.map((c) =>
          c.id === card.id
            ? { ...c, review: body.review ?? c.review, schedule: body.schedule ?? c.schedule }
            : c
        )
      );
      toast.success(action === "SUSPEND" ? "Card suspended." : "Card unsuspended.");
    } catch {
      toast.error("Couldn't reach the server.");
    } finally {
      setSavingCardId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="w-72"
                aria-label="Deck title"
              />
              <Button
                variant="primary"
                onClick={handleSaveTitle}
                loading={savingTitle}
                disabled={savingTitle || !titleDraft.trim()}
              >
                <Check className="h-4 w-4" />
                Save
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setTitleDraft(title);
                  setEditingTitle(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-ink dark:text-white">
                {title}
              </h1>
              {canManage && deckId && (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(title);
                    setEditingTitle(true);
                  }}
                  className="rounded-sm p-1 text-ink-faint hover:bg-paper-raised hover:text-ink dark:text-white/40 dark:hover:bg-graphite-800 dark:hover:text-white"
                  title="Rename deck"
                  aria-label="Rename deck"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
            {cards.length} card{cards.length === 1 ? "" : "s"}
          </p>
        </div>

        {canManage && deckId && !addingCard && (
          <Button variant="secondary" onClick={() => setAddingCard(true)}>
            <Plus className="h-4 w-4" />
            Add card
          </Button>
        )}
      </div>

      {addingCard && (
        <div className="space-y-3 rounded-sm border border-line bg-paper-raised p-4 dark:border-line-dark dark:bg-graphite-800">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint dark:text-white/40">
            New Flashcard
          </p>
          <Input
            placeholder="Question (front)"
            value={newFront}
            onChange={(e) => setNewFront(e.target.value)}
          />
          <Input
            placeholder="Answer (back)"
            value={newBack}
            onChange={(e) => setNewBack(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={handleAddCard}
              loading={savingNewCard}
              disabled={savingNewCard || !newFront.trim() || !newBack.trim()}
            >
              Add to deck
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAddingCard(false);
                setNewFront("");
                setNewBack("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {cards.map((card, i) => {
          const schedule = resolveSchedule(card);
          const badge = formatLearningStateBadge(schedule.state);
          const isEditing = editingCardId === card.id;
          const isBusy = savingCardId === card.id;

          return (
            <div
              key={card.id}
              className="rounded-sm border border-line bg-paper-raised p-4 dark:border-line-dark dark:bg-graphite-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-faint dark:text-white/40">
                    Card {i + 1}
                  </p>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  {schedule.dueAt && schedule.state !== "SUSPENDED" && (
                    <span className="text-xs text-ink-faint dark:text-white/40">
                      {schedule.isDue
                        ? "Due now"
                        : `Due ${new Date(schedule.dueAt).toLocaleDateString()}`}
                    </span>
                  )}
                </div>

                {deckId && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleToggleSuspend(card)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-ink-muted hover:bg-paper hover:text-ink dark:text-white/50 dark:hover:bg-graphite-700 dark:hover:text-white"
                    >
                      {schedule.state === "SUSPENDED" ? (
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
                    {canManage && !isEditing && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCardId(card.id);
                            setEditFront(card.front);
                            setEditBack(card.back);
                          }}
                          disabled={isBusy}
                          className="rounded-sm p-1 text-ink-muted hover:bg-paper hover:text-ink dark:text-white/50 dark:hover:bg-graphite-700 dark:hover:text-white"
                          aria-label={`Edit card ${i + 1}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteCard(card.id)}
                          disabled={isBusy}
                          className="rounded-sm p-1 text-ink-muted hover:bg-red-50 hover:text-red-600 dark:text-white/50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          aria-label={`Delete card ${i + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {isEditing ? (
                <div className="mt-3 space-y-2">
                  <Input
                    value={editFront}
                    onChange={(e) => setEditFront(e.target.value)}
                    placeholder="Question (front)"
                  />
                  <Input
                    value={editBack}
                    onChange={(e) => setEditBack(e.target.value)}
                    placeholder="Answer (back)"
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="primary"
                      onClick={() => void handleSaveCardEdit(card.id)}
                      loading={isBusy}
                      disabled={isBusy || !editFront.trim() || !editBack.trim()}
                    >
                      Save
                    </Button>
                    <Button variant="secondary" onClick={() => setEditingCardId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-2 text-sm font-medium text-ink dark:text-white">{card.front}</p>
                  <p className="mt-2 text-sm text-ink-muted dark:text-white/60">{card.back}</p>
                </>
              )}

              {card.sources && card.sources.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/60 pt-3 dark:border-line-dark/60">
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
          );
        })}
      </div>
    </div>
  );
}
