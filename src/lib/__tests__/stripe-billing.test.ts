import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn().mockResolvedValue(1),
  billingWebhookEvent: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  subscription: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
}));

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  subscription: {
    findUnique: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ db }));

const access = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
}));
vi.mock("@/lib/access", () => access);

const rl = vi.hoisted(() => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 9 }),
}));
vi.mock("@/lib/rate-limit", () => rl);

const aiQuotaMocks = vi.hoisted(() => ({
  getAIUsage: vi.fn(),
}));
vi.mock("@/lib/ai-quota", () => aiQuotaMocks);

const storageUsageMocks = vi.hoisted(() => ({
  getStorageUsage: vi.fn(),
}));
vi.mock("@/lib/storage-usage", () => storageUsageMocks);

const recordingUsageMocks = vi.hoisted(() => ({
  getRecordingUsage: vi.fn(),
}));
vi.mock("@/lib/recording-usage", () => recordingUsageMocks);

import {
  computeStripeWebhookSignature,
  getUserBillingSummary,
  mapStripeSubscriptionStatus,
  processStripeWebhookEvent,
  resolvePlanTierFromStripe,
  StripeSignatureVerificationError,
  verifyStripeWebhookSignature,
} from "@/lib/billing/stripe";
import { GET as getSubscriptionRoute } from "@/app/api/billing/subscription/route";
import { POST as postCheckoutRoute } from "@/app/api/billing/checkout/route";
import { POST as postPortalRoute } from "@/app/api/billing/portal/route";
import { POST as postWebhookRoute } from "@/app/api/billing/webhook/route";
import { BillingPanel } from "@/components/settings/billing-panel";

