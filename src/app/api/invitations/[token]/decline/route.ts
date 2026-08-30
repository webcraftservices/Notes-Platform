import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/access";
import { normalizeEmail } from "@/lib/email";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN, CONFLICT } from "@/lib/api-response";

/**
 * Declines a Group invitation. Mirrors `accept/route.ts`'s validation
 * order (not-found -> already-used -> expired -> email match) so the two
 * endpoints behave identically up to the point they diverge: decline
 * never creates a GroupMember, just flips status to DECLINED using the
 * same conditional-`updateMany` idiom for safe repeated/concurrent calls.
 */
export async function POST(_req: Request, { params }: { params: { token: string } }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return UNAUTHORIZED();

  const invitation = await db.groupInvitation.findUnique({ where: { token: params.token } });
  if (!invitation) return NOT_FOUND();

  if (invitation.status !== "PENDING") {
    // Repeated decline of an already-declined invitation is treated as a
    // harmless no-op success rather than an error — the caller's desired
    // end state (not a member) already holds. Any other terminal status
    // (ACCEPTED/EXPIRED) is a genuine conflict.
    if (invitation.status === "DECLINED") {
      return NextResponse.json({ success: true });
    }
    return CONFLICT("This invitation has already been used.");
  }

  if (invitation.expiresAt < new Date()) {
    await db.groupInvitation.updateMany({
      where: { token: params.token, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    return CONFLICT("This invitation has expired.");
  }

  const dbUser = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, email: true },
  });
  if (!dbUser) return UNAUTHORIZED();

  if (normalizeEmail(dbUser.email) !== normalizeEmail(invitation.email)) {
    return FORBIDDEN();
  }

  await db.groupInvitation.updateMany({
    where: { token: params.token, status: "PENDING" },
    data: { status: "DECLINED" },
  });

  return NextResponse.json({ success: true });
}
