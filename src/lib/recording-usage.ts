import { db } from "@/lib/db";
import { getPlanLimits } from "@/lib/plans";

/**
 * Tracks against `recordingMinutesPerMonth` specifically — the plan
 * concept named for the in-app Recorder, not general audio storage (that's
 * `storageBytes`, enforced separately in lib/storage-usage.ts). Computed
 * from real Material rows (AUDIO/VIDEO, created this calendar month), not
 * a separate ledger — Phase 9's full UsageRecord ledger can replace this
 * math later without changing what it means.
 */
export async function getRecordingUsage(userId: string) {
  const [subscription, startOfMonth] = await Promise.all([
    db.subscription.findUnique({ where: { userId } }),
    Promise.resolve(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  ]);

  const aggregate = await db.material.aggregate({
    where: {
      ownerId: userId,
      deletedAt: null,
      type: { in: ["AUDIO", "VIDEO"] },
      createdAt: { gte: startOfMonth },
    },
    _sum: { durationSeconds: true },
  });

  const plan = getPlanLimits(subscription?.plan ?? "FREE");
  const usedSeconds = aggregate._sum.durationSeconds ?? 0;
  const limitSeconds = plan.recordingMinutesPerMonth * 60;

  return {
    plan,
    usedSeconds,
    limitSeconds,
    remainingSeconds: Math.max(0, limitSeconds - usedSeconds),
    percentUsed: Math.min(100, Math.round((usedSeconds / limitSeconds) * 100)),
  };
}
