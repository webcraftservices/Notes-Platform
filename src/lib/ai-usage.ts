import { db } from "@/lib/db";
import type { UsageKind } from "@prisma/client";

/**
 * Phase 5 Task 6 — AI usage accounting.
 *
 * A small, explicit set of AI usage categories (spec §61 / task §2).
 * "chat" covers AIService.chat() calls (conversational generation);
 * "embedding" covers EmbeddingService.embed() calls (query + ingestion
 * indexing). Both draw from the same `UsageRecord` ledger and the same
 * abstract "AI credits" pool (PlanLimits.aiCreditsPerMonth) — see
 * lib/ai-quota.ts. New AI operations (note generation, flashcard
 * generation, etc.) can add a new category string here without a schema
 * change, since category lives in UsageRecord.metadata rather than a new
 * enum value.
 */
export type AIUsageCategory = "chat" | "embedding";

export interface RecordAIUsageInput {
  userId: string;
  /** Workspace context, when the operation happened inside one (spec §60/§10 — group AI conversations are still recorded against the requesting user, workspaceId is just extra context, never a sharing mechanism). */
  workspaceId?: string | null;
  groupId?: string | null;
  category: AIUsageCategory;
  provider: string;
  model: string;
  /** Real token counts only — `undefined`/omit when the provider didn't report them. Never pass a fabricated estimate (spec §92). */
  tokensInput?: number | null;
  tokensOutput?: number | null;
  /** Free-form extra context (e.g. conversationId, materialId) folded into the same metadata blob rather than new columns. */
  context?: Record<string, unknown>;
}

/**
 * Writes one or more append-only UsageRecord rows for a single AI
 * operation: always one AI_REQUEST row (so per-request counting/rate
 * analysis works even when token counts are unavailable), plus an
 * AI_TOKENS_INPUT/AI_TOKENS_OUTPUT row for each token count that was
 * actually provided. A token field that's `null`/`undefined` writes no
 * row at all — never a fabricated 0 or estimate (spec §92, task §3/§4).
 *
 * Failure semantics (task §5): a UsageRecord write failure must not turn
 * an already-successful AI response into a failed user-facing request —
 * this function is always called AFTER the provider call already
 * succeeded and the response is already being returned/persisted to the
 * user. Errors are logged (never swallowed silently) but never thrown,
 * so a transient DB hiccup here can't take down an otherwise-successful
 * chat turn. This intentionally does NOT share the AIMessage-persisting
 * transaction in messages/route.ts, for the same reason.
 */
export async function recordAIUsage(input: RecordAIUsageInput): Promise<void> {
  const metadata: Record<string, unknown> = {
    category: input.category,
    provider: input.provider,
    model: input.model,
    workspaceId: input.workspaceId ?? null,
    groupId: input.groupId ?? null,
    ...input.context,
  };

  const rows: { kind: UsageKind; quantity: number }[] = [{ kind: "AI_REQUEST", quantity: 1 }];
  if (typeof input.tokensInput === "number") rows.push({ kind: "AI_TOKENS_INPUT", quantity: input.tokensInput });
  if (typeof input.tokensOutput === "number") rows.push({ kind: "AI_TOKENS_OUTPUT", quantity: input.tokensOutput });

  try {
    await db.usageRecord.createMany({
      data: rows.map((row) => ({ userId: input.userId, kind: row.kind, quantity: row.quantity, metadata })),
    });
  } catch (err) {
    console.error("[ai-usage] failed to record AI usage", {
      userId: input.userId,
      category: input.category,
      provider: input.provider,
      model: input.model,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
