import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { StudyProgress } from "@/lib/study-progress";

/**
 * Phase 8.5 — dashboard "Study Activity" widget. Deliberately a separate
 * component/section from `ProgressRow` (chapter-completion, driven by
 * `ChapterStatus`): this widget reflects real Quiz/AI-Tutor activity
 * instead, and the two must never be visually or semantically merged
 * (see PROJECT_STATE.md's Phase 8.5 note). `progress` is the true global
 * aggregate for this user — `getStudyProgress(user.id)` called with no
 * scope, so it covers every quiz attempt and Tutor session they've ever
 * had, personal or group.
 */
export function StudyActivityWidget({ progress }: { progress: StudyProgress }) {
  const { quizzes, tutor } = progress;
  const hasActivity = quizzes.attempts > 0 || tutor.sessions > 0;

  if (!hasActivity) {
    return (
      <EmptyState
        icon={Activity}
        title="No study activity yet"
        description="Take a quiz or start an AI Tutor session on a topic to see your activity here."
      />
    );
  }

  // Most recent of the two activity types, whichever exists — a single
  // "Last studied" stat rather than two separately-empty ones when only
  // one of quizzes/tutor has any activity yet.
  const quizLatest = quizzes.latest?.completedAt ? new Date(quizzes.latest.completedAt) : null;
  const tutorLatest = tutor.lastActiveAt ? new Date(tutor.lastActiveAt) : null;
  const lastStudied =
    quizLatest && tutorLatest
      ? (quizLatest > tutorLatest ? quizLatest : tutorLatest)
      : quizLatest ?? tutorLatest;

  return (
    <div className="card grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
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
