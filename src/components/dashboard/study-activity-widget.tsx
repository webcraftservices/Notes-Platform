import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { StudyProgress } from "@/lib/study-progress";

/**
 * Phase 8.5 & Phase 13 — Dashboard "Study Activity" widget.
 * Reflects real, persisted Quiz attempts, AI Tutor sessions, and FSRS-4.5
 * Flashcard reviews across the signed-in user's workspace and groups.
 */
export function StudyActivityWidget({ progress }: { progress: StudyProgress }) {
  const { quizzes, tutor, flashcards } = progress;
  const flashcardReviews = flashcards?.reviewsCompleted ?? 0;
  const flashcardDue = flashcards?.dueCount ?? 0;
  const hasActivity =
    quizzes.attempts > 0 ||
    tutor.sessions > 0 ||
    flashcardReviews > 0 ||
    (flashcards?.totalCards ?? 0) > 0;

  if (!hasActivity) {
    return (
      <EmptyState
        icon={Activity}
        title="No study activity yet"
        description="Review flashcards, take a quiz, or start an AI Tutor session on a topic to see your activity here."
      />
    );
  }

  const candidateDates: Date[] = [];
  if (quizzes.latest?.completedAt) candidateDates.push(new Date(quizzes.latest.completedAt));
  if (tutor.lastActiveAt) candidateDates.push(new Date(tutor.lastActiveAt));
  if (flashcards?.lastReviewedAt) candidateDates.push(new Date(flashcards.lastReviewedAt));

  const lastStudied =
    candidateDates.length > 0
      ? candidateDates.reduce((latest, d) => (d > latest ? d : latest))
      : null;

  return (
    <div className="card grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
      {(flashcardReviews > 0 || (flashcards?.totalCards ?? 0) > 0) && flashcards && (
        <>
          <div>
            <div className="text-xs text-ink-faint dark:text-white/30">Flashcard reviews</div>
            <div className="mt-0.5 text-lg font-semibold text-ink dark:text-white">
              {flashcardReviews}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-faint dark:text-white/30">Cards due today</div>
            <div className="mt-0.5 text-lg font-semibold text-ink dark:text-white">
              {flashcardDue}
            </div>
          </div>
        </>
      )}
      {quizzes.attempts > 0 && (
        <>
          <div>
            <div className="text-xs text-ink-faint dark:text-white/30">Quiz attempts</div>
            <div className="mt-0.5 text-lg font-semibold text-ink dark:text-white">{quizzes.attempts}</div>
          </div>
          <div>
            <div className="text-xs text-ink-faint dark:text-white/30">Average score</div>
            <div className="mt-0.5 text-lg font-semibold text-ink dark:text-white">{quizzes.averageScore}%</div>
          </div>
        </>
      )}
      {tutor.sessions > 0 && (
        <div>
          <div className="text-xs text-ink-faint dark:text-white/30">Tutor sessions</div>
          <div className="mt-0.5 text-lg font-semibold text-ink dark:text-white">{tutor.sessions}</div>
        </div>
      )}
      <div>
        <div className="text-xs text-ink-faint dark:text-white/30">Last studied</div>
        <div className="mt-0.5 text-lg font-semibold text-ink dark:text-white">
          {lastStudied ? formatDistanceToNow(lastStudied, { addSuffix: true }) : "—"}
        </div>
      </div>
    </div>
  );
}
