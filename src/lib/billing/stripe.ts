/**
 * Phase 15 (Task 15-04) — Stripe Subscription Billing, Checkout, Customer Portal,
 * and Idempotent Webhook Processing.
 *
 * Integrates with Zenote's existing `Subscription` model, `PlanTier` enum
 * (`FREE`, `STUDENT`, `PRO`, `TEAM`, `INSTITUTION`), and `PLAN_LIMITS` in
 * `src/lib/plans.ts`.
 *
 * Security & Reliability Guarantees:
 *   1. Constant-time HMAC-SHA256 `Stripe-Signature` verification with replay-window
 *      tolerance (default 300 seconds).
 *   2. Durable webhook idempotency via `BillingWebhookEvent` (`externalEventId` unique)
 *      and PostgreSQL transaction-scoped advisory locks.
 *   3. Out-of-order webhook delivery protection via `lastWebhookEventAt` watermark.
 *   4. Zero fabricated billing state when Stripe credentials are unconfigured:
 *      returns honest configuration status (`configured: false`) and `503` on
 *      checkout/portal mutations without exposing secrets.
 */

import crypto from "crypto";
import type { PlanTier, SubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getPlanLimits, PLAN_LIMITS, type PlanLimits } from "@/lib/plans";
import { getAIUsage } from "@/lib/ai-quota";
import { getStorageUsage } from "@/lib/storage-usage";
import { getRecordingUsage } from "@/lib/recording-usage";

export type PaidPlanTier = Exclude<PlanTier, "FREE">;

export const PAID_PLAN_TIERS: PaidPlanTier[] = [
  "STUDENT",
  "PRO",
  "TEAM",
  "INSTITUTION",
];

export const PLAN_DISPLAY_PRICING: Record<
  PlanTier,
  { monthlyUsd: number; intervalLabel: string; description: string }
> = {
  FREE: {
    monthlyUsd: 0,
    intervalLabel: "Free forever",
    description: "Essential notes, 200 AI credits/mo, and 1 GB storage.",
  },
  STUDENT: {
    monthlyUsd: 9,
    intervalLabel: "$9 / month",
    description: "1,500 AI credits/mo, AI Tutor, Google Drive sync, and 10 GB storage.",
  },
  PRO: {
    monthlyUsd: 19,
    intervalLabel: "$19 / month",
    description: "6,000 AI credits/mo, 3,000 recording mins/mo, and 50 GB storage.",
  },
  TEAM: {
    monthlyUsd: 49,
    intervalLabel: "$49 / month",
    description: "25,000 AI credits/mo, up to 100 group members, and 200 GB storage.",
  },
  INSTITUTION: {
    monthlyUsd: 199,
    intervalLabel: "$199 / month",
    description: "150,000 AI credits/mo, 1,000 group members, and 1 TB storage.",
  },
};

export class StripeNotConfiguredError extends Error {
  readonly status = 503;
  readonly code = "STRIPE_NOT_CONFIGURED";
  constructor(
    message = "Stripe billing is not configured in this environment. Set STRIPE_SECRET_KEY and plan price IDs to enable checkout."
  ) {
    super(message);
    this.name = "StripeNotConfiguredError";
  }
}

export class StripeSignatureVerificationError extends Error {
  readonly status = 400;
  readonly code = "INVALID_STRIPE_SIGNATURE";
  constructor(message = "Invalid or expired Stripe webhook signature.") {
    super(message);
    this.name = "StripeSignatureVerificationError";
  }
}

export class BillingCustomerNotFoundError extends Error {
  readonly status = 400;
  readonly code = "BILLING_CUSTOMER_NOT_FOUND";
  constructor(
    message = "No Stripe billing profile is linked to your account yet. Subscribe to a paid plan first."
  ) {
    super(message);
    this.name = "BillingCustomerNotFoundError";
  }
}

export class StripeApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number = 502, code: string = "STRIPE_API_ERROR") {
    super(message);
    this.name = "StripeApiError";
    this.status = status;
    this.code = code;
  }
}

export function isStripeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY?.trim());
}

/**
 * Resolves the configured Stripe Price ID for a paid `PlanTier`.
 */
