import { db } from "@/lib/db";
import { MATERIAL_LIST_SELECT } from "@/lib/material-list-select";
import type { JobStatus, JobType, MaterialType } from "@prisma/client";
import type { GroupCardData } from "@/components/groups/group-card";

export interface DashboardProcessingJob {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  material: {
    id: string;
    title: string;
    type: MaterialType;
  } | null;
}

function sanitizeJobError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("prisma") ||
    lower.includes("select ") ||
    lower.includes("connection") ||
    lower.includes("pg_") ||
    lower.includes("syntax") ||
    lower.includes("database")
  ) {
    return "An error occurred while processing.";
  }
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

export async function getDashboardData(workspaceId: string, userId?: string) {
  const [
    recentSubjects,
    recentTopics,
    subjectsWithChapters,
    subjectCount,
    recentMaterials,
    activeJobs,
    terminalJobs,
    groupMemberships,
  ] = await Promise.all([
    db.subject.findMany({
      where: { workspaceId, deletedAt: null, archivedAt: null },
      include: { _count: { select: { chapters: true, materials: true } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 4,
    }),
    db.topic.findMany({
      where: {
        deletedAt: null,
        chapter: { subject: { workspaceId, deletedAt: null } },
      },
      include: { chapter: { include: { subject: true } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 5,
    }),
    db.subject.findMany({
      where: { workspaceId, deletedAt: null, archivedAt: null },
      include: { chapters: { where: { deletedAt: null, archivedAt: null }, select: { status: true } } },
    }),
    db.subject.count({ where: { workspaceId, deletedAt: null, archivedAt: null } }),
    db.material.findMany({
      where: { workspaceId, deletedAt: null, archivedAt: null },
      select: MATERIAL_LIST_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 6,
    }),
    userId
      ? db.processingJob.findMany({
          where: {
            userId,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          select: {
            id: true,
            type: true,
            status: true,
            progress: true,
            error: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
            material: {
              select: {
                id: true,
                title: true,
                type: true,
                ownerId: true,
                workspaceId: true,
                groupId: true,
                deletedAt: true,
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 5,
        })
      : Promise.resolve([]),
    userId
      ? db.processingJob.findMany({
          where: {
            userId,
            status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
          },
          select: {
            id: true,
            type: true,
            status: true,
            progress: true,
            error: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
            material: {
              select: {
                id: true,
                title: true,
                type: true,
                ownerId: true,
                workspaceId: true,
                groupId: true,
                deletedAt: true,
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 5,
        })
      : Promise.resolve([]),
    userId
      ? db.groupMember.findMany({
          where: {
            userId,
            group: { deletedAt: null },
          },
          include: {
            group: {
              select: {
                id: true,
                name: true,
                description: true,
                _count: {
                  select: { members: true },
                },
              },
            },
          },
          orderBy: [{ joinedAt: "desc" }, { id: "desc" }],
          take: 4,
        })
      : Promise.resolve([]),
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

  const groups: GroupCardData[] = groupMemberships.map((membership) => ({
    id: membership.group.id,
    name: membership.group.name,
    description: membership.group.description,
    role: membership.role,
    memberCount: membership.group._count.members,
  }));

  // Prioritize active jobs (QUEUED/RUNNING) first, then fill remaining slots
  // with recent terminal jobs up to a bounded maximum of 5.
  const combinedJobs = [...activeJobs, ...terminalJobs].slice(0, 5);

  // Group authorization cache to avoid duplicate queries within the same request.
  // Note: Material authorization must never be limited by the 4-group dashboard display query.
  const groupAccessCache = new Map<string, Promise<boolean>>();

  function canAccessGroup(groupId: string, targetUserId: string): Promise<boolean> {
    const existing = groupAccessCache.get(groupId);
    if (existing !== undefined) return existing;

    const promise = db.groupMember
      .findFirst({
        where: {
          groupId,
          userId: targetUserId,
          group: { deletedAt: null },
        },
        select: { id: true },
      })
      .then((membership) => membership !== null);

    groupAccessCache.set(groupId, promise);
    return promise;
  }

  const recentJobs: DashboardProcessingJob[] = await Promise.all(
    combinedJobs.map(async (job) => {
      let safeMaterial: DashboardProcessingJob["material"] = null;

      if (job.material && job.material.deletedAt === null) {
        const isOwned = Boolean(userId && job.material.ownerId === userId);
        const isInWorkspace = Boolean(job.material.workspaceId !== null && job.material.workspaceId === workspaceId);
        let isInGroup = false;

        if (!isOwned && !isInWorkspace && job.material.groupId && userId) {
          isInGroup = await canAccessGroup(job.material.groupId, userId);
        }

        if (isOwned || isInWorkspace || isInGroup) {
          safeMaterial = {
            id: job.material.id,
            title: job.material.title,
            type: job.material.type,
          };
        }
      }

      return {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        error: job.status === "FAILED" && job.error ? sanitizeJobError(job.error) : null,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        material: safeMaterial,
      };
    })
  );

  return {
    recentSubjects,
    recentTopics,
    progress,
    subjectCount,
    recentMaterials,
    recentJobs,
    groups,
  };
}
