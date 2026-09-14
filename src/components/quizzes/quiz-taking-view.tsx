"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { materialSourceHref, materialSourceAriaLabel } from "@/lib/material-link";
import type { PublicQuiz } from "@/lib/quiz-serialization";
import type { QuizQuestionResult } from "@/lib/quiz-scoring";

type AnswerValue = string | boolean;

interface AttemptResult {
  attempt: { id: string; score: number; correctCount: number; totalQuestions: number };
  results: QuizQuestionResult[];
}

/**
 * Phase 8.3's intentionally minimal quiz-taking experience (task §15) —
 * a clear multi-question layout, not a one-at-a-time flip flow, no
 * timer, no bookmarking, no adaptive anything. The score/correctness
 * shown after submission is exactly the server's response — this
 * component never computes or displays its own client-side score as
 * authoritative (task §16).
 *
 * `quiz` never contains `correctAnswer`/`explanation`/`sources` (see
 * `lib/quiz-serialization.ts`) — those only exist here after `result` is
 * set, straight from the submission response.
 */
export function QuizTakingView({ quiz }: { quiz: PublicQuiz }) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);

  const allAnswered = quiz.questions.every((q) => answers[q.id] !== undefined && answers[q.id] !== "");

  async function handleSubmit() {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/quizzes/${quiz.id}/attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const message = body?.error ?? "Couldn't submit your answers. Please try again.";
        setErrorMessage(message);
        toast.error(message);
        return;
      }

      setResult(body);
    } catch {
      const message = "Couldn't reach the server. Check your connection and try again.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return <QuizResultView quiz={quiz} result={result} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink dark:text-white">{quiz.title}</h1>
        <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
          {quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="space-y-4">
        {quiz.questions.map((question, i) => (
          <div
            key={question.id}
            className="rounded-sm border border-line bg-paper-raised p-4 dark:border-line-dark dark:bg-graphite-800"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint dark:text-white/40">
              Question {i + 1}
            </p>
            <p className="mt-2 text-sm font-medium text-ink dark:text-white">{question.prompt}</p>

            <div className="mt-3 space-y-2">
              {question.questionType === "MCQ" &&
                question.options?.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-center gap-2 rounded-sm border border-line px-3 py-2 text-sm text-ink hover:bg-paper dark:border-line-dark dark:text-white dark:hover:bg-graphite-700"
                  >
                    <input
                      type="radio"
                      name={question.id}
                      checked={answers[question.id] === option.id}
                      onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: option.id }))}
                    />
                    {option.text}
                  </label>
                ))}

              {question.questionType === "TRUE_FALSE" &&
                [true, false].map((value) => (
                  <label
                    key={String(value)}
                    className="flex cursor-pointer items-center gap-2 rounded-sm border border-line px-3 py-2 text-sm text-ink hover:bg-paper dark:border-line-dark dark:text-white dark:hover:bg-graphite-700"
                  >
                    <input
                      type="radio"
                      name={question.id}
                      checked={answers[question.id] === value}
                      onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
                    />
                    {value ? "True" : "False"}
                  </label>
                ))}

              {question.questionType === "SHORT_ANSWER" && (
                <Input
                  placeholder="Your answer"
                  value={typeof answers[question.id] === "string" ? (answers[question.id] as string) : ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-start gap-2">
        <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={!allAnswered || submitting}>
          {submitting ? "Submitting…" : "Submit answers"}
        </Button>
        {!allAnswered && <p className="text-xs text-ink-faint dark:text-white/40">Answer every question to submit.</p>}
        {errorMessage && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
      </div>
    </div>
  );
}

function QuizResultView({ quiz, result }: { quiz: PublicQuiz; result: AttemptResult }) {
  const resultByQuestionId = new Map(result.results.map((r) => [r.questionId, r]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink dark:text-white">{quiz.title} — Results</h1>
        <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
          {result.attempt.correctCount} / {result.attempt.totalQuestions} correct — {result.attempt.score}%
        </p>
      </div>

      <div className="space-y-4">
        {quiz.questions.map((question, i) => {
          const questionResult = resultByQuestionId.get(question.id);
          if (!questionResult) return null;

          return (
            <div
              key={question.id}
              className="rounded-sm border border-line bg-paper-raised p-4 dark:border-line-dark dark:bg-graphite-800"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint dark:text-white/40">
                  Question {i + 1}
                </p>
                {questionResult.correct ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-signal-success" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                )}
              </div>
              <p className="mt-2 text-sm font-medium text-ink dark:text-white">{question.prompt}</p>
              <p className="mt-2 text-sm text-ink-muted dark:text-white/60">
                Correct answer: {formatAnswer(question, questionResult.correctAnswer)}
              </p>
              {questionResult.explanation && (
                <p className="mt-1 text-sm text-ink-muted dark:text-white/60">{questionResult.explanation}</p>
              )}
              {Array.isArray(questionResult.sources) && questionResult.sources.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/60 pt-3 dark:border-line-dark/60">
                  {(questionResult.sources as { materialId: string; label: string }[]).map((source, j) => (
                    <a
                      key={j}
                      href={materialSourceHref(source)}
                      aria-label={materialSourceAriaLabel(source)}
                      className="rounded-sm transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong dark:hover:bg-graphite-800"
                    >
                      <Badge variant="muted" className="cursor-pointer">
                        {source.label}
                      </Badge>
                    </a>
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

function formatAnswer(question: PublicQuiz["questions"][number], answer: unknown): string {
  if (typeof answer === "boolean") return answer ? "True" : "False";
  if (question.questionType === "MCQ") {
    const matchingOption = question.options?.find((option) => option.id === answer);
    if (matchingOption) return matchingOption.text;
  }
  return String(answer);
}
