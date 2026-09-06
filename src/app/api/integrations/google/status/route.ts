import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import { getGoogleConnectionStatus } from "@/lib/google-connection";
import { getPlanLimits } from "@/lib/plans";
import { db } from "@/lib/db";
import { UNAUTHORIZED } from "@/lib/api-response";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const [status, subscription] = await Promise.all([
    getGoogleConnectionStatus(user.id),
    db.subscription.findUnique({ where: { userId: user.id } }),
  ]);
  const plan = getPlanLimits(subscription?.plan ?? "FREE");

  return NextResponse.json({ ...status, enabledOnPlan: plan.advancedFeatures.googleDriveSync });
}
