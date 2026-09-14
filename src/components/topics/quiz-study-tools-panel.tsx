"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ListChecks, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Phase 8.3's minimal Study Tools entry point — the quiz analog of
 * FlashcardsStudyToolsPanel (same shape, same error-handling philosophy:
 * a real distinguishable message per failure mode, not one generic
 * string). One action (generate), one real outcome (a link to
 * `/quizzes/[quizId]`, which itself never receives answers before
 * submission — see lib/quiz-serialization.ts).
 */
export function QuizStudyToolsPanel({ topicId }: { topicId: string }) {
  const [generating, setGenerating] = useState(false);
  const [generatedQuizId, setGeneratedQuizId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
