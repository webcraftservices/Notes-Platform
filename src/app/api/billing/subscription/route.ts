import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import { UNAUTHORIZED } from "@/lib/api-response";
import { getUserBillingSummary } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const summary = await getUserBillingSummary(user.id);
  return NextResponse.json(summary);
}