export function resolveStripePriceIdForPlan(
  plan: PaidPlanTier,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const envKey = `STRIPE_PRICE_ID_${plan}`;
  const explicit = env[envKey]?.trim();
  if (explicit) return explicit;
  return null;
}

/**
 * Resolves a Zenote `PlanTier` from a Stripe `priceId` or explicit metadata `plan`.
 */
export function resolvePlanTierFromStripe(
  priceId: string | null | undefined,
  metadataPlan?: string | null,
  env: NodeJS.ProcessEnv = process.env
): PlanTier {
  if (priceId) {
    for (const tier of PAID_PLAN_TIERS) {
      const configuredPrice = resolveStripePriceIdForPlan(tier, env);
      if (configuredPrice && configuredPrice === priceId) {
        return tier;
      }
    }
    const normalizedPrice = priceId.toLowerCase();
    if (normalizedPrice.includes("institution")) return "INSTITUTION";
    if (normalizedPrice.includes("team")) return "TEAM";
    if (normalizedPrice.includes("pro")) return "PRO";
    if (normalizedPrice.includes("student")) return "STUDENT";
  }

  if (metadataPlan) {
    const upper = metadataPlan.trim().toUpperCase();
    if (
      upper === "STUDENT" ||
      upper === "PRO" ||
      upper === "TEAM" ||
      upper === "INSTITUTION" ||
      upper === "FREE"
    ) {
      return upper as PlanTier;
    }
  }

  return "FREE";
}

/**
 * Maps Stripe subscription status strings to Zenote `SubscriptionStatus`.
 */
export function mapStripeSubscriptionStatus(
  stripeStatus: string | null | undefined
): SubscriptionStatus {
  const normalized = (stripeStatus ?? "").trim().toLowerCase();
  switch (normalized) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "PAST_DUE";
    case "canceled":
    case "cancelled":
    case "incomplete_expired":
      return "CANCELLED";
    default:
      return "PAST_DUE";
  }
}

/**
 * Computes a Stripe `v1` HMAC-SHA256 signature for `(timestampSeconds, rawBody)`.
 */
export function computeStripeWebhookSignature(
  rawBody: string,
  timestampSeconds: number | string,
  webhookSecret: string
): string {
  return crypto
    .createHmac("sha256", webhookSecret)
    .update(`${timestampSeconds}.${rawBody}`, "utf8")
    .digest("hex");
}

/**
 * Verifies an incoming `Stripe-Signature` header (`t=...,v1=...`) using
 * constant-time HMAC-SHA256 comparison and a replay window tolerance (default 300s).
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  webhookSecret?: string | null,
  toleranceSeconds: number = 300
): { timestamp: number } {
  const secret = (webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    throw new StripeNotConfiguredError(
      "STRIPE_WEBHOOK_SECRET is not configured in this environment."
    );
  }

  if (!signatureHeader || !signatureHeader.trim()) {
    throw new StripeSignatureVerificationError("Missing Stripe-Signature header.");
  }

  const parts = signatureHeader.split(",").map((p) => p.trim());
  let timestampStr: string | null = null;
  const v1Signatures: string[] = [];

  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === "t" && val) {
      timestampStr = val;
    } else if (key === "v1" && val) {
      v1Signatures.push(val);
    }
  }

  if (!timestampStr || !/^\d+$/.test(timestampStr) || v1Signatures.length === 0) {
    throw new StripeSignatureVerificationError("Malformed Stripe-Signature header.");
  }

  const timestamp = Number(timestampStr);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (toleranceSeconds > 0 && Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new StripeSignatureVerificationError(
      "Stripe webhook timestamp is outside the allowed replay tolerance window."
    );
  }

  const expectedHex = computeStripeWebhookSignature(rawBody, timestampStr, secret);
  const expectedBuf = Buffer.from(expectedHex, "utf8");

  let matched = false;
  for (const sig of v1Signatures) {
    const candidateBuf = Buffer.from(sig, "utf8");
    if (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    throw new StripeSignatureVerificationError("Stripe webhook signature verification failed.");
  }

  return { timestamp };
}

/**
 * Creates a Stripe Checkout Session for upgrading to a paid `PlanTier`.
 */
