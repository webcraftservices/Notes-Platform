import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import { getRecordingUsage } from "@/lib/recording-usage";
import { UNAUTHORIZED } from "@/lib/api-response";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const usage = await getRecordingUsage(user.id);
  return NextResponse.json(usage);
}
