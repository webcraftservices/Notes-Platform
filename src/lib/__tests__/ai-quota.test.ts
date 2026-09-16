import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  subscription: { findUnique: vi.fn() },
  usageRecord: { aggregate: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));

import { assertWithinAIQuota, AIQuotaExceededError, getAIUsage, assertAiTutorEntitlement, AITutorNotEnabledError } from "@/lib/ai-quota";
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

/**
 * Phase 8.4 — plan entitlement enforcement. The audit found `aiTutor` was
 * declared per plan in lib/plans.ts but read nowhere else in the
 * codebase, so a FREE-tier user faced no actual restriction. These tests
 * exercise the real `assertAiTutorEntitlement`/`getPlanLimits` (only `db`
 * is mocked, same boundary as every other test in this file) to prove
 * the flag is now genuinely enforced, not just declared.
 */
describe("assertAiTutorEntitlement", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects with AITutorNotEnabledError when the user's plan has aiTutor: false", async () => {
    db.subscription.findUnique.mockResolvedValue({ plan: "FREE" });
    expect(getPlanLimits("FREE").advancedFeatures.aiTutor).toBe(false);

    await expect(assertAiTutorEntitlement("user-1")).rejects.toThrow(AITutorNotEnabledError);
  });

  it("defaults an unsubscribed user (no Subscription row) to FREE, which does not have aiTutor", async () => {
    db.subscription.findUnique.mockResolvedValue(null);

    await expect(assertAiTutorEntitlement("user-1")).rejects.toThrow(AITutorNotEnabledError);
  });

  it("allows a plan with aiTutor: true", async () => {
    db.subscription.findUnique.mockResolvedValue({ plan: "STUDENT" });
    expect(getPlanLimits("STUDENT").advancedFeatures.aiTutor).toBe(true);

    await expect(assertAiTutorEntitlement("user-1")).resolves.toBeUndefined();
  });

  it("carries the plan on the thrown error so the route layer can report it", async () => {
    db.subscription.findUnique.mockResolvedValue({ plan: "FREE" });

    let caught: unknown;
    await assertAiTutorEntitlement("user-1").catch((err) => {
      caught = err;
    });

    expect(caught).toBeInstanceOf(AITutorNotEnabledError);
    expect((caught as AITutorNotEnabledError).plan).toEqual(getPlanLimits("FREE"));
  });
});
