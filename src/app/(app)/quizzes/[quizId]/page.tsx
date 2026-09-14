import { requireUser, requireQuiz } from "@/lib/access";
import { db } from "@/lib/db";
import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { QuizTakingView } from "@/components/quizzes/quiz-taking-view";
import { toPublicQuiz } from "@/lib/quiz-serialization";

/**
 * Phase 8.3's minimal quiz page (task §15) — mirrors the Phase 8.2
 * flashcard deck page's shape exactly (`requireQuiz` is the same
 * owner-or-scope-membership check as `requireFlashcardDeck`). Answers,
 * submission, and scoring all happen client-side in `QuizTakingView`
 * against the real API; this server component only fetches the
 * ALREADY-SANITIZED `PublicQuiz` (via `toPublicQuiz`, same as `GET
 * /api/quizzes/[quizId]`) so `correctAnswer`/`explanation`/`sources`
 * never even reach this page's HTML before an attempt is submitted.
 */
export default async function QuizPage({ params }: { params: { quizId: string } }) {
  const user = await requireUser();
  const quiz = await requireQuiz(params.quizId, user.id);

  const questions = await db.quizQuestion.findMany({
    where: { quizId: quiz.id },
    orderBy: { order: "asc" },
  });

  return (
    <>
      <Topbar>
        <Breadcrumbs trail={[{ label: "Home", href: "/home" }, { label: quiz.title }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <QuizTakingView quiz={toPublicQuiz({ ...quiz, questions })} />
        </div>
      </main>
    </>
  );
}
