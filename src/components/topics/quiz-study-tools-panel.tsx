"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ListChecks, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

interface TopicQuizSummary {
  id: string;
  title: string;
  questionCount: number;
  attemptCount: number;
  bestScore: number | null;
  latestScore: number | null;
}

/**
 * Phase 8.3 & Phase 13 — Topic Quiz Study Tools Panel.
 *
 * Lists existing quizzes for the Topic (with question count, user's attempt
 * count, and best score) so returning learners can take or retake quizzes,
 * while also allowing AI generation of a new quiz from the topic's indexed
 * materials.
 */
export function QuizStudyToolsPanel({ topicId }: { topicId: string }) {
  const [quizzes, setQuizzes] = useState<TopicQuizSummary[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatedQuizId, setGeneratedQuizId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (typeof fetch !== "function") return;

    fetch(`/api/topics/${topicId}/quizzes`)
      .then(async (res) => {
        if (!res || !res.ok) return null;
        return res.json().catch(() => null);
      })
      .then((body) => {
        if (!cancelled && body && Array.isArray(body.quizzes)) {
          setQuizzes(body.quizzes);
        }
      })
      .catch(() => {
        // Non-blocking
      });

    return () => {
      cancelled = true;
    };
  }, [topicId]);

  async function handleGenerate() {
    setGenerating(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/topics/${topicId}/quizzes`, { method: "POST" });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const message = body?.error ?? "Couldn't generate a quiz for this topic. Please try again in a moment.";
        setErrorMessage(message);
        toast.error(message);
        return;
      }

      setGeneratedQuizId(body.quiz.id);
      toast.success(
        `Generated a ${body.quiz.questions.length}-question quiz.`
      );
    } catch {
      const message = "Couldn't reach the server. Check your connection and try again.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  }

  if (generatedQuizId) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Quiz ready"
        description="Your quiz was generated from this topic's indexed materials."
        action={
          <Link href={`/quizzes/${generatedQuizId}`}>
            <Button variant="primary">Take quiz</Button>
          </Link>
        }
      />
    );
  }

  if (quizzes.length > 0) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink dark:text-white">
              Topic Quizzes ({quizzes.length})
            </h3>
            <p className="text-xs text-ink-muted dark:text-white/50">
              Practice assessments generated from this topic&apos;s materials.
            </p>
          </div>
          <Button variant="secondary" onClick={handleGenerate} loading={generating}>
            {!generating && <Sparkles className="h-4 w-4" />}
            {generating ? "Generating…" : "Generate New Quiz"}
          </Button>
        </div>

        {errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
        )}

        <div className="space-y-2.5">
          {quizzes.map((quiz) => (
            <div
              key={quiz.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line bg-paper-raised p-4 dark:border-line-dark dark:bg-graphite-800"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink dark:text-white">{quiz.title}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="muted">{quiz.questionCount} questions</Badge>
                  {quiz.attemptCount > 0 ? (
                    <>
                      <Badge variant="accent">
                        {quiz.attemptCount} attempt{quiz.attemptCount === 1 ? "" : "s"}
                      </Badge>
                      {quiz.bestScore !== null && (
                        <Badge variant={quiz.bestScore >= 80 ? "success" : "default"}>
                          Best: {quiz.bestScore}%
                        </Badge>
                      )}
                    </>
                  ) : (
                    <Badge variant="muted">Not attempted yet</Badge>
                  )}
                </div>
              </div>
              <Link href={`/quizzes/${quiz.id}`}>
                <Button variant="primary">
                  {quiz.attemptCount > 0 ? "Retake quiz" : "Take quiz"}
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
      icon={ListChecks}
      title="Generate a quiz"
      description="AI creates a quiz from this topic's indexed materials — transcripts, documents, and notes already added here. Add and process some material first if you haven't yet."
      action={
        <div className="flex flex-col items-center gap-2">
          <Button variant="primary" onClick={handleGenerate} loading={generating}>
            {!generating && <Sparkles className="h-4 w-4" />}
            {generating ? "Generating…" : "Generate Quiz"}
          </Button>
          {errorMessage && (
            <p className="max-w-sm text-center text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
          )}
        </div>
      }
    />
  );
}
