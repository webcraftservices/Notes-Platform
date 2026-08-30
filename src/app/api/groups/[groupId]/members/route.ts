import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getAccessibleGroup, NotAuthorizedError } from "@/lib/access";
import { UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

/**
 * Lists every member of a Group with their role and join date. Any group
 * member (including VIEWER — spec §3's permission matrix marks "List
 * members" ✅ for every role) can call this; non-members get the same
 * 404 `getAccessibleGroup` already gives every other group route, so
 * group existence isn't leaked to outsiders.
 */
export async function GET(_req: Request, { params }: { params: { groupId: string } }) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  try {
    const group = await getAccessibleGroup(params.groupId, user.id);
    if (!group) return NOT_FOUND();

    const members = await db.groupMember.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });

    return NextResponse.json({
      members: members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
