import { NextResponse } from "next/server";
import { getSessionUser, getAccessibleTopic, NotAuthorizedError } from "@/lib/access";
import {
  generateQuizForTopic,
  InsufficientSourceMaterialError,
  QuizGenerationOutputError,
} from "@/lib/services/quiz-generation";
import { ServiceNotConfiguredError } from "@/lib/services/interfaces";
import { jsonError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { assertWithinAIQuota, AIQuotaExceededError } from "@/lib/ai-quota";
import { toPublicQuiz } from "@/lib/quiz-serialization";

/**
 * Same rationale as flashcard generation's rate limit
 * (topics/[topicId]/flashcards/route.ts) — a heavier operation than one
 * chat message, so tighter than chat's 20/60s. Kept identical to the
 * flashcard limit since quiz generation is the same cost class (one
 * retrieval pass + one chat-shaped AI call).
 */
const QUIZ_GENERATION_RATE_LIMIT = { limit: 5, windowSeconds: 60 };

/**
 * Synchronous, exactly like flashcard generation's route — see that
 * file's doc comment for why this isn't the fire-and-forget
 * ProcessingJob pattern. Same order: auth → rate limit → resolve +
 * authorize the Topic (for correct 404 vs 403) → quota → generation,
 * which re-resolves scope itself (see quiz-generation.ts's doc comment).
 */
export async function POST(_req: Request, { params }: { params: { topicId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success: withinRateLimit } = await rateLimit(`quiz-generation:${user.id}`, QUIZ_GENERATION_RATE_LIMIT);
  if (!withinRateLimit) {
    return jsonError("You're generating quizzes too quickly. Please wait a moment and try again.", 429, {
      code: "AI_RATE_LIMITED",
    });
  }

  try {
    const topic = await getAccessibleTopic(params.topicId, user.id);
    if (!topic) return NOT_FOUND();

    await assertWithinAIQuota(user.id);

    const quiz = await generateQuizForTopic({ userId: user.id, topicId: topic.id });

    return NextResponse.json({ quiz: toPublicQuiz(quiz) }, { status: 201 });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    if (err instanceof AIQuotaExceededError) {
      return jsonError(
        "You've used all of your AI credits for this billing period. Upgrade your plan or wait for it to reset.",
        429,
        {
          code: "AI_QUOTA_EXCEEDED",
          usage: {
            usedCredits: err.usage.usedCredits,
            limitCredits: err.usage.limitCredits,
            plan: err.usage.plan.label,
          },
        }
      );
    }
    if (err instanceof InsufficientSourceMaterialError) {
      return jsonError(err.message, 409, { code: "QUIZ_INSUFFICIENT_MATERIAL" });
    }
    if (err instanceof QuizGenerationOutputError) {
      return jsonError(err.message, 502, { code: "QUIZ_GENERATION_FAILED" });
    }
    if (err instanceof ServiceNotConfiguredError) return jsonError(err.message, 503);
    throw err;
  }
}
