import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/access";
import { createGroupSchema } from "@/lib/validation/groups";
import { zodError, UNAUTHORIZED } from "@/lib/api-response";

/** Lists every Group the caller belongs to, with their role and member count. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const memberships = await db.groupMember.findMany({
    where: { userId: user.id, group: { deletedAt: null } },
    include: { group: { include: { _count: { select: { members: true } } } } },
    orderBy: { joinedAt: "desc" },
  });

  const groups = memberships.map((membership) => ({
    id: membership.group.id,
    name: membership.group.name,
    description: membership.group.description,
    role: membership.role,
    memberCount: membership.group._count.members,
    createdAt: membership.group.createdAt,
    updatedAt: membership.group.updatedAt,
  }));

  return NextResponse.json({ groups });
}

/**
 * Creates a Group and makes the caller its OWNER. Group.ownerId and the
 * OWNER GroupMember row are created inside a single transaction so the
 * "exactly one OWNER" invariant (spec §34) is never briefly broken by a
 * partial write — a crash between the two inserts is impossible, not just
 * unlikely.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  const group = await db.$transaction(async (tx) => {
    const created = await tx.group.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        ownerId: user.id,
      },
    });
    await tx.groupMember.create({
      data: { groupId: created.id, userId: user.id, role: "OWNER" },
    });
    return created;
  });

  return NextResponse.json({ group: { ...group, role: "OWNER", memberCount: 1 } }, { status: 201 });
}