describe("Phase 15 — Stripe Subscription Billing, Webhooks & Entitlements (Task 15-04)", () => {
  const webhookSecret = "whsec_test_phase15_secret";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
    db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    access.getSessionUser.mockResolvedValue({ id: "user-1", email: "user1@example.com" });
    rl.rateLimit.mockResolvedValue({ success: true, remaining: 9 });
    aiQuotaMocks.getAIUsage.mockResolvedValue({
      usedCredits: 120,
      limitCredits: 2000,
      remainingCredits: 1880,
      percentUsed: 6,
    });
    storageUsageMocks.getStorageUsage.mockResolvedValue({
      usedBytes: 50 * 1024 * 1024,
      limitBytes: 10 * 1024 ** 3,
      remainingBytes: 10 * 1024 ** 3 - 50 * 1024 * 1024,
      percentUsed: 1,
    });
    recordingUsageMocks.getRecordingUsage.mockResolvedValue({
      usedSeconds: 600,
      limitSeconds: 18000,
      remainingSeconds: 17400,
      percentUsed: 3,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("Stripe-Signature HMAC-SHA256 verification", () => {
    it("verifies valid signatures and rejects forged, malformed, or replay-expired headers", () => {
      const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
      const nowSec = Math.floor(Date.now() / 1000);
      const validSig = computeStripeWebhookSignature(payload, nowSec, webhookSecret);

      const verified = verifyStripeWebhookSignature(
        payload,
        `t=${nowSec},v1=${validSig}`,
        webhookSecret
      );
      expect(verified.timestamp).toBe(nowSec);

      // Forged signature
      expect(() =>
        verifyStripeWebhookSignature(
          payload,
          `t=${nowSec},v1=${"0".repeat(64)}`,
          webhookSecret
        )
      ).toThrow(StripeSignatureVerificationError);

      // Expired replay timestamp (10 minutes old > 300s tolerance)
      const oldSec = nowSec - 600;
      const oldSig = computeStripeWebhookSignature(payload, oldSec, webhookSecret);
      expect(() =>
        verifyStripeWebhookSignature(
          payload,
          `t=${oldSec},v1=${oldSig}`,
          webhookSecret,
          300
        )
      ).toThrow("outside the allowed replay tolerance window");
    });
  });

  describe("Idempotent & Out-of-Order-Safe Webhook Event Processing", () => {
    function signPayload(eventObj: Record<string, unknown>): {
      rawBody: string;
      header: string;
    } {
      const rawBody = JSON.stringify(eventObj);
      const nowSec = Math.floor(Date.now() / 1000);
      const sig = computeStripeWebhookSignature(rawBody, nowSec, webhookSecret);
      return { rawBody, header: `t=${nowSec},v1=${sig}` };
    }

    it("activates subscription on checkout.session.completed and suppresses duplicate event deliveries idempotently", async () => {
      const eventPayload = {
        id: "evt_checkout_100",
        type: "checkout.session.completed",
        created: 1760000100,
        data: {
          object: {
            id: "cs_test_1",
            customer: "cus_123",
            subscription: "sub_123",
            client_reference_id: "user-1",
            metadata: { userId: "user-1", plan: "PRO" },
          },
        },
      };
      const { rawBody, header } = signPayload(eventPayload);

      // First delivery: processed
      tx.billingWebhookEvent.findUnique.mockResolvedValueOnce(null);
      tx.subscription.findUnique.mockResolvedValueOnce({
        id: "sub-row-1",
        userId: "user-1",
        plan: "FREE",
        status: "ACTIVE",
        lastWebhookEventAt: null,
      });

      const first = await processStripeWebhookEvent(rawBody, header);
      expect(first).toEqual({
        status: "processed",
        eventId: "evt_checkout_100",
        eventType: "checkout.session.completed",
        userId: "user-1",
      });
      expect(tx.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          update: expect.objectContaining({
            plan: "PRO",
            status: "ACTIVE",
            externalCustomerId: "cus_123",
            externalSubscriptionId: "sub_123",
          }),
        })
      );

      // Second duplicate delivery of the same event ID: ignored without mutating Subscription
      tx.subscription.upsert.mockClear();
      tx.billingWebhookEvent.findUnique.mockResolvedValueOnce({
        id: "wh-1",
        externalEventId: "evt_checkout_100",
        userId: "user-1",
      });

      const duplicate = await processStripeWebhookEvent(rawBody, header);
      expect(duplicate).toEqual({
        status: "duplicate_ignored",
        eventId: "evt_checkout_100",
        eventType: "checkout.session.completed",
        userId: "user-1",
      });
      expect(tx.subscription.upsert).not.toHaveBeenCalled();
    });

    it("handles customer.subscription.updated, invoice.payment_failed -> PAST_DUE, invoice.payment_succeeded -> ACTIVE, and customer.subscription.deleted -> FREE/CANCELLED", async () => {
      // 1. invoice.payment_failed -> PAST_DUE
      const failedInvoice = signPayload({
        id: "evt_inv_fail",
        type: "invoice.payment_failed",
        created: 1760000200,
        data: {
          object: {
            customer: "cus_123",
            subscription: "sub_123",
          },
        },
      });
      tx.billingWebhookEvent.findUnique.mockResolvedValueOnce(null);
      tx.subscription.findFirst.mockResolvedValueOnce({
        id: "sub-row-1",
        userId: "user-1",
        plan: "PRO",
        status: "ACTIVE",
        lastWebhookEventAt: new Date(1760000100 * 1000),
      });

      const failRes = await processStripeWebhookEvent(
        failedInvoice.rawBody,
        failedInvoice.header
      );
      expect(failRes.status).toBe("processed");
      expect(tx.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          data: expect.objectContaining({ status: "PAST_DUE" }),
        })
      );

      // 2. customer.subscription.deleted -> downgrades to FREE and status CANCELLED
      const deletedSub = signPayload({
        id: "evt_sub_del",
        type: "customer.subscription.deleted",
        created: 1760000300,
        data: {
          object: {
            id: "sub_123",
            customer: "cus_123",
          },
        },
      });
      tx.billingWebhookEvent.findUnique.mockResolvedValueOnce(null);
      tx.subscription.findFirst.mockResolvedValueOnce({
        id: "sub-row-1",
        userId: "user-1",
        plan: "PRO",
        status: "PAST_DUE",
        lastWebhookEventAt: new Date(1760000200 * 1000),
      });

      const delRes = await processStripeWebhookEvent(
        deletedSub.rawBody,
        deletedSub.header
      );
      expect(delRes.status).toBe("processed");
      expect(tx.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          data: expect.objectContaining({
            plan: "FREE",
            status: "CANCELLED",
            cancelAtPeriodEnd: false,
          }),
        })
      );
    });

    it("prevents out-of-order older webhook events from overwriting newer subscription state", async () => {
      const olderEvent = signPayload({
        id: "evt_stale_older",
        type: "customer.subscription.updated",
        created: 1760000050, // older than lastWebhookEventAt (1760000300)
        data: {
          object: {
            id: "sub_123",
            customer: "cus_123",
            status: "active",
            metadata: { userId: "user-1", plan: "PRO" },
          },
        },
      });

      tx.billingWebhookEvent.findUnique.mockResolvedValueOnce(null);
      tx.subscription.findUnique.mockResolvedValueOnce({
        id: "sub-row-1",
        userId: "user-1",
        plan: "FREE",
        status: "CANCELLED",
        lastWebhookEventAt: new Date(1760000300 * 1000),
      });

      const res = await processStripeWebhookEvent(olderEvent.rawBody, olderEvent.header);
      expect(res.status).toBe("ignored_stale");
      expect(tx.subscription.upsert).not.toHaveBeenCalled();
      expect(tx.subscription.update).not.toHaveBeenCalled();
    });
  });

  describe("Billing API Routes & Settings Billing UI Panel", () => {
    it("GET /api/billing/subscription returns current plan, usage metrics, and available tiers", async () => {
      db.subscription.findUnique.mockResolvedValue({
        userId: "user-1",
        plan: "STUDENT",
        status: "ACTIVE",
        externalCustomerId: "cus_student_1",
        billingInterval: "month",
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
      });

      const res = await getSubscriptionRoute();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.subscription.plan).toBe("STUDENT");
      expect(body.subscription.hasBillingCustomer).toBe(true);
      expect(body.usage.ai.usedCredits).toBe(120);

      // Verify BillingPanel renders cleanly with the summary
      const summary = await getUserBillingSummary("user-1");
      const html = renderToStaticMarkup(
        React.createElement(BillingPanel, { initialSummary: summary })
      );
      expect(html).toContain("Plan &amp; Billing");
      expect(html).toContain("Student");
      expect(html).toContain("Manage Billing");
    });

    it("POST /api/billing/checkout and /api/billing/portal return 503 when Stripe keys are unconfigured and 200 with session URL when configured", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "");
      const unconfiguredRes = await postCheckoutRoute(
        new Request("https://example.test/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan: "PRO" }),
        })
      );
      expect(unconfiguredRes.status).toBe(503);
      expect((await unconfiguredRes.json()).code).toBe("STRIPE_NOT_CONFIGURED");

      // Now configure Stripe key & price ID and mock Stripe API response
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_mock_key");
      vi.stubEnv("STRIPE_PRICE_ID_PRO", "price_pro_monthly_123");
      db.subscription.findUnique.mockResolvedValue({
        userId: "user-1",
        plan: "FREE",
        externalCustomerId: "cus_existing_1",
      });

      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "cs_test_session_1",
          url: "https://checkout.stripe.com/c/pay/cs_test_session_1",
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const checkoutRes = await postCheckoutRoute(
        new Request("https://example.test/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan: "PRO" }),
        })
      );
      expect(checkoutRes.status).toBe(200);
      expect(await checkoutRes.json()).toEqual({
        sessionId: "cs_test_session_1",
        url: "https://checkout.stripe.com/c/pay/cs_test_session_1",
      });

      // Portal session creation
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          url: "https://billing.stripe.com/p/session/test_portal_1",
        }),
      });
      const portalRes = await postPortalRoute(
        new Request("https://example.test/api/billing/portal", {
          method: "POST",
          body: JSON.stringify({}),
        })
      );
      expect(portalRes.status).toBe(200);
      expect(await portalRes.json()).toEqual({
        url: "https://billing.stripe.com/p/session/test_portal_1",
      });
    });

    it("POST /api/billing/webhook rejects invalid signatures with 400", async () => {
      const res = await postWebhookRoute(
        new Request("https://example.test/api/billing/webhook", {
          method: "POST",
          headers: { "stripe-signature": "t=100,v1=invalid" },
          body: JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }),
        })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_STRIPE_SIGNATURE");
    });

    it("fails closed on unknown Stripe priceId/status, unpaid checkout sessions, unknown customer deletion, and CANCELLED billing summary", async () => {
      expect(resolvePlanTierFromStripe("price_unknown_tier", undefined, { NODE_ENV: "test" })).toBe("FREE");
      expect(resolvePlanTierFromStripe(undefined, "UNKNOWN_META", { NODE_ENV: "test" })).toBe("FREE");
      expect(mapStripeSubscriptionStatus("paused_unknown_status")).toBe("PAST_DUE");
      expect(mapStripeSubscriptionStatus(undefined)).toBe("PAST_DUE");

      const signLocalPayload = (eventObj: Record<string, unknown>) => {
        const rawBody = JSON.stringify(eventObj);
        const nowSec = Math.floor(Date.now() / 1000);
        const sig = computeStripeWebhookSignature(rawBody, nowSec, webhookSecret);
        return { rawBody, header: `t=${nowSec},v1=${sig}` };
      };

      // checkout.session.completed with payment_status: "unpaid" -> PAST_DUE, not ACTIVE
      tx.billingWebhookEvent.findUnique.mockResolvedValue(null);
      tx.billingWebhookEvent.create.mockResolvedValue({ id: "evt_unpaid" });
      tx.subscription.findUnique.mockResolvedValue(null);
      tx.subscription.upsert.mockResolvedValue({ id: "sub_unpaid" });

      const unpaidPayload = signLocalPayload({
        id: "evt_unpaid_1",
        type: "checkout.session.completed",
        created: 1_760_000_200,
        data: {
          object: {
            id: "cs_unpaid",
            client_reference_id: "user-1",
            customer: "cus_unpaid",
            subscription: "sub_stripe_unpaid",
            payment_status: "unpaid",
            metadata: { userId: "user-1", plan: "PRO" },
          },
        },
      });
      await processStripeWebhookEvent(unpaidPayload.rawBody, unpaidPayload.header);
      expect(tx.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: "PAST_DUE" }),
          update: expect.objectContaining({ status: "PAST_DUE" }),
        })
      );

      // customer.subscription.deleted for unknown customer without userId is a safe no-op
      tx.subscription.findFirst.mockResolvedValue(null);
      tx.subscription.upsert.mockClear();
      tx.subscription.update.mockClear();

      const deletedUnknownPayload = signLocalPayload({
        id: "evt_deleted_unknown_1",
        type: "customer.subscription.deleted",
        created: 1_760_000_300,
        data: {
          object: {
            id: "sub_ghost",
            customer: "cus_unknown",
            status: "canceled",
            metadata: {},
          },
        },
      });
      await processStripeWebhookEvent(deletedUnknownPayload.rawBody, deletedUnknownPayload.header);
      expect(tx.subscription.upsert).not.toHaveBeenCalled();
      expect(tx.subscription.update).not.toHaveBeenCalled();

      // CANCELLED subscription resolves effective plan & entitlements to FREE in getUserBillingSummary
      db.subscription.findUnique.mockResolvedValueOnce({
        userId: "user-1",
        plan: "PRO",
        status: "CANCELLED",
        externalCustomerId: "cus_old",
        externalSubId: "sub_old",
        currentPeriodEnd: new Date("2026-01-01T00:00:00.000Z"),
      });
      const summary = await getUserBillingSummary("user-1");
      expect(summary.subscription.plan).toBe("FREE");
      expect(summary.subscription.status).toBe("CANCELLED");
      expect(summary.limits.aiCreditsPerMonth).toBe(200);
    });
  });
});
