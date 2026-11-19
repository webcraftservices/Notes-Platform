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

  const effectiveTier =
    !subscription || subscription.status === "CANCELLED"
      ? "FREE"
      : (subscription.plan ?? "FREE");
  const plan = getPlanLimits(effectiveTier);
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
 * Concurrency limitation and architecture note:
 * This is a read-then-decide check against an aggregate sum of UsageRecord
 * rows, not an atomic credit reservation.
 *
 * Behavior under concurrent load:
 * - Single-material deduplication: For the same material, `createJobIfNoneActive`
 *   acquires a transaction advisory lock (`job:${type}:${materialId}`), preventing
 *   overlapping jobs from executing simultaneously.
 * - Multi-material race window: If a user near their monthly credit cap fires
 *   simultaneous requests across different materials (e.g. Material A and
 *   Material B) at the same millisecond, both requests will read the same
 *   pre-generation `usedCredits` sum and both may pass `assertWithinAIQuota`.
 * - Bounded overage: Maximum overage is strictly bounded by the user's maximum
 *   concurrent in-flight requests, which is enforced by the per-user rate limiter
 *   (`NOTE_GENERATION_RATE_LIMIT = { limit: 5, windowSeconds: 60 }`). Subsequent
 *   requests immediately re-aggregate the ledger and will be rejected once
 *   the limit is exceeded.
 *
 * Future strict atomic reservation design (if required):
 * If a future phase requires zero-overage hard enforcement without global table locks:
 * 1. Introduce an `AIUsageReservation` model or atomic lease ledger:
 *    - Ingress claims an estimated token reservation (e.g., 5,000 credits) inside
 *      a short transaction checking `(usedCredits + pendingReservations < limitCredits)`.
 *    - Ingress writes a `PENDING` reservation row with an expiration TTL (e.g., 10 minutes).
 * 2. Background worker reconciliation:
 *    - When the worker completes, it records the exact actual tokens from `response.usageMetadata`
 *      and marks the reservation `RESOLVED`.
 *    - If the worker fails or times out, the reservation is marked `RELEASED`.
 * 3. Stale reservation reaper:
 *    - A periodic or on-demand sweep releases any expired `PENDING` reservations older than the TTL.
 *
 * Currently, Zenote follows the lighter-weight append-only ledger pattern across all
 * meters (`getStorageUsage`, `getRecordingUsage`, `getAIUsage`) to avoid lock contention
 * on user rows during read-heavy operations.
 */
export async function assertWithinAIQuota(userId: string): Promise<AIUsageSummary> {
  const usage = await getAIUsage(userId);
  if (usage.usedCredits >= usage.limitCredits) {
    throw new AIQuotaExceededError(usage);
  }
  return usage;
}

/**
 * Thrown by assertAiTutorEntitlement; the route layer maps this to a 403
 * with a stable `AI_TUTOR_NOT_ENABLED` code — same shape/precedent as
 * lib/google-import.ts's `GoogleDriveNotEnabledError`/
 * `assertGoogleDriveSyncAllowed` for `PlanLimits.advancedFeatures.
 * googleDriveSync`, applied here to `advancedFeatures.aiTutor` (Phase
 * 8.4). Kept in this file (not a new file) because it's the same
 * "should this AI action be allowed for this user right now" family as
 * `assertWithinAIQuota` above, and the messages/conversations routes
 * already import from here.
 */
export class AITutorNotEnabledError extends Error {
  constructor(public readonly plan: PlanLimits) {
    super("AI Tutor isn't available on your current plan. Upgrade your plan in Settings to use it.");
    this.name = "AITutorNotEnabledError";
  }
}

/**
 * MUST be called before a TUTOR conversation is created AND before a
 * message is sent to one — checked live from the current subscription on
 * every call (never cached on the conversation itself), so a plan
 * downgrade takes effect immediately, the same "always compute live from
 * source of truth" philosophy `assertWithinAIQuota`/`getStorageUsage`/
 * `getRecordingUsage` already use elsewhere in this codebase.
 */
export async function assertAiTutorEntitlement(userId: string): Promise<void> {
  const subscription = await db.subscription.findUnique({ where: { userId } });
  const effectiveTier =
    !subscription || subscription.status === "CANCELLED"
      ? "FREE"
      : (subscription.plan ?? "FREE");
  const plan = getPlanLimits(effectiveTier);
  if (!plan.advancedFeatures.aiTutor) {
    throw new AITutorNotEnabledError(plan);
  }
}
