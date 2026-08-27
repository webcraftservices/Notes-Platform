import { db } from "@/lib/db";
import { getPlanLimits } from "@/lib/plans";

/**
 * Sums actual stored bytes across a user's non-deleted materials. Real
 * usage tracking (spec §61 — tokens, minutes, full UsageRecord ledger)
 * is Phase 9; this is the one piece of it Phase 3 needs to make storage
 * limits actually enforceable rather than decorative.
 */
export async function getStorageUsage(userId: string) {
  const [subscription, aggregate] = await Promise.all([
    db.subscription.findUnique({ where: { userId } }),
    db.material.aggregate({
      where: { ownerId: userId, deletedAt: null },
      _sum: { sizeBytes: true },
    }),
  ]);

  const plan = getPlanLimits(subscription?.plan ?? "FREE");
  const usedBytes = aggregate._sum.sizeBytes ?? 0;

  return {
    plan,
    usedBytes,
    limitBytes: plan.storageBytes,
    percentUsed: Math.min(100, Math.round((usedBytes / plan.storageBytes) * 100)),
    remainingBytes: Math.max(0, plan.storageBytes - usedBytes),
  };
}
