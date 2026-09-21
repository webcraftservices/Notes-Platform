import { NextResponse } from "next/server";
import { getSessionUser, getAccessibleTopic, NotAuthorizedError } from "@/lib/access";
import {
  generateFlashcardsForTopic,
  InsufficientSourceMaterialError,
  FlashcardGenerationOutputError,
} from "@/lib/services/flashcard-generation";
import { ServiceNotConfiguredError } from "@/lib/services/interfaces";
import { jsonError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { aiGenerationFailureResponse } from "@/lib/ai-route-errors";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { assertWithinAIQuota, AIQuotaExceededError } from "@/lib/ai-quota";

/**
 * Generating a deck is a heavier, slower operation than one chat message
 * (a full retrieval pass + a larger generation call), so this is
 * deliberately tighter than AI_CHAT_RATE_LIMIT in messages/route.ts (20/
 * 60s) — still just a short-window abuse guard; the monthly AI credit
 * quota below is what actually caps sustained cost.
 */
const FLASHCARD_GENERATION_RATE_LIMIT = { limit: 5, windowSeconds: 60 };

/**
 * Synchronous, like AI chat's messages/route.ts — NOT the fire-and-forget
 * ProcessingJob pattern used for audio transcription/embedding. Those are
 * genuinely long-running (minutes, external chunked jobs); this is one
 * bounded retrieval pass + one AIService.chat() call, the same shape and
 * cost class as a single chat turn, so it gets the same request/response
 * shape: the client awaits this call and gets the finished deck back.
 *
 * Order mirrors messages/route.ts exactly: auth → rate limit → resolve +
 * authorize the Topic (so "not found" vs "not authorized" map to the
 * right status codes) → quota check → the actual generation, which
 * re-resolves scope itself (see flashcard-generation.ts's doc comment).
 */
export async function POST(req: Request, { params }: { params: { topicId: string } }) {
  const requestId = getOrCreateRequestId(req);
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success: withinRateLimit } = await rateLimit(
    `flashcard-generation:${user.id}`,
    FLASHCARD_GENERATION_RATE_LIMIT
  );
  if (!withinRateLimit) {
    return jsonError("You're generating flashcards too quickly. Please wait a moment and try again.", 429, {
      code: "AI_RATE_LIMITED",
    });
  }

  try {
    const topic = await getAccessibleTopic(params.topicId, user.id);
    if (!topic) return NOT_FOUND();

    await assertWithinAIQuota(user.id);

    const deck = await generateFlashcardsForTopic({ userId: user.id, topicId: topic.id });

    return NextResponse.json({ deck }, { status: 201 });
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
      return jsonError(err.message, 409, { code: "FLASHCARDS_INSUFFICIENT_MATERIAL" });
    }
    if (err instanceof FlashcardGenerationOutputError) {
      return jsonError(err.message, 502, { code: "FLASHCARDS_GENERATION_FAILED" });
    }
    if (err instanceof ServiceNotConfiguredError) return jsonError(err.message, 503);
    return aiGenerationFailureResponse(err, { route: "topics/[topicId]/flashcards", kind: "flashcards", userId: user.id, requestId });
  }
}
