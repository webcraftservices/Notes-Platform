import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleAIConversation, getAccessibleAIScope, NotAuthorizedError } from "@/lib/access";
import { sendAIMessageSchema } from "@/lib/validation/ai";
import { retrieveRelevantChunks } from "@/lib/retrieval";
import { buildContextBlock, chunksToSources, toChatMessages, TUTOR_SYSTEM_INSTRUCTION } from "@/lib/ai-chat";
import { getAIService } from "@/lib/services/ai";
import { ServiceNotConfiguredError, AIProviderUnavailableError } from "@/lib/services/interfaces";
import { zodError, jsonError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN, logServerError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { assertWithinAIQuota, assertAiTutorEntitlement, AIQuotaExceededError, AITutorNotEnabledError } from "@/lib/ai-quota";
import { recordAIUsage } from "@/lib/ai-usage";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { sendDatadogMetric } from "@/lib/observability/datadog";

/**
 * Requests per window for the AI chat endpoint (task §8) — the only AI
 * text-generation endpoint in the app today. Deliberately generous enough
 * for normal back-and-forth conversation while still catching accidental
 * loops/rapid double-sends and basic abuse; the *monthly credit* quota
 * below (lib/ai-quota.ts) is what actually caps sustained cost, this is
 * just a short-window abuse guard, same division of responsibility as
 * every other rateLimit() call site in this codebase.
 */
const AI_CHAT_RATE_LIMIT = { limit: 20, windowSeconds: 60 };

/**
 * Phase 8.4 — separate bucket (own key, same value) from AI_CHAT_RATE_LIMIT
 * so heavy tutoring use can't burn through a user's plain "Ask AI"
 * allowance or vice versa. Same limit/window as chat rather than a
 * stricter one: tutoring is the same class of conversational usage, not
 * bulk generation like flashcards/quizzes. This constant and the branch
 * selecting it were added in commit 0182b54, but were unreachable until
 * `AIConversation.kind` actually existed on the schema — this phase makes
 * that column real, which is what makes this bucket reachable in
 * production for the first time.
 */
const AI_TUTOR_RATE_LIMIT = { limit: 20, windowSeconds: 60 };

/**
 * Shown instead of calling the AI provider at all when a Tutor's Topic
 * scope has no indexed material yet — mirrors the exact same
 * fail-before-calling-the-model posture
 * `InsufficientSourceMaterialError` already uses for flashcard/quiz
 * generation (lib/services/flashcard-generation.ts /
 * lib/services/quiz-generation.ts: `if (chunks.length === 0) throw
 * new InsufficientSourceMaterialError()`), applied here to Tutor instead
 * of introducing a new "insufficient material" behavior. Deliberately
 * NOT applied to plain CHAT — that pre-8.4 behavior (still calling the
 * model with zero chunks, letting HALLUCINATION_CONTROL_INSTRUCTION
 * decide whether to offer labeled general knowledge) is unchanged.
 */
class TutorInsufficientMaterialError extends Error {
  constructor() {
    super("This topic doesn't have any indexed material yet, so the Tutor has nothing to teach from. Add and process some material here first.");
    this.name = "TutorInsufficientMaterialError";
  }
}

/**
 * Sends a user message and gets a real AI reply grounded in retrieved
 * chunks (spec §21-24). Both the user message and the assistant reply are
 * written in a single transaction ONLY if the AI call actually succeeds —
 * if AIService/EmbeddingService aren't configured or the call otherwise
 * fails, NOTHING is persisted and a real 503 is returned. This keeps
 * conversation history free of orphaned user-only turns from a broken
 * configuration, and makes retrying exactly re-submit the same content —
 * never a fake assistant reply written to make the failure "go away"
 * (CLAUDE.md's "never fake a feature" rule).
 *
 * Phase 5 Task 6 adds, in this order: rate limiting (cheap, right after
 * auth — mirrors every other rateLimit() call site in this codebase) →
 * body validation → conversation/scope authorization (unchanged) → a
 * server-side AI credit quota check, which MUST run after authorization
 * but before the expensive provider call (task §9) → the AI call itself →
 * persistence → best-effort usage recording, which happens only after
 * persistence has already succeeded and never turns a successful reply
 * into a failed response if the usage ledger write itself fails (see
 * lib/ai-usage.ts's doc comment).
 *
 * Phase 8.4 branches this same pipeline on `conversation.kind`: TUTOR
 * gets its own rate-limit bucket, a live `aiTutor` plan-entitlement check
 * (defense-in-depth on top of the creation-time check in
 * conversations/route.ts — a downgrade must take effect immediately, not
 * just block new conversations), a Tutor system instruction folded into
 * the same AIService.chat() call, an honest insufficient-material
 * short-circuit, and its own `tutor_chat` usage category. CHAT keeps the
 * exact pre-8.4 behavior in every one of those dimensions.
 */
export async function POST(req: Request, { params }: { params: { conversationId: string } }) {
  const requestId = getOrCreateRequestId(req);
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = sendAIMessageSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const conversation = await getAccessibleAIConversation(params.conversationId, user.id);
    if (!conversation) return NOT_FOUND();

    const isTutorConversation = conversation.kind === "TUTOR";

    // Defense-in-depth: conversations/route.ts already checks this before
    // a TUTOR conversation can be created, but a plan downgrade after
    // creation must block the very next message too, not just new
    // conversations — checked live, same as assertWithinAIQuota below.
    if (isTutorConversation) await assertAiTutorEntitlement(user.id);

    const { success: withinRateLimit } = await rateLimit(
      isTutorConversation ? `ai-tutor-chat:${user.id}` : `ai-chat:${user.id}`,
      isTutorConversation ? AI_TUTOR_RATE_LIMIT : AI_CHAT_RATE_LIMIT
    );
    if (!withinRateLimit) {
      return jsonError("You're sending messages too quickly. Please wait a moment and try again.", 429, {
        code: "AI_RATE_LIMITED",
      });
    }

    // Re-resolve the conversation's stored scope to get the same
    // ResolvedAIScope shape retrieval.ts needs — getAccessibleAIConversation
    // already re-validated access to it above. For a Tutor conversation
    // this is always Topic-narrow (topicId is required at creation time —
    // see conversations/route.ts), so retrieval below can never escape
    // to broader workspace/group material.
    const scope = await getAccessibleAIScope(
      {
        topicId: conversation.topicId ?? undefined,
        chapterId: conversation.chapterId ?? undefined,
        subjectId: conversation.subjectId ?? undefined,
        groupId: conversation.groupId ?? undefined,
      },
      user.id
    );

    // Quota check: after authorization, before the expensive AI call
    // (task §9/§13). Deliberately NOT wrapped in the try/catch's generic
    // rethrow — mapped to its own stable 429 below.
    await assertWithinAIQuota(user.id);

    const priorMessages = await db.aIMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });

    const chunks = await retrieveRelevantChunks(parsed.data.content, scope, user.id);

    if (isTutorConversation && chunks.length === 0) {
      throw new TutorInsufficientMaterialError();
    }

    const context = buildContextBlock(chunks) ?? undefined;

    const ai = getAIService();
    const aiCallStartedAt = Date.now();
    let result: Awaited<ReturnType<typeof ai.chat>>;
    try {
      result = await ai.chat({
        messages: [
          ...(isTutorConversation ? [{ role: "system" as const, content: TUTOR_SYSTEM_INSTRUCTION }] : []),
          ...toChatMessages(priorMessages),
          { role: "user", content: parsed.data.content },
        ],
        context,
      });
    } catch (aiErr) {
      // Phase 9.2 §D — safe AI observability: provider/model/operation/
      // duration/failure-category only, never the prompt or the error's
      // own message (which could echo back retrieved context/chunks).
      void sendDatadogMetric("ai.chat.requests", 1, {
        type: "count",
        tags: [
          `provider:${ai.providerName}`,
          `model:${ai.modelName}`,
          `kind:${isTutorConversation ? "tutor" : "chat"}`,
          "outcome:failure",
          `failure_category:${aiErr instanceof AIProviderUnavailableError ? "unavailable" : "unexpected"}`,
        ],
      });
      throw aiErr;
    }
    void sendDatadogMetric("ai.chat.requests", 1, {
      type: "count",
      tags: [`provider:${ai.providerName}`, `model:${ai.modelName}`, `kind:${isTutorConversation ? "tutor" : "chat"}`, "outcome:success"],
    });
    void sendDatadogMetric("ai.chat.latency_ms", Date.now() - aiCallStartedAt, {
      type: "gauge",
      tags: [`provider:${ai.providerName}`, `model:${ai.modelName}`, `kind:${isTutorConversation ? "tutor" : "chat"}`],
    });

    const [userMessage, assistantMessage] = await db.$transaction([
      db.aIMessage.create({
        data: { conversationId: conversation.id, role: "USER", content: parsed.data.content },
      }),
      db.aIMessage.create({
        data: {
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: result.content,
          sources: chunks.length > 0 ? JSON.parse(JSON.stringify(chunksToSources(chunks))) : undefined,
          tokensInput: result.tokensInput,
          tokensOutput: result.tokensOutput,
        },
      }),
    ]);
    await db.aIConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

    // Best-effort — never blocks or fails the response (see lib/ai-usage.ts).
    await recordAIUsage({
      userId: user.id,
      workspaceId: scope.ownerType === "workspace" ? scope.workspaceId : null,
      groupId: scope.ownerType === "group" ? scope.groupId : null,
      category: isTutorConversation ? "tutor_chat" : "chat",
      provider: ai.providerName,
      model: ai.modelName,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      context: { conversationId: conversation.id },
    });

    return NextResponse.json({ userMessage, assistantMessage });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    if (err instanceof AITutorNotEnabledError) return jsonError(err.message, 403, { code: "AI_TUTOR_NOT_ENABLED" });
    if (err instanceof TutorInsufficientMaterialError) {
      return jsonError(err.message, 409, { code: "TUTOR_INSUFFICIENT_MATERIAL" });
    }
    if (err instanceof AIQuotaExceededError) {
      // Only the numbers the frontend actually needs to render a usage bar
      // — never the full PlanLimits object (task §13: don't over-expose
      // internal config shapes through an error response).
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
    if (err instanceof ServiceNotConfiguredError) return jsonError(err.message, 503);
    // Phase 9.1 (spec §16-17): a network failure, timeout, or upstream
    // 429/5xx from the provider is a real but transient condition — never
    // the raw provider exception, and distinct from ServiceNotConfiguredError
    // above (which means the app itself isn't set up, not that the
    // provider is momentarily down).
    if (err instanceof AIProviderUnavailableError) {
      logServerError({ route: "ai/conversations/[id]/messages", op: "chat", userId: user.id, requestId }, err);
      return jsonError("AI service is temporarily unavailable. Please try again.", 503, {
        code: "AI_PROVIDER_UNAVAILABLE",
        requestId,
      });
    }
    // Anything else here is genuinely unexpected (a bug, not a known
    // condition) — log it with context for diagnosis, but never leak the
    // raw error (stack trace, message internals) to the client (spec §13).
    logServerError({ route: "ai/conversations/[id]/messages", op: "chat", userId: user.id, requestId }, err);
    return jsonError("Something went wrong. Please try again.", 500, { requestId });
  }
}
