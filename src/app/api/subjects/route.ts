import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getPrimaryWorkspace } from "@/lib/access";
import { createSubjectSchema } from "@/lib/validation/hierarchy";
import { zodError, UNAUTHORIZED } from "@/lib/api-response";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { searchParams } = new URL(req.url);
  const includeArchived = searchParams.get("archived") === "true";

  const workspace = await getPrimaryWorkspace(user.id);

  const subjects = await db.subject.findMany({
    where: {
      workspaceId: workspace.id,
      deletedAt: null,
      archivedAt: includeArchived ? { not: null } : null,
    },
    include: { _count: { select: { chapters: true, materials: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ subjects });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = createSubjectSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  const workspace = await getPrimaryWorkspace(user.id);

  const subject = await db.subject.create({
    data: { ...parsed.data, workspaceId: workspace.id },
  });

  return NextResponse.json({ subject }, { status: 201 });
}
