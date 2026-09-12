import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  subscription: { findUnique: vi.fn() },
  usageRecord: { aggregate: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));

import { assertWithinAIQuota, AIQuotaExceededError, getAIUsage } from "@/lib/ai-quota";
import { getPlanLimits } from "@/lib/plans";

describe("getAIUsage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("defaults to the FREE plan when the user has no Subscription row", async () => {
    db.subscription.findUnique.mockResolvedValue(null);
    db.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

    const usage = await getAIUsage("user-1");

    expect(usage.plan).toEqual(getPlanLimits("FREE"));
    expect(usage.usedCredits).toBe(0);
    expect(usage.limitCredits).toBe(getPlanLimits("FREE").aiCreditsPerMonth);
  });

  it("sums only AI_TOKENS_INPUT/AI_TOKENS_OUTPUT for the current calendar month into usedCredits", async () => {
    db.subscription.findUnique.mockResolvedValue({ plan: "PRO" });
    db.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: 500 } });

    const usage = await getAIUsage("user-1");

    expect(db.usageRecord.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          kind: { in: ["AI_TOKENS_INPUT", "AI_TOKENS_OUTPUT"] },
        }),
      })
    );
    expect(usage.usedCredits).toBe(500);
    expect(usage.limitCredits).toBe(getPlanLimits("PRO").aiCreditsPerMonth);
    expect(usage.remainingCredits).toBe(getPlanLimits("PRO").aiCreditsPerMonth - 500);
  });

  it("never returns a negative remainingCredits when usage exceeds the limit", async () => {
    db.subscription.findUnique.mockResolvedValue({ plan: "FREE" });
    db.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: getPlanLimits("FREE").aiCreditsPerMonth + 1000 } });

    const usage = await getAIUsage("user-1");

    expect(usage.remainingCredits).toBe(0);
    expect(usage.percentUsed).toBe(100);
  });
});

describe("assertWithinAIQuota", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("allows a request comfortably within the plan's monthly credit limit", async () => {
    db.subscription.findUnique.mockResolvedValue({ plan: "FREE" });
    db.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: 10 } });

    await expect(assertWithinAIQuota("user-1")).resolves.toMatchObject({ usedCredits: 10 });
  });

  it("rejects a request once usage has reached the plan's monthly credit limit", async () => {
    db.subscription.findUnique.mockResolvedValue({ plan: "FREE" });
    db.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: getPlanLimits("FREE").aiCreditsPerMonth } });

    await expect(assertWithinAIQuota("user-1")).rejects.toThrow(AIQuotaExceededError);
  });

  it("rejects a request that has already exceeded the plan's monthly credit limit", async () => {
    db.subscription.findUnique.mockResolvedValue({ plan: "FREE" });
    db.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: getPlanLimits("FREE").aiCreditsPerMonth + 500 } });

    await expect(assertWithinAIQuota("user-1")).rejects.toThrow(AIQuotaExceededError);
  });

  it("carries the usage summary on the thrown error so the route layer can report used/limit credits", async () => {
    db.subscription.findUnique.mockResolvedValue({ plan: "STUDENT" });
    db.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: getPlanLimits("STUDENT").aiCreditsPerMonth } });

    let caught: unknown;
    await assertWithinAIQuota("user-1").catch((err) => {
      caught = err;
    });

    expect(caught).toBeInstanceOf(AIQuotaExceededError);
    expect((caught as AIQuotaExceededError).usage.limitCredits).toBe(getPlanLimits("STUDENT").aiCreditsPerMonth);
  });
});
