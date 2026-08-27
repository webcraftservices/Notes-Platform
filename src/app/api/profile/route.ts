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

  const [updatedUser, profile] = await db.$transaction([
    name !== undefined
      ? db.user.update({ where: { id: user.id }, data: { name } })
      : db.user.findUniqueOrThrow({ where: { id: user.id } }),
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
