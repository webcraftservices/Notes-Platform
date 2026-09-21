import { jsonError, logServerError } from "@/lib/api-response";
import { AIProviderUnavailableError } from "@/lib/services/interfaces";
import { sendDatadogMetric } from "@/lib/observability/datadog";

/**
 * Phase 9.4 — shared "unexpected failure" mapping for the AI *generation*
 * routes (flashcards, quizzes). The AI chat route already maps a provider
 * outage to a clean 503 and logs anything else (Phase 9.1/9.2); these two
 * routes instead ended in `throw err`, so the same outage surfaced as an
 * unlogged bare 500 with no request id and no metric.
 *
 * Only ever called for errors the route did not already recognize as an
 * expected condition (auth, quota, insufficient material, bad model
 * output, not-configured). Logs error message + safe context only —
 * never the prompt, the retrieved chunks, or any completion.
 */
export function aiGenerationFailureResponse(
  err: unknown,
  context: { route: string; kind: "flashcards" | "quiz"; userId: string; requestId: string }
) {
  const unavailable = err instanceof AIProviderUnavailableError;

  void sendDatadogMetric("ai.generation.requests", 1, {
    type: "count",
    tags: [`kind:${context.kind}`, "outcome:failure", `failure_category:${unavailable ? "unavailable" : "unexpected"}`],
  });

  logServerError({ route: context.route, op: "generate", userId: context.userId, requestId: context.requestId }, err);

  if (unavailable) {
    return jsonError("AI service is temporarily unavailable. Please try again.", 503, {
      code: "AI_PROVIDER_UNAVAILABLE",
      requestId: context.requestId,
    });
  }
  return jsonError("Something went wrong. Please try again.", 500, { requestId: context.requestId });
}
