import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getPrimaryWorkspace, NotAuthorizedError } from "@/lib/access";
import { createLinkMaterialSchema, listMaterialsQuerySchema } from "@/lib/validation/materials";
import { resolveMaterialScope, ScopeNotFoundError } from "@/lib/materials-scope";
import { zodError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { searchParams } = new URL(req.url);
  const parsed = listMaterialsQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return zodError(parsed.error);
  const { scope, subjectId, chapterId, topicId, q, tag } = parsed.data;

  const workspace = await getPrimaryWorkspace(user.id);

  const where: Prisma.MaterialWhereInput = {
    workspaceId: workspace.id,
    deletedAt: null,
  };

  if (scope === "archived") {
    where.archivedAt = { not: null };
  } else {
    where.archivedAt = null;
    if (scope === "unorganized") {
      where.subjectId = null;
      where.chapterId = null;
      where.topicId = null;
    }
  }

  if (topicId) where.topicId = topicId;
  else if (chapterId) where.chapterId = chapterId;
  else if (subjectId) where.subjectId = subjectId;

  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { originalFilename: { contains: q, mode: "insensitive" } },
    ];
  }
  if (tag) where.tags = { has: tag };

  const materials = await db.material.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ materials });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const body = await req.json().catch(() => null);
  const parsed = createLinkMaterialSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);
  const { title, url, ...scopeInput } = parsed.data;

  const workspace = await getPrimaryWorkspace(user.id);

  let scope;
  try {
    scope = await resolveMaterialScope(scopeInput, user.id, workspace.id);
  } catch (err) {
    if (err instanceof ScopeNotFoundError) return NOT_FOUND();
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }

  // A link material is just a saved reference — no fetching, extraction,
  // or "understanding" of the target page happens here. That's a
  // deliberate scope boundary, not a missing feature: real link import
  // (spec §31 — fetch, extract, index) belongs with the RAG pipeline in
  // Phase 5, where indexing already has to exist for every material type.
  const material = await db.material.create({
    data: {
      ownerId: user.id,
      workspaceId: scope.workspaceId,
      subjectId: scope.subjectId,
      chapterId: scope.chapterId,
      topicId: scope.topicId,
      type: "LINK",
      title,
      sourceUrl: url,
      status: "READY",
    },
  });

  return NextResponse.json({ material }, { status: 201 });
}
