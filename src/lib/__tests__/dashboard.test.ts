import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  subject: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  topic: {
    findMany: vi.fn(),
  },
  material: {
    findMany: vi.fn(),
  },
  processingJob: {
    findMany: vi.fn(),
  },
  groupMember: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db }));

import { getDashboardData } from "@/lib/dashboard";

describe("getDashboardData", () => {
  const workspaceId = "ws-123";
  const userId = "usr-456";

  beforeEach(() => {
    vi.resetAllMocks();

    db.subject.findMany.mockImplementation(({ include }: any) => {
      if (include?._count) {
        return Promise.resolve([
          { id: "subj-1", name: "Biology", _count: { chapters: 2, materials: 5 } },
        ]);
      }
      if (include?.chapters) {
        return Promise.resolve([
          {
            id: "subj-1",
            name: "Biology",
            chapters: [{ status: "COMPLETED" }, { status: "IN_PROGRESS" }],
          },
        ]);
      }
      return Promise.resolve([]);
    });

    db.subject.count.mockResolvedValue(1);
    db.topic.findMany.mockResolvedValue([
      { id: "top-1", name: "Cell Division", chapter: { subject: { id: "subj-1", name: "Biology" } } },
    ]);
    db.material.findMany.mockResolvedValue([
      { id: "mat-1", title: "Lecture 1 Audio", type: "AUDIO" },
    ]);
    db.processingJob.findMany.mockResolvedValue([]);
    db.groupMember.findMany.mockResolvedValue([]);
    db.groupMember.findFirst.mockResolvedValue(null);
  });

  it("preserves compatibility when userId is omitted (legacy call)", async () => {
    const result = await getDashboardData(workspaceId);

    expect(result.subjectCount).toBe(1);
    expect(result.recentSubjects).toHaveLength(1);
    expect(result.recentTopics).toHaveLength(1);
    expect(result.recentMaterials).toHaveLength(1);
    expect(result.progress).toHaveLength(1);
    expect(result.progress[0]).toEqual({
      id: "subj-1",
      name: "Biology",
      completed: 1,
      total: 2,
      percent: 50,
    });
    expect(result.recentJobs).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(db.processingJob.findMany).not.toHaveBeenCalled();
    expect(db.groupMember.findMany).not.toHaveBeenCalled();
    expect(db.groupMember.findFirst).not.toHaveBeenCalled();
  });

  it("scopes processing jobs to the authenticated user", async () => {
    db.processingJob.findMany.mockImplementation(({ where }: any) => {
      expect(where.userId).toBe(userId);
      return Promise.resolve([]);
    });

    await getDashboardData(workspaceId, userId);

    expect(db.processingJob.findMany).toHaveBeenCalled();
  });

  it("prioritizes active jobs (QUEUED, RUNNING) over older terminal jobs", async () => {
    const activeJob1 = {
      id: "job-q1",
      type: "TRANSCRIPTION",
      status: "QUEUED",
      progress: 0,
      error: null,
      createdAt: new Date("2026-11-04T12:00:00Z"),
      startedAt: null,
      completedAt: null,
      material: null,
    };
    const activeJob2 = {
      id: "job-r1",
      type: "AI_NOTE_GENERATION",
      status: "RUNNING",
      progress: 45,
      error: null,
      createdAt: new Date("2026-11-04T12:05:00Z"),
      startedAt: new Date("2026-11-04T12:06:00Z"),
      completedAt: null,
      material: null,
    };

    const terminalJob1 = {
      id: "job-s1",
      type: "DOCUMENT_EXTRACTION",
      status: "SUCCEEDED",
      progress: 100,
      error: null,
      createdAt: new Date("2026-11-04T12:10:00Z"), // Created after active job, but is terminal
      startedAt: new Date("2026-11-04T12:10:05Z"),
      completedAt: new Date("2026-11-04T12:10:30Z"),
      material: null,
    };
    const terminalJob2 = {
      id: "job-f1",
      type: "OCR",
      status: "FAILED",
      progress: 20,
      error: "Scan unreadable",
      createdAt: new Date("2026-11-04T11:00:00Z"),
      startedAt: new Date("2026-11-04T11:00:05Z"),
      completedAt: new Date("2026-11-04T11:00:15Z"),
      material: null,
    };

    db.processingJob.findMany.mockImplementation(({ where }: any) => {
      if (where.status?.in?.includes("QUEUED")) {
        return Promise.resolve([activeJob2, activeJob1]);
      }
      if (where.status?.in?.includes("SUCCEEDED")) {
        return Promise.resolve([terminalJob1, terminalJob2]);
      }
      return Promise.resolve([]);
    });

    const result = await getDashboardData(workspaceId, userId);

    expect(result.recentJobs).toHaveLength(4);
    // Active jobs appear first
    expect(result.recentJobs[0]!.id).toBe("job-r1");
    expect(result.recentJobs[0]!.status).toBe("RUNNING");
    expect(result.recentJobs[1]!.id).toBe("job-q1");
    expect(result.recentJobs[1]!.status).toBe("QUEUED");
    // Terminal jobs follow
    expect(result.recentJobs[2]!.id).toBe("job-s1");
    expect(result.recentJobs[2]!.status).toBe("SUCCEEDED");
    expect(result.recentJobs[3]!.id).toBe("job-f1");
    expect(result.recentJobs[3]!.status).toBe("FAILED");
  });

  it("bounds total returned processing jobs to 5", async () => {
    const activeJobs = [1, 2, 3].map((i) => ({
      id: `act-${i}`,
      type: "TRANSCRIPTION",
      status: "RUNNING",
      progress: 10 * i,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      material: null,
    }));
    const terminalJobs = [1, 2, 3, 4].map((i) => ({
      id: `term-${i}`,
      type: "AI_NOTE_GENERATION",
      status: "SUCCEEDED",
      progress: 100,
      error: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      material: null,
    }));

    db.processingJob.findMany.mockImplementation(({ where }: any) => {
      if (where.status?.in?.includes("QUEUED")) return Promise.resolve(activeJobs);
      if (where.status?.in?.includes("SUCCEEDED")) return Promise.resolve(terminalJobs);
      return Promise.resolve([]);
    });

    const result = await getDashboardData(workspaceId, userId);

    expect(result.recentJobs).toHaveLength(5);
    expect(result.recentJobs.map((j) => j.id)).toEqual(["act-1", "act-2", "act-3", "term-1", "term-2"]);
  });

  it("correctly handles all five job statuses including CANCELLED", async () => {
    const allStatuses = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
    const jobs = allStatuses.map((status, index) => ({
      id: `job-${status.toLowerCase()}`,
      type: "TRANSCRIPTION" as const,
      status,
      progress: status === "SUCCEEDED" ? 100 : index * 10,
      error: status === "FAILED" ? "Transcription failed: API timeout" : null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status) ? new Date() : null,
      material: null,
    }));

    db.processingJob.findMany.mockImplementation(({ where }: any) => {
      if (where.status?.in?.includes("QUEUED")) {
        return Promise.resolve(jobs.filter((j) => ["QUEUED", "RUNNING"].includes(j.status)));
      }
      if (where.status?.in?.includes("SUCCEEDED")) {
        return Promise.resolve(jobs.filter((j) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(j.status)));
      }
      return Promise.resolve([]);
    });

    const result = await getDashboardData(workspaceId, userId);

    expect(result.recentJobs).toHaveLength(5);
    const statuses = result.recentJobs.map((j) => j.status);
    expect(statuses).toContain("QUEUED");
    expect(statuses).toContain("RUNNING");
    expect(statuses).toContain("SUCCEEDED");
    expect(statuses).toContain("FAILED");
    expect(statuses).toContain("CANCELLED");
  });

  it("does not attach material links for soft-deleted or inaccessible materials", async () => {
    const deletedMaterialJob = {
      id: "job-del",
      type: "TRANSCRIPTION",
      status: "SUCCEEDED",
      progress: 100,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      material: {
        id: "mat-del",
        title: "Deleted Audio",
        type: "AUDIO",
        ownerId: userId,
        workspaceId,
        groupId: null,
        deletedAt: new Date("2026-11-01T00:00:00Z"), // Soft-deleted!
      },
    };

    const strangerMaterialJob = {
      id: "job-stranger",
      type: "TRANSCRIPTION",
      status: "SUCCEEDED",
      progress: 100,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      material: {
        id: "mat-stranger",
        title: "Stranger Audio",
        type: "AUDIO",
        ownerId: "stranger-user",
        workspaceId: "other-workspace",
        groupId: "unrelated-group",
        deletedAt: null,
      },
    };

    const accessibleMaterialJob = {
      id: "job-valid",
      type: "TRANSCRIPTION",
      status: "SUCCEEDED",
      progress: 100,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      material: {
        id: "mat-valid",
        title: "Valid Audio",
        type: "AUDIO",
        ownerId: userId,
        workspaceId,
        groupId: null,
        deletedAt: null,
      },
    };

    db.processingJob.findMany.mockImplementation(({ where }: any) => {
      if (where.status?.in?.includes("SUCCEEDED")) {
        return Promise.resolve([deletedMaterialJob, strangerMaterialJob, accessibleMaterialJob]);
      }
      return Promise.resolve([]);
    });

    const result = await getDashboardData(workspaceId, userId);

    expect(result.recentJobs).toHaveLength(3);
    // Deleted material link is suppressed to null
    expect(result.recentJobs.find((j) => j.id === "job-del")?.material).toBeNull();
    // Stranger material link is suppressed to null
    expect(result.recentJobs.find((j) => j.id === "job-stranger")?.material).toBeNull();
    // Accessible material is exposed cleanly
    expect(result.recentJobs.find((j) => j.id === "job-valid")?.material).toEqual({
      id: "mat-valid",
      title: "Valid Audio",
      type: "AUDIO",
    });
  });

  it("sanitizes sensitive or database errors in failed jobs", async () => {
    const failedWithPrismaError = {
      id: "job-err-1",
      type: "EMBEDDING",
      status: "FAILED",
      progress: 10,
      error: "PrismaClientKnownRequestError: Table 'User' foreign key constraint failed on SELECT ...",
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      material: null,
    };
    const failedWithUserMessage = {
      id: "job-err-2",
      type: "TRANSCRIPTION",
      status: "FAILED",
      progress: 10,
      error: "Audio quality too low for speech recognition.",
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      material: null,
    };

    db.processingJob.findMany.mockImplementation(({ where }: any) => {
      if (where.status?.in?.includes("SUCCEEDED")) {
        return Promise.resolve([failedWithPrismaError, failedWithUserMessage]);
      }
      return Promise.resolve([]);
    });

    const result = await getDashboardData(workspaceId, userId);

    const job1 = result.recentJobs.find((j) => j.id === "job-err-1");
    const job2 = result.recentJobs.find((j) => j.id === "job-err-2");

    // Internal database message replaced with user-safe message
    expect(job1?.error).toBe("An error occurred while processing.");
    // User-safe message preserved
    expect(job2?.error).toBe("Audio quality too low for speech recognition.");
  });

  it("scopes groups to current user and excludes soft-deleted groups", async () => {
    db.groupMember.findMany.mockImplementation(({ where }: any) => {
      expect(where.userId).toBe(userId);
      expect(where.group).toEqual({ deletedAt: null });
      return Promise.resolve([
        {
          id: "mem-1",
          role: "OWNER",
          joinedAt: new Date("2026-11-01T10:00:00Z"),
          group: {
            id: "grp-1",
            name: "Study Circle Alpha",
            description: "Advanced algorithms group",
            _count: { members: 4 },
          },
        },
        {
          id: "mem-2",
          role: "MEMBER",
          joinedAt: new Date("2026-11-02T10:00:00Z"),
          group: {
            id: "grp-2",
            name: "Bio 101 Labs",
            description: null,
            _count: { members: 12 },
          },
        },
      ]);
    });

    const result = await getDashboardData(workspaceId, userId);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toEqual({
      id: "grp-1",
      name: "Study Circle Alpha",
      description: "Advanced algorithms group",
      role: "OWNER",
      memberCount: 4,
    });
    expect(result.groups[1]).toEqual({
      id: "grp-2",
      name: "Bio 101 Labs",
      description: null,
      role: "MEMBER",
      memberCount: 12,
    });
  });

  describe("group-based material authorization (Phase 10B.1.1)", () => {
    it("allows access to material in 5th or 6th group even when user belongs to more than 4 groups", async () => {
      // User belongs to groups 1-4 displayed on the dashboard
      db.groupMember.findMany.mockImplementation(({ take }: any) => {
        expect(take).toBe(4);
        return Promise.resolve(
          [1, 2, 3, 4].map((i) => ({
            id: `mem-${i}`,
            role: "MEMBER",
            joinedAt: new Date(),
            group: {
              id: `grp-${i}`,
              name: `Group ${i}`,
              description: null,
              _count: { members: 5 },
            },
          }))
        );
      });

      // Material belongs to grp-5 (which is outside the 4 dashboard groups)
      const jobWith5thGroupMaterial = {
        id: "job-5th",
        type: "DOCUMENT_EXTRACTION",
        status: "SUCCEEDED",
        progress: 100,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        material: {
          id: "mat-5",
          title: "Advanced Group 5 Syllabus",
          type: "DOCUMENT",
          ownerId: "stranger-user",
          workspaceId: "other-workspace",
          groupId: "grp-5",
          deletedAt: null,
        },
      };

      db.processingJob.findMany.mockImplementation(({ where }: any) => {
        if (where.status?.in?.includes("SUCCEEDED")) {
          return Promise.resolve([jobWith5thGroupMaterial]);
        }
        return Promise.resolve([]);
      });

      // User IS an active member of grp-5 in the database
      db.groupMember.findFirst.mockImplementation(({ where }: any) => {
        if (where.groupId === "grp-5" && where.userId === userId && where.group?.deletedAt === null) {
          return Promise.resolve({ id: "mem-5" });
        }
        return Promise.resolve(null);
      });

      const result = await getDashboardData(workspaceId, userId);

      // Dashboard display limit remains exactly 4
      expect(result.groups).toHaveLength(4);
      expect(result.groups.map((g) => g.id)).toEqual(["grp-1", "grp-2", "grp-3", "grp-4"]);

      // Material from 5th group is successfully authorized and attached!
      expect(result.recentJobs).toHaveLength(1);
      expect(result.recentJobs[0]?.material).toEqual({
        id: "mat-5",
        title: "Advanced Group 5 Syllabus",
        type: "DOCUMENT",
      });

      // Independent check queried membership specifically for grp-5
      expect(db.groupMember.findFirst).toHaveBeenCalledWith({
        where: {
          groupId: "grp-5",
          userId,
          group: { deletedAt: null },
        },
        select: { id: true },
      });
    });

    it("denies material access when user is not a member of the material's group", async () => {
      const jobWithUnjoinedGroup = {
        id: "job-unjoined",
        type: "TRANSCRIPTION",
        status: "SUCCEEDED",
        progress: 100,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        material: {
          id: "mat-unjoined",
          title: "Private Audio",
          type: "AUDIO",
          ownerId: "stranger-user",
          workspaceId: "other-workspace",
          groupId: "grp-unjoined",
          deletedAt: null,
        },
      };

      db.processingJob.findMany.mockImplementation(({ where }: any) => {
        if (where.status?.in?.includes("SUCCEEDED")) {
          return Promise.resolve([jobWithUnjoinedGroup]);
        }
        return Promise.resolve([]);
      });

      // Not a member
      db.groupMember.findFirst.mockResolvedValue(null);

      const result = await getDashboardData(workspaceId, userId);

      expect(result.recentJobs[0]?.material).toBeNull();
      expect(db.groupMember.findFirst).toHaveBeenCalledWith({
        where: {
          groupId: "grp-unjoined",
          userId,
          group: { deletedAt: null },
        },
        select: { id: true },
      });
    });

    it("denies material access when group is soft-deleted even if membership exists", async () => {
      const jobWithDeletedGroup = {
        id: "job-deleted-grp",
        type: "OCR",
        status: "SUCCEEDED",
        progress: 100,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        material: {
          id: "mat-del-grp",
          title: "Archive Notes",
          type: "DOCUMENT",
          ownerId: "stranger-user",
          workspaceId: "other-workspace",
          groupId: "grp-deleted",
          deletedAt: null,
        },
      };

      db.processingJob.findMany.mockImplementation(({ where }: any) => {
        if (where.status?.in?.includes("SUCCEEDED")) {
          return Promise.resolve([jobWithDeletedGroup]);
        }
        return Promise.resolve([]);
      });

      // The query explicitly requires group: { deletedAt: null }.
      // If group is soft-deleted, findFirst returns null.
      db.groupMember.findFirst.mockImplementation(({ where }: any) => {
        expect(where.group).toEqual({ deletedAt: null });
        return Promise.resolve(null);
      });

      const result = await getDashboardData(workspaceId, userId);

      expect(result.recentJobs[0]?.material).toBeNull();
    });

    it("preserves 4-group dashboard display query limit unchanged", async () => {
      db.groupMember.findMany.mockResolvedValue([]);

      await getDashboardData(workspaceId, userId);

      expect(db.groupMember.findMany).toHaveBeenCalledWith({
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
      });
    });

    it("preserves personal ownership and workspace authorization without querying group membership", async () => {
      const ownedJob = {
        id: "job-owned",
        type: "TRANSCRIPTION",
        status: "SUCCEEDED",
        progress: 100,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        material: {
          id: "mat-owned",
          title: "Personal Voice Memo",
          type: "AUDIO",
          ownerId: userId,
          workspaceId: "other-workspace",
          groupId: "grp-any",
          deletedAt: null,
        },
      };

      const workspaceJob = {
        id: "job-ws",
        type: "AI_NOTE_GENERATION",
        status: "SUCCEEDED",
        progress: 100,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        material: {
          id: "mat-ws",
          title: "Workspace Lecture",
          type: "VIDEO",
          ownerId: "coworker-user",
          workspaceId,
          groupId: "grp-any-2",
          deletedAt: null,
        },
      };

      db.processingJob.findMany.mockImplementation(({ where }: any) => {
        if (where.status?.in?.includes("SUCCEEDED")) {
          return Promise.resolve([ownedJob, workspaceJob]);
        }
        return Promise.resolve([]);
      });

      const result = await getDashboardData(workspaceId, userId);

      expect(result.recentJobs[0]?.material).toEqual({
        id: "mat-owned",
        title: "Personal Voice Memo",
        type: "AUDIO",
      });
      expect(result.recentJobs[1]?.material).toEqual({
        id: "mat-ws",
        title: "Workspace Lecture",
        type: "VIDEO",
      });

      // No group check query needed since ownership or workspace match authorizes access
      expect(db.groupMember.findFirst).not.toHaveBeenCalled();
    });

    it("deduplicates group membership queries for multiple jobs in the same group", async () => {
      const job1 = {
        id: "job-1",
        type: "TRANSCRIPTION",
        status: "SUCCEEDED",
        progress: 100,
        error: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null,
        material: {
          id: "mat-1",
          title: "Group Audio 1",
          type: "AUDIO",
          ownerId: "other-user",
          workspaceId: "other-ws",
          groupId: "grp-shared",
          deletedAt: null,
        },
      };
      const job2 = {
        id: "job-2",
        type: "AI_NOTE_GENERATION",
        status: "RUNNING",
        progress: 50,
        error: null,
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
        material: {
          id: "mat-2",
          title: "Group Audio 2",
          type: "AUDIO",
          ownerId: "other-user",
          workspaceId: "other-ws",
          groupId: "grp-shared",
          deletedAt: null,
        },
      };

      db.processingJob.findMany.mockImplementation(({ where }: any) => {
        if (where.status?.in?.includes("RUNNING")) return Promise.resolve([job2]);
        if (where.status?.in?.includes("SUCCEEDED")) return Promise.resolve([job1]);
        return Promise.resolve([]);
      });

      db.groupMember.findFirst.mockResolvedValue({ id: "mem-shared" });

      const result = await getDashboardData(workspaceId, userId);

      expect(result.recentJobs).toHaveLength(2);
      expect(result.recentJobs[0]?.material?.id).toBe("mat-2");
      expect(result.recentJobs[1]?.material?.id).toBe("mat-1");

      // Only one query made to db.groupMember.findFirst despite two jobs referencing grp-shared
      expect(db.groupMember.findFirst).toHaveBeenCalledTimes(1);
    });
  });
});

