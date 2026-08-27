import { db } from "@/lib/db";

export async function getDashboardData(workspaceId: string) {
  const [recentSubjects, recentTopics, subjectsWithChapters, subjectCount, recentMaterials] = await Promise.all([
    db.subject.findMany({
      where: { workspaceId, deletedAt: null, archivedAt: null },
      include: { _count: { select: { chapters: true, materials: true } } },
      orderBy: { updatedAt: "desc" },
      take: 4,
    }),
    db.topic.findMany({
      where: {
        deletedAt: null,
        chapter: { subject: { workspaceId, deletedAt: null } },
      },
      include: { chapter: { include: { subject: true } } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    db.subject.findMany({
      where: { workspaceId, deletedAt: null, archivedAt: null },
      include: { chapters: { where: { deletedAt: null, archivedAt: null }, select: { status: true } } },
    }),
    db.subject.count({ where: { workspaceId, deletedAt: null, archivedAt: null } }),
    db.material.findMany({
      where: { workspaceId, deletedAt: null, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);

  // Progress is computed directly from real ChapterStatus values — never
  // estimated or faked. A subject with zero chapters has no progress bar.
  const progress = subjectsWithChapters
    .filter((s) => s.chapters.length > 0)
    .map((s) => {
      const total = s.chapters.length;
      const completed = s.chapters.filter((c) => c.status === "COMPLETED").length;
      return { id: s.id, name: s.name, completed, total, percent: Math.round((completed / total) * 100) };
    });

  return { recentSubjects, recentTopics, progress, subjectCount, recentMaterials };
}
