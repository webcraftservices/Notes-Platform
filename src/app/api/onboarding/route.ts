import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getPrimaryWorkspace } from "@/lib/access";
import { onboardingSchema } from "@/lib/validation/profile";
import { zodError, UNAUTHORIZED } from "@/lib/api-response";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  const { usageIntent, firstSubjectName } = parsed.data;
  const workspace = await getPrimaryWorkspace(user.id);

  // Workspace "mode" (STUDY vs MEETING) follows the intent the user picked
  // — this is what later phases use to choose the AI note template (spec §16).
  const workspaceMode = usageIntent === "MEETINGS" ? "MEETING" : "STUDY";

  await db.$transaction([
    db.profile.update({
      where: { userId: user.id },
      data: { usageIntent, onboardedAt: new Date() },
    }),
    db.workspace.update({
      where: { id: workspace.id },
      data: { mode: workspaceMode },
    }),
    ...(firstSubjectName
      ? [db.subject.create({ data: { workspaceId: workspace.id, name: firstSubjectName } })]
      : []),
  ]);

  return NextResponse.json({ success: true });
}
