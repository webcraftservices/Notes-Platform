import { db } from "@/lib/db";
import { getPlanLimits, type PlanLimits } from "@/lib/plans";

/**
 * Phase 5 Task 6 — AI quota enforcement.
 *
 * Reuses PlanLimits.aiCreditsPerMonth (defined since Phase 1/2's plan
 * config, unused until now — its own doc comment already says "mapped to
 * tokens by AIService"), so 1 credit = 1 AI token, summed across both
 * usage categories (chat generation + embeddings — see lib/ai-usage.ts)
 * into one abstract pool, matching that comment's intent rather than
 * inventing a second, parallel unit.
 *
 * Computed live from the UsageRecord ledger for the current calendar
 * month (same pattern as getStorageUsage/getRecordingUsage in
 * lib/storage-usage.ts / lib/recording-usage.ts) rather than a mutable
 * running counter, so it stays auditable and never drifts from the
 * ledger it's supposed to summarize.
 */
export interface AIUsageSummary {
  plan: PlanLimits;
  usedCredits: number;
  limitCredits: number;
  remainingCredits: number;
  percentUsed: number;
}

export async function getAIUsage(userId: string): Promise<AIUsageSummary> {
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [subscription, aggregate] = await Promise.all([
    db.subscription.findUnique({ where: { userId } }),
    db.usageRecord.aggregate({
      where: {
        userId,
        kind: { in: ["AI_TOKENS_INPUT", "AI_TOKENS_OUTPUT"] },
        createdAt: { gte: startOfMonth },
      },
      _sum: { quantity: true },
    }),
  ]);

  const plan = getPlanLimits(subscription?.plan ?? "FREE");
  const usedCredits = aggregate._sum.quantity ?? 0;
  const limitCredits = plan.aiCreditsPerMonth;

  return {
    plan,
    usedCredits,
    limitCredits,
    remainingCredits: Math.max(0, limitCredits - usedCredits),
    percentUsed: limitCredits > 0 ? Math.min(100, Math.round((usedCredits / limitCredits) * 100)) : 100,
  };
}

/** Thrown by assertWithinAIQuota; the route layer maps this to a 429 with a stable `AI_QUOTA_EXCEEDED` code (never a raw 500/leaked internals). */
export class AIQuotaExceededError extends Error {
  constructor(public readonly usage: AIUsageSummary) {
    super("AI usage quota exceeded for this billing period.");
    this.name = "AIQuotaExceededError";
  }
}

/**
 * MUST be called after authorization (task §9) and before the expensive
 * AI provider call (task §6/§13) — never rely on the frontend for this.
 *
 * Concurrency note (task §7): this is a read-then-decide check against an
 * aggregate, not an atomic reservation. Two requests issued at nearly the
 * same instant can both read a `usedCredits` value below the limit and
 * both proceed, so worst-case overage is bounded by how many concurrent
 * requests a single user has in flight at once — not unbounded, since
 * every subsequent request re-aggregates the ledger (including whatever
 * the in-flight requests already wrote) and will correctly reject once
 * the limit is actually crossed. This matches the same trade-off already
 * accepted by getStorageUsage/getRecordingUsage elsewhere in this
 * codebase; a stronger guarantee would need a Postgres advisory lock
 * (`pg_advisory_xact_lock`, keyed by userId) held across check+record,
 * which isn't used anywhere else in this project yet and would add
 * latency to every AI request to close a narrow, low-impact race — not
 * introduced here without a broader decision to adopt that pattern
 * project-wide.
 */
export async function assertWithinAIQuota(userId: string): Promise<AIUsageSummary> {
  const usage = await getAIUsage(userId);
  if (usage.usedCredits >= usage.limitCredits) {
    throw new AIQuotaExceededError(usage);
  }
  return usage;
}
