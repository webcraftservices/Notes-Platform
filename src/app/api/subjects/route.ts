import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  getSessionUser,
  getPrimaryWorkspace,
  getAccessibleGroup,
  requireGroupRole,
  NotAuthorizedError,
} from "@/lib/access";
import { assertSubjectScopeInvariant } from "@/lib/subject-scope";
import { createSubjectSchema } from "@/lib/validation/hierarchy";
import { zodError, UNAUTHORIZED, FORBIDDEN, NOT_FOUND } from "@/lib/api-response";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { searchParams } = new URL(req.url);
  const includeArchived = searchParams.get("archived") === "true";
  const groupId = searchParams.get("groupId");

  try {
    let where: Prisma.SubjectWhereInput;

    if (groupId) {
      // Phase 6.4: list a Group's Subjects instead of the caller's
      // personal workspace ones. getAccessibleGroup returns null for a
      // group that doesn't exist and throws NotAuthorizedError for one
      // that exists but the caller isn't a member of — the same
      // null-vs-throw split every other group-scoped read in this file
      // already uses, so a non-member can't distinguish "no such group"
      // from "not yours to see."
      const group = await getAccessibleGroup(groupId, user.id);
      if (!group) return NOT_FOUND();
      where = {
        groupId: group.id,
        deletedAt: null,
        archivedAt: includeArchived ? { not: null } : null,
      };
    } else {
      const workspace = await getPrimaryWorkspace(user.id);
      where = {
        workspaceId: workspace.id,
        deletedAt: null,
        archivedAt: includeArchived ? { not: null } : null,
      };
    }

    const subjects = await db.subject.findMany({
      where,
      include: { _count: { select: { chapters: true, materials: true } } },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({ subjects });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = createSubjectSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  const { groupId, ...rest } = parsed.data;

  try {
    if (groupId) {
      // Phase 6.4 §2: only ADMIN/OWNER may create a Subject inside a
      // Group. requireGroupRole throws NotAuthorizedError for both "not a
      // member" and "member but below ADMIN" — the catch below maps
      // either case to a 403 without distinguishing them to the caller.
      await requireGroupRole(groupId, user.id, "ADMIN");
      // Defense in depth: the two branches here already guarantee exactly
      // one of workspaceId/groupId is set, but assert it anyway rather
      // than trusting that invariant implicitly (mirrors resolveSubjectOwner's
      // own defense-in-depth assertion in lib/subject-scope.ts).
      assertSubjectScopeInvariant({ workspaceId: null, groupId });
      const subject = await db.subject.create({
        data: { ...rest, groupId, workspaceId: null },
      });
      return NextResponse.json({ subject }, { status: 201 });
    }

    const workspace = await getPrimaryWorkspace(user.id);
    assertSubjectScopeInvariant({ workspaceId: workspace.id, groupId: null });
    const subject = await db.subject.create({
      data: { ...rest, workspaceId: workspace.id },
    });
    return NextResponse.json({ subject }, { status: 201 });
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
}
