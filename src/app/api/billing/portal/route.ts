import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import { jsonError, UNAUTHORIZED } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import {
  InvalidBillingRedirectError,
  resolveSafeBillingRedirectUrl,
} from "@/lib/billing/redirect-origin";
import {
  BillingCustomerNotFoundError,
  createStripeBillingPortalSession,
  StripeApiError,
  StripeNotConfiguredError,
} from "@/lib/billing/stripe";

const PORTAL_RATE_LIMIT = { limit: 10, windowSeconds: 60 };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { success: withinLimit } = await rateLimit(
    `billing-portal:${user.id}`,
    PORTAL_RATE_LIMIT
  );
  if (!withinLimit) {
    return jsonError(
      "Too many billing portal requests. Please wait a moment and try again.",
      429,
      { code: "BILLING_RATE_LIMITED" }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { returnUrl?: unknown };
  let returnUrl: string;
  try {
    returnUrl = resolveSafeBillingRedirectUrl(
      body?.returnUrl,
      req.url,
      "/settings"
    );
  } catch (err) {
    if (err instanceof InvalidBillingRedirectError) {
      return jsonError(err.message, err.status, { code: err.code });
    }
    throw err;
  }

  try {
    const portal = await createStripeBillingPortalSession({
      userId: user.id,
      returnUrl,
    });
    return NextResponse.json(portal, { status: 200 });
  } catch (err) {
    if (err instanceof BillingCustomerNotFoundError) {
      return jsonError(err.message, err.status, { code: err.code });
    }
    if (err instanceof StripeNotConfiguredError) {
      return jsonError(err.message, err.status, { code: err.code });
    }
    if (err instanceof StripeApiError) {
      return jsonError(err.message, err.status, { code: err.code });
    }
    throw err;
  }
}

