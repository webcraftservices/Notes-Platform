import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-response";
import {
  processStripeWebhookEvent,
  StripeNotConfiguredError,
  StripeSignatureVerificationError,
} from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text().catch(() => "");

  if (!rawBody) {
    return jsonError("Missing Stripe webhook payload body.", 400, {
      code: "EMPTY_WEBHOOK_BODY",
    });
  }

  try {
    const result = await processStripeWebhookEvent(rawBody, signature);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    if (err instanceof StripeSignatureVerificationError) {
      return jsonError(err.message, err.status, { code: err.code });
    }
    if (err instanceof StripeNotConfiguredError) {
      return jsonError(err.message, err.status, { code: err.code });
    }
    return jsonError("Failed to process Stripe webhook event.", 500, {
      code: "WEBHOOK_PROCESSING_FAILED",
    });
  }
}

