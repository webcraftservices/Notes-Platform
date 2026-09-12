import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleAIConversation, getAccessibleAIScope, NotAuthorizedError } from "@/lib/access";
import { sendAIMessageSchema } from "@/lib/validation/ai";
import { retrieveRelevantChunks } from "@/lib/retrieval";
import { buildContextBlock, chunksToSources, toChatMessages } from "@/lib/ai-chat";
import { getAIService } from "@/lib/services/ai";
import { ServiceNotConfiguredError } from "@/lib/services/interfaces";
import { zodError, jsonError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { assertWithinAIQuota, AIQuotaExceededError } from "@/lib/ai-quota";
import { recordAIUsage } from "@/lib/ai-usage";

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
 */
export async function POST(req: Request, { params }: { params: { conversationId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success: withinRateLimit } = await rateLimit(`ai-chat:${user.id}`, AI_CHAT_RATE_LIMIT);
  if (!withinRateLimit) {
    return jsonError("You're sending messages too quickly. Please wait a moment and try again.", 429, {
      code: "AI_RATE_LIMITED",
    });
  }

  const body = await req.json().catch(() => null);
  const parsed = sendAIMessageSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  try {
    const conversation = await getAccessibleAIConversation(params.conversationId, user.id);
    if (!conversation) return NOT_FOUND();

    // Re-resolve the conversation's stored scope to get the same
    // ResolvedAIScope shape retrieval.ts needs — getAccessibleAIConversation
    // already re-validated access to it above.
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
    const context = buildContextBlock(chunks) ?? undefined;

    const ai = getAIService();
    const result = await ai.chat({
      messages: [...toChatMessages(priorMessages), { role: "user", content: parsed.data.content }],
      context,
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
      category: "chat",
      provider: ai.providerName,
      model: ai.modelName,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      context: { conversationId: conversation.id },
    });

    return NextResponse.json({ userMessage, assistantMessage });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
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
    throw err;
  }
}
