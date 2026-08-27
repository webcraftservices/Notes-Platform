import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, getPrimaryWorkspace } from "@/lib/access";
import { UNAUTHORIZED } from "@/lib/api-response";

/**
 * Name/description matching across the hierarchy. This is intentionally
 * simple string search — semantic search over transcripts, notes, and
 * materials (spec §38, §96) needs the RAG pipeline and doesn't exist until
 * Phase 5. Keeping this endpoint honest about that scope now avoids a
 * confusing gap later between "search" and "AI search".
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ subjects: [], chapters: [], topics: [] });
  }

  const workspace = await getPrimaryWorkspace(user.id);

  const [subjects, chapters, topics] = await Promise.all([
    db.subject.findMany({
      where: {
        workspaceId: workspace.id,
        deletedAt: null,
        OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }],
      },
      take: 8,
    }),
    db.chapter.findMany({
      where: {
        deletedAt: null,
        subject: { workspaceId: workspace.id, deletedAt: null },
        OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }],
      },
      include: { subject: true },
      take: 8,
    }),
    db.topic.findMany({
      where: {
        deletedAt: null,
        chapter: { subject: { workspaceId: workspace.id, deletedAt: null } },
        OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }],
      },
      include: { chapter: { include: { subject: true } } },
      take: 8,
    }),
  ]);

  return NextResponse.json({ subjects, chapters, topics });
}
