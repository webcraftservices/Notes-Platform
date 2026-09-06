import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/access";
import { disconnectGoogleAccount } from "@/lib/google-connection";
import { UNAUTHORIZED } from "@/lib/api-response";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  await disconnectGoogleAccount(user.id);
  return NextResponse.json({ success: true });
}
