import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/access";
import { updateProfileSchema } from "@/lib/validation/profile";
import { zodError, UNAUTHORIZED } from "@/lib/api-response";

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  const { name, theme, usageIntent } = parsed.data;

  const SAFE_USER_SELECT = {
    id: true,
    name: true,
    email: true,
    image: true,
    updatedAt: true,
  } as const;

  const [updatedUser, profile] = await db.$transaction([
    name !== undefined
      ? db.user.update({ where: { id: user.id }, data: { name }, select: SAFE_USER_SELECT })
      : db.user.findUniqueOrThrow({ where: { id: user.id }, select: SAFE_USER_SELECT }),
    db.profile.update({
      where: { userId: user.id },
      data: {
        ...(theme !== undefined ? { theme } : {}),
        ...(usageIntent !== undefined ? { usageIntent } : {}),
      },
    }),
  ]);

  return NextResponse.json({ user: updatedUser, profile });
}
