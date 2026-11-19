"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { LineChart } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface QuizProgressData {
  attempts: number;
  latest: { score: number; completedAt: string | null } | null;
  bestScore: number | null;
  averageScore: number | null;
}

interface TutorActivityData {
  sessions: number;
  messages: number;
  lastActiveAt: string | null;
}

interface FlashcardProgressData {
  totalDecks: number;
  totalCards: number;
  cardsStudied: number;
  reviewsCompleted: number;
  dueCount: number;
  accuracyPercent: number | null;
  averageStabilityDays: number | null;
  lastReviewedAt: string | null;
}

interface ProgressResponse {
  quizzes: QuizProgressData;
  tutor: TutorActivityData;
  flashcards?: FlashcardProgressData;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-faint dark:text-white/30">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-ink dark:text-white">{value}</div>
    </div>
  );
}

/**
 * Phase 8.5 & Phase 13 — Real progress summary for a single Topic.
 * Fetches `GET /api/progress?topicId=...` and renders persisted Quiz,
 * AI Tutor, and FSRS-4.5 Flashcard review metrics for the signed-in user.
 */
export function StudyProgressPanel({ topicId }: { topicId: string }) {
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);

    fetch(`/api/progress?topicId=${topicId}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "Couldn't load your study progress for this topic.");
        return body as ProgressResponse;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err: Error) => {
        if (!cancelled) setErrorMessage(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [topicId]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>
    );
  }

  if (errorMessage) {
    return <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>;
  }

  if (!data) return null;

  const { quizzes, tutor, flashcards } = data;
  const hasFlashcardActivity =
    (flashcards?.reviewsCompleted ?? 0) > 0 || (flashcards?.totalCards ?? 0) > 0;
  const hasActivity =
    quizzes.attempts > 0 || tutor.sessions > 0 || hasFlashcardActivity;

  if (!hasActivity) {
    return (
      <EmptyState
        icon={LineChart}
        title="No study activity yet"
        description="Review flashcards, take a quiz, or start an AI Tutor session on this topic — your progress will show up here."
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {hasFlashcardActivity && flashcards && (
        <>
          <Stat
            label="Cards studied"
            value={`${flashcards.cardsStudied} / ${flashcards.totalCards}`}
          />
          <Stat label="Cards due now" value={String(flashcards.dueCount)} />
          <Stat
            label="Recall accuracy"
            value={flashcards.accuracyPercent !== null ? `${flashcards.accuracyPercent}%` : "—"}
          />
          <Stat
            label="Avg stability"
            value={
              flashcards.averageStabilityDays !== null
                ? `${flashcards.averageStabilityDays}d`
                : "—"
            }
          />
        </>
      )}
      {quizzes.attempts > 0 && (
        <>
          <Stat label="Quiz attempts" value={String(quizzes.attempts)} />
          <Stat label="Best score" value={`${quizzes.bestScore}%`} />
          <Stat label="Average score" value={`${quizzes.averageScore}%`} />
          <Stat
            label="Last quiz activity"
            value={
              quizzes.latest?.completedAt
                ? formatDistanceToNow(new Date(quizzes.latest.completedAt), { addSuffix: true })
                : "—"
            }
          />
        </>
      )}
      {tutor.sessions > 0 && (
        <>
          <Stat label="Tutor sessions" value={String(tutor.sessions)} />
          <Stat label="Tutor messages" value={String(tutor.messages)} />
          <Stat
            label="Last tutor activity"
            value={tutor.lastActiveAt ? formatDistanceToNow(new Date(tutor.lastActiveAt), { addSuffix: true }) : "—"}
          />
        </>
      )}
    </div>
  );
}