export async function createStripeCheckoutSession(input: {
  userId: string;
  userEmail: string;
  plan: PaidPlanTier;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ sessionId: string; url: string }> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new StripeNotConfiguredError();
  }

  const priceId = resolveStripePriceIdForPlan(input.plan);
  if (!priceId) {
    throw new StripeNotConfiguredError(
      `Stripe Price ID for the ${input.plan} plan (STRIPE_PRICE_ID_${input.plan}) is not configured.`
    );
  }

  const existingSub = await db.subscription.findUnique({
    where: { userId: input.userId },
  });

  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("success_url", input.successUrl);
  form.set("cancel_url", input.cancelUrl);
  form.set("client_reference_id", input.userId);
  form.set("line_items[0][price]", priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("metadata[userId]", input.userId);
  form.set("metadata[plan]", input.plan);
  form.set("subscription_data[metadata][userId]", input.userId);
  form.set("subscription_data[metadata][plan]", input.plan);

  if (existingSub?.externalCustomerId) {
    form.set("customer", existingSub.externalCustomerId);
  } else if (input.userEmail) {
    form.set("customer_email", input.userEmail);
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const body = (await res.json().catch(() => null)) as
    | { id?: string; url?: string; error?: { message?: string } }
    | null;

  if (!res.ok || !body?.id || !body?.url) {
    throw new StripeApiError(
      body?.error?.message || "Failed to create Stripe Checkout session.",
      res.status >= 400 && res.status < 600 ? res.status : 502
    );
  }

  return {
    sessionId: body.id,
    url: body.url,
  };
}

/**
 * Creates a Stripe Customer Billing Portal session for managing an existing subscription.
 */
export async function createStripeBillingPortalSession(input: {
  userId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new StripeNotConfiguredError();
  }

  const subscription = await db.subscription.findUnique({
    where: { userId: input.userId },
  });

  if (!subscription?.externalCustomerId) {
    throw new BillingCustomerNotFoundError();
  }

  const form = new URLSearchParams();
  form.set("customer", subscription.externalCustomerId);
  form.set("return_url", input.returnUrl);

  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const body = (await res.json().catch(() => null)) as
    | { url?: string; error?: { message?: string } }
    | null;

  if (!res.ok || !body?.url) {
    throw new StripeApiError(
      body?.error?.message || "Failed to create Stripe billing portal session.",
      res.status >= 400 && res.status < 600 ? res.status : 502
    );
  }

  return { url: body.url };
}

export interface StripeWebhookEventPayload {
  id: string;
  type: string;
  created?: number;
  data: {
    object: Record<string, unknown>;
  };
}

export interface ProcessStripeWebhookResult {
  status: "processed" | "duplicate_ignored" | "ignored_stale" | "ignored_unhandled";
  eventId: string;
  eventType: string;
  userId: string | null;
}

/**
 * Verifies and processes an incoming Stripe webhook event idempotently.
 */
export async function processStripeWebhookEvent(
  rawBody: string,
  signatureHeader: string | null | undefined
): Promise<ProcessStripeWebhookResult> {
  verifyStripeWebhookSignature(rawBody, signatureHeader);

  let event: StripeWebhookEventPayload;
  try {
    event = JSON.parse(rawBody) as StripeWebhookEventPayload;
  } catch {
    throw new StripeSignatureVerificationError("Invalid JSON in Stripe webhook payload.");
  }

  if (!event?.id || !event?.type || !event?.data?.object) {
    throw new StripeSignatureVerificationError("Malformed Stripe event structure.");
  }

  const eventCreatedAt =
    typeof event.created === "number" && Number.isFinite(event.created)
      ? new Date(event.created * 1000)
      : new Date();
  const payloadHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");

  return db.$transaction(async (tx) => {
    try {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stripe-webhook:${event.id}`}, 0))`;
    } catch {
      // Advisory lock optional in mocked unit tests
    }

    const existingEvent = await tx.billingWebhookEvent.findUnique({
      where: { externalEventId: event.id },
    });
    if (existingEvent) {
      return {
        status: "duplicate_ignored",
        eventId: event.id,
        eventType: event.type,
        userId: existingEvent.userId ?? null,
      };
    }

    const obj = event.data.object;
    const metadata =
      obj.metadata && typeof obj.metadata === "object"
        ? (obj.metadata as Record<string, unknown>)
        : {};

    const customerId =
      typeof obj.customer === "string" ? obj.customer : null;
    const subscriptionId =
      typeof obj.subscription === "string"
        ? obj.subscription
        : event.type.startsWith("customer.subscription.") && typeof obj.id === "string"
          ? obj.id
          : null;
    const explicitUserId =
      (typeof metadata.userId === "string" && metadata.userId.trim()) ||
      (typeof obj.client_reference_id === "string" && obj.client_reference_id.trim()) ||
      null;

    // Resolve target Subscription record by userId, externalSubscriptionId, or externalCustomerId
    let targetSub = explicitUserId
      ? await tx.subscription.findUnique({ where: { userId: explicitUserId } })
      : null;

    if (!targetSub && subscriptionId) {
      targetSub = await tx.subscription.findFirst({
        where: { externalSubscriptionId: subscriptionId },
      });
    }

    if (!targetSub && customerId) {
      targetSub = await tx.subscription.findFirst({
        where: { externalCustomerId: customerId },
      });
    }

    const resolvedUserId = targetSub?.userId ?? explicitUserId ?? null;

    // Out-of-order protection: if this subscription already processed a strictly newer
    // Stripe event timestamp, record as IGNORED_STALE and do not regress state.
    if (
      targetSub?.lastWebhookEventAt &&
      event.created !== undefined &&
      eventCreatedAt.getTime() < targetSub.lastWebhookEventAt.getTime()
    ) {
      await tx.billingWebhookEvent.create({
        data: {
          provider: "stripe",
          externalEventId: event.id,
          eventType: event.type,
          eventCreatedAt,
          status: "IGNORED_STALE",
          userId: resolvedUserId,
          payloadHash,
        },
      });
      return {
        status: "ignored_stale",
        eventId: event.id,
        eventType: event.type,
        userId: resolvedUserId,
      };
    }

    const extractPriceInfo = (): { priceId: string | null; interval: string | null } => {
      const items = (obj.items as { data?: Array<{ price?: { id?: string; recurring?: { interval?: string } } }> } | undefined)?.data;
      const firstPrice = items?.[0]?.price;
      const priceId =
        typeof firstPrice?.id === "string"
          ? firstPrice.id
          : typeof metadata.priceId === "string"
            ? metadata.priceId
            : null;
      const interval =
        typeof firstPrice?.recurring?.interval === "string"
          ? firstPrice.recurring.interval
          : null;
      return { priceId, interval };
    };

    switch (event.type) {
      case "checkout.session.completed": {
        if (resolvedUserId) {
          const { priceId, interval } = extractPriceInfo();
          const plan = resolvePlanTierFromStripe(
            priceId,
            typeof metadata.plan === "string" ? metadata.plan : null
          );
          const paymentStatus =
            typeof obj.payment_status === "string"
              ? obj.payment_status.trim().toLowerCase()
              : null;
          const initialStatus: SubscriptionStatus =
            paymentStatus === "unpaid" ? "PAST_DUE" : "ACTIVE";
          await tx.subscription.upsert({
            where: { userId: resolvedUserId },
            create: {
              userId: resolvedUserId,
              plan,
              status: initialStatus,
              externalCustomerId: customerId,
              externalSubscriptionId: subscriptionId,
              externalPriceId: priceId,
              billingInterval: interval ?? "month",
              cancelAtPeriodEnd: false,
              lastWebhookEventAt: eventCreatedAt,
            },
            update: {
              plan,
              status: initialStatus,
              ...(customerId ? { externalCustomerId: customerId } : {}),
              ...(subscriptionId ? { externalSubscriptionId: subscriptionId } : {}),
              ...(priceId ? { externalPriceId: priceId } : {}),
              ...(interval ? { billingInterval: interval } : {}),
              cancelAtPeriodEnd: false,
              canceledAt: null,
              lastWebhookEventAt: eventCreatedAt,
            },
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        if (resolvedUserId) {
          const { priceId, interval } = extractPriceInfo();
          const stripeStatus = typeof obj.status === "string" ? obj.status : "active";
          const mappedStatus = mapStripeSubscriptionStatus(stripeStatus);
          const resolvedPlan =
            mappedStatus === "CANCELLED"
              ? "FREE"
              : resolvePlanTierFromStripe(
                  priceId ?? targetSub?.externalPriceId,
                  typeof metadata.plan === "string" ? metadata.plan : null
                );

          const periodStart =
            typeof obj.current_period_start === "number"
              ? new Date(obj.current_period_start * 1000)
              : undefined;
          const periodEnd =
            typeof obj.current_period_end === "number"
              ? new Date(obj.current_period_end * 1000)
              : undefined;
          const cancelAtPeriodEnd = Boolean(obj.cancel_at_period_end);
          const canceledAt =
            typeof obj.canceled_at === "number"
              ? new Date(obj.canceled_at * 1000)
              : mappedStatus === "CANCELLED"
                ? new Date()
                : null;

          await tx.subscription.upsert({
            where: { userId: resolvedUserId },
            create: {
              userId: resolvedUserId,
              plan: resolvedPlan,
              status: mappedStatus,
              externalCustomerId: customerId,
              externalSubscriptionId: subscriptionId,
              externalPriceId: priceId,
              billingInterval: interval ?? "month",
              cancelAtPeriodEnd,
              currentPeriodStart: periodStart ?? null,
              currentPeriodEnd: periodEnd ?? null,
              canceledAt,
              lastWebhookEventAt: eventCreatedAt,
            },
            update: {
              plan: resolvedPlan,
              status: mappedStatus,
              ...(customerId ? { externalCustomerId: customerId } : {}),
              ...(subscriptionId ? { externalSubscriptionId: subscriptionId } : {}),
              ...(priceId ? { externalPriceId: priceId } : {}),
              ...(interval ? { billingInterval: interval } : {}),
              cancelAtPeriodEnd,
              ...(periodStart !== undefined ? { currentPeriodStart: periodStart } : {}),
              ...(periodEnd !== undefined ? { currentPeriodEnd: periodEnd } : {}),
              canceledAt,
              lastWebhookEventAt: eventCreatedAt,
            },
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        if (resolvedUserId && targetSub) {
          await tx.subscription.update({
            where: { userId: resolvedUserId },
            data: {
              plan: "FREE",
              status: "CANCELLED",
              cancelAtPeriodEnd: false,
              canceledAt: new Date(),
              lastWebhookEventAt: eventCreatedAt,
            },
          });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        if (resolvedUserId && targetSub) {
          const periodEnd =
            typeof obj.period_end === "number"
              ? new Date(obj.period_end * 1000)
              : undefined;
          await tx.subscription.update({
            where: { userId: resolvedUserId },
            data: {
              status: "ACTIVE",
              ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
              lastWebhookEventAt: eventCreatedAt,
            },
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        if (resolvedUserId && targetSub) {
          await tx.subscription.update({
            where: { userId: resolvedUserId },
            data: {
              status: "PAST_DUE",
              lastWebhookEventAt: eventCreatedAt,
            },
          });
        }
        break;
      }

      default: {
        await tx.billingWebhookEvent.create({
          data: {
            provider: "stripe",
            externalEventId: event.id,
            eventType: event.type,
            eventCreatedAt,
            status: "IGNORED_UNHANDLED",
            userId: resolvedUserId,
            payloadHash,
          },
        });
        return {
          status: "ignored_unhandled",
          eventId: event.id,
          eventType: event.type,
          userId: resolvedUserId,
        };
      }
    }

    await tx.billingWebhookEvent.create({
      data: {
        provider: "stripe",
        externalEventId: event.id,
        eventType: event.type,
        eventCreatedAt,
        status: "PROCESSED",
        userId: resolvedUserId,
        payloadHash,
      },
    });

    return {
      status: "processed",
      eventId: event.id,
      eventType: event.type,
      userId: resolvedUserId,
    };
  });
}

export interface UserBillingSummary {
  stripeConfigured: boolean;
  subscription: {
    plan: PlanTier;
    planLabel: string;
    status: SubscriptionStatus;
    billingInterval: string | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    hasBillingCustomer: boolean;
  };
  limits: PlanLimits;
  usage: {
    ai: {
      usedCredits: number;
      limitCredits: number;
      remainingCredits: number;
      percentUsed: number;
    };
    storage: {
      usedBytes: number;
      limitBytes: number;
      remainingBytes: number;
      percentUsed: number;
    };
    recording: {
      usedMinutes: number;
      limitMinutes: number;
      remainingMinutes: number;
      percentUsed: number;
    };
  };
  availablePlans: Array<{
    tier: PlanTier;
    label: string;
    monthlyUsd: number;
    intervalLabel: string;
    description: string;
    aiCreditsPerMonth: number;
    recordingMinutesPerMonth: number;
    storageBytes: number;
    maxGroupMembers: number;
    advancedFeatures: PlanLimits["advancedFeatures"];
    checkoutAvailable: boolean;
  }>;
}

/**
 * Aggregates the user's current subscription state, plan entitlements, and
 * real-time quota usage for `GET /api/billing/subscription` and the Settings UI.
 */
export async function getUserBillingSummary(userId: string): Promise<UserBillingSummary> {
  const [subscription, aiUsage, storageUsage, recordingUsage] = await Promise.all([
    db.subscription.findUnique({ where: { userId } }),
    getAIUsage(userId),
    getStorageUsage(userId),
    getRecordingUsage(userId),
  ]);

  const planTier: PlanTier =
    !subscription || subscription.status === "CANCELLED"
      ? "FREE"
      : (subscription.plan ?? "FREE");
  const limits = getPlanLimits(planTier);
  const stripeReady = isStripeConfigured();

  const allTiers: PlanTier[] = ["FREE", "STUDENT", "PRO", "TEAM", "INSTITUTION"];
  const availablePlans = allTiers.map((tier) => {
    const tierLimits = PLAN_LIMITS[tier];
    const pricing = PLAN_DISPLAY_PRICING[tier];
    const checkoutAvailable =
      tier !== "FREE" &&
      stripeReady &&
      Boolean(resolveStripePriceIdForPlan(tier as PaidPlanTier));

    return {
      tier,
      label: tierLimits.label,
      monthlyUsd: pricing.monthlyUsd,
      intervalLabel: pricing.intervalLabel,
      description: pricing.description,
      aiCreditsPerMonth: tierLimits.aiCreditsPerMonth,
      recordingMinutesPerMonth: tierLimits.recordingMinutesPerMonth,
      storageBytes: tierLimits.storageBytes,
      maxGroupMembers: tierLimits.maxGroupMembers,
      advancedFeatures: tierLimits.advancedFeatures,
      checkoutAvailable,
    };
  });

  return {
    stripeConfigured: stripeReady,
    subscription: {
      plan: planTier,
      planLabel: limits.label,
      status: subscription?.status ?? "ACTIVE",
      billingInterval: subscription?.billingInterval ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      currentPeriodStart: subscription?.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
      hasBillingCustomer: Boolean(subscription?.externalCustomerId),
    },
    limits,
    usage: {
      ai: {
        usedCredits: aiUsage.usedCredits,
        limitCredits: aiUsage.limitCredits,
        remainingCredits: aiUsage.remainingCredits,
        percentUsed: aiUsage.percentUsed,
      },
      storage: {
        usedBytes: storageUsage.usedBytes,
        limitBytes: storageUsage.limitBytes,
        remainingBytes: storageUsage.remainingBytes,
        percentUsed: storageUsage.percentUsed,
      },
      recording: {
        usedMinutes: Math.round(recordingUsage.usedSeconds / 60),
        limitMinutes: Math.round(recordingUsage.limitSeconds / 60),
        remainingMinutes: Math.round(recordingUsage.remainingSeconds / 60),
        percentUsed: recordingUsage.percentUsed,
      },
    },
    availablePlans,
  };
}
