import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/access";
import { jsonError, UNAUTHORIZED, zodError } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import {
  InvalidBillingRedirectError,
  resolveSafeBillingRedirectUrl,
} from "@/lib/billing/redirect-origin";
import {
  createStripeCheckoutSession,
  PAID_PLAN_TIERS,
  StripeApiError,
  StripeNotConfiguredError,
  type PaidPlanTier,
} from "@/lib/billing/stripe";

const checkoutSchema = z.object({
  plan: z.enum(["STUDENT", "PRO", "TEAM", "INSTITUTION"]),
  successUrl: z.string().min(1).optional(),
  cancelUrl: z.string().min(1).optional(),
});

const CHECKOUT_RATE_LIMIT = { limit: 10, windowSeconds: 60 };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success: withinLimit } = await rateLimit(
    `billing-checkout:${user.id}`,
    CHECKOUT_RATE_LIMIT
  );
  if (!withinLimit) {
    return jsonError(
      "Too many checkout requests. Please wait a moment and try again.",
      429,
      { code: "BILLING_RATE_LIMITED" }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  const plan = parsed.data.plan as PaidPlanTier;
  if (!PAID_PLAN_TIERS.includes(plan)) {
    return jsonError("Unsupported subscription plan tier.", 400);
  }

  let successUrl: string;
  let cancelUrl: string;
  try {
    successUrl = resolveSafeBillingRedirectUrl(
      parsed.data.successUrl,
      req.url,
      "/settings?billing=success"
    );
    cancelUrl = resolveSafeBillingRedirectUrl(
      parsed.data.cancelUrl,
      req.url,
      "/settings?billing=cancelled"
    );
  } catch (err) {
    if (err instanceof InvalidBillingRedirectError) {
      return jsonError(err.message, err.status, { code: err.code });
    }
    throw err;
  }

  try {
    const session = await createStripeCheckoutSession({
      userId: user.id,
      userEmail: user.email ?? "",
      plan,
      successUrl,
      cancelUrl,
    });

    return NextResponse.json(session, { status: 200 });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return jsonError(err.message, err.status, { code: err.code });
    }
    if (err instanceof StripeApiError) {
      return jsonError(err.message, err.status, { code: err.code });
    }
    throw err;
  }
}

