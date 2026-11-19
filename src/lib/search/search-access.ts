/**
 * src/lib/search/search-access.ts
 *
 * Search Access Control, Tenancy Scope Resolution, and Pre-Filtered
 * Prisma & Raw SQL WHERE Predicate Builders with Fail-Closed Ancestor Checks.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPrimaryWorkspace } from "@/lib/access";

export interface UserSearchScope {
  userId: string;
  personalWorkspaceId: string;
  activeGroupIds: string[];
}

export interface SearchHierarchyFilters {
  groupId?: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

/**
 * Resolves the authenticated user's visibility scope:
 * 1. Primary personal workspace ID.
 * 2. Active group IDs where the group is not soft-deleted.
 * Read access is role-independent (VIEWER, MEMBER, ADMIN, OWNER all included).
 */
export async function resolveUserSearchScope(userId: string): Promise<UserSearchScope> {
  const [workspace, memberships] = await Promise.all([
    getPrimaryWorkspace(userId),
    db.groupMember.findMany({
      where: {
        userId,
        group: { deletedAt: null },
      },
      select: { groupId: true },
    }),
  ]);

  return {
    userId,
    personalWorkspaceId: workspace.id,
    activeGroupIds: memberships.map((m) => m.groupId),
  };
}

/**
 * Builds Prisma WHERE input for Subject search.
 */
export function buildSubjectWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.SubjectWhereInput {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return { id: "impossible-id-fail-closed" };
  }
  if (filters?.chapterId || filters?.topicId) {
    return { id: "impossible-id-fail-closed" };
  }

  const conditions: Prisma.SubjectWhereInput[] = [{ deletedAt: null }];

  if (filters?.subjectId) {
    conditions.push({ id: filters.subjectId });
  }

  if (filters?.groupId) {
    conditions.push({ groupId: filters.groupId });
  } else {
    conditions.push({
      OR: [
        { workspaceId: scope.personalWorkspaceId },
        ...(scope.activeGroupIds.length > 0
          ? [{ groupId: { in: scope.activeGroupIds } }]
          : []),
      ],
    });
  }

  return { AND: conditions };
}

/**
 * Builds Prisma WHERE input for Chapter search with parent Subject soft-deletion check.
 */
export function buildChapterWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.ChapterWhereInput {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return { id: "impossible-id-fail-closed" };
  }
  if (filters?.topicId) {
    return { id: "impossible-id-fail-closed" };
  }

  const conditions: Prisma.ChapterWhereInput[] = [
    { deletedAt: null },
    { subject: { deletedAt: null } },
  ];

  if (filters?.chapterId) {
    conditions.push({ id: filters.chapterId });
  }
  if (filters?.subjectId) {
    conditions.push({ subjectId: filters.subjectId });
  }

  if (filters?.groupId) {
    conditions.push({ subject: { groupId: filters.groupId } });
  } else {
    conditions.push({
      subject: {
        OR: [
          { workspaceId: scope.personalWorkspaceId },
          ...(scope.activeGroupIds.length > 0
            ? [{ groupId: { in: scope.activeGroupIds } }]
            : []),
        ],
      },
    });
  }

  return { AND: conditions };
}

/**
 * Builds Prisma WHERE input for Topic search with ancestor Chapter and Subject checks.
 */
export function buildTopicWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.TopicWhereInput {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return { id: "impossible-id-fail-closed" };
  }

  const conditions: Prisma.TopicWhereInput[] = [
    { deletedAt: null },
    { chapter: { deletedAt: null, subject: { deletedAt: null } } },
  ];

  if (filters?.topicId) {
    conditions.push({ id: filters.topicId });
  }
  if (filters?.chapterId) {
    conditions.push({ chapterId: filters.chapterId });
  }
  if (filters?.subjectId) {
    conditions.push({ chapter: { subjectId: filters.subjectId } });
  }

  if (filters?.groupId) {
    conditions.push({ chapter: { subject: { groupId: filters.groupId } } });
  } else {
    conditions.push({
      chapter: {
        subject: {
          OR: [
            { workspaceId: scope.personalWorkspaceId },
            ...(scope.activeGroupIds.length > 0
              ? [{ groupId: { in: scope.activeGroupIds } }]
              : []),
          ],
        },
      },
    });
  }

  return { AND: conditions };
}

/**
 * Builds Prisma WHERE input for Note search.
 * Enforces topic hierarchy soft-deletion checks for topic notes, and author-isolation for standalone notes.
 */
export function buildNoteWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.NoteWhereInput {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return { id: "impossible-id-fail-closed" };
  }

  const conditions: Prisma.NoteWhereInput[] = [{ deletedAt: null }];

  if (filters?.topicId) {
    conditions.push({ topicId: filters.topicId });
  }
  if (filters?.chapterId) {
    conditions.push({ topic: { chapterId: filters.chapterId } });
  }
  if (filters?.subjectId) {
    conditions.push({ topic: { chapter: { subjectId: filters.subjectId } } });
  }

  if (filters?.groupId) {
    conditions.push({
      topicId: { not: null },
      topic: {
        deletedAt: null,
        chapter: {
          deletedAt: null,
          subject: {
            deletedAt: null,
            groupId: filters.groupId,
          },
        },
      },
    });
  } else if (filters?.topicId || filters?.chapterId || filters?.subjectId) {
    conditions.push({
      topicId: { not: null },
      topic: {
        deletedAt: null,
        chapter: {
          deletedAt: null,
          subject: {
            deletedAt: null,
            OR: [
              { workspaceId: scope.personalWorkspaceId },
              ...(scope.activeGroupIds.length > 0
                ? [{ groupId: { in: scope.activeGroupIds } }]
                : []),
            ],
          },
        },
      },
    });
  } else {
    conditions.push({
      OR: [
        {
          topicId: { not: null },
          topic: {
            deletedAt: null,
            chapter: {
              deletedAt: null,
              subject: {
                deletedAt: null,
                OR: [
                  { workspaceId: scope.personalWorkspaceId },
                  ...(scope.activeGroupIds.length > 0
                    ? [{ groupId: { in: scope.activeGroupIds } }]
                    : []),
                ],
              },
            },
          },
        },
        {
          topicId: null,
          authorId: scope.userId,
        },
      ],
    });
  }

  return { AND: conditions };
}

/**
 * Builds Prisma WHERE input for Material search.
 * Enforces parent hierarchy soft-deletion and group vs personal ownership.
 */
export function buildMaterialWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.MaterialWhereInput {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return { id: "impossible-id-fail-closed" };
  }

  const conditions: Prisma.MaterialWhereInput[] = [
    { deletedAt: null },
    { OR: [{ subjectId: null }, { subject: { deletedAt: null } }] },
    { OR: [{ chapterId: null }, { chapter: { deletedAt: null } }] },
    { OR: [{ topicId: null }, { topic: { deletedAt: null } }] },
  ];

  if (filters?.topicId) {
    conditions.push({ topicId: filters.topicId });
  }
  if (filters?.chapterId) {
    conditions.push({ chapterId: filters.chapterId });
  }
  if (filters?.subjectId) {
    conditions.push({ subjectId: filters.subjectId });
  }

  if (filters?.groupId) {
    conditions.push({ groupId: filters.groupId });
  } else {
    conditions.push({
      OR: [
        ...(scope.activeGroupIds.length > 0
          ? [{ groupId: { in: scope.activeGroupIds } }]
          : []),
        {
          groupId: null,
          OR: [
            { workspaceId: scope.personalWorkspaceId },
            { ownerId: scope.userId },
          ],
        },
      ],
    });
  }

  return { AND: conditions };
}

/**
 * Builds Prisma WHERE input for StudyGroup search.
 */
export function buildGroupWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.GroupWhereInput {
  if (filters?.subjectId || filters?.chapterId || filters?.topicId) {
    return { id: "impossible-id-fail-closed" };
  }

  if (filters?.groupId) {
    if (!scope.activeGroupIds.includes(filters.groupId)) {
      return { id: "impossible-id-fail-closed" };
    }
    return {
      deletedAt: null,
      id: filters.groupId,
    };
  }

  if (scope.activeGroupIds.length === 0) {
    return { id: "impossible-id-fail-closed" };
  }

  return {
    deletedAt: null,
    id: { in: scope.activeGroupIds },
  };
}

/**
 * Builds Prisma WHERE input for FlashcardDeck search.
 */
export function buildFlashcardDeckWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.FlashcardDeckWhereInput {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return { id: "impossible-id-fail-closed" };
  }

  const conditions: Prisma.FlashcardDeckWhereInput[] = [
    { OR: [{ subjectId: null }, { subject: { deletedAt: null } }] },
    { OR: [{ chapterId: null }, { chapter: { deletedAt: null } }] },
    { OR: [{ topicId: null }, { topic: { deletedAt: null } }] },
  ];

  if (filters?.topicId) {
    conditions.push({ topicId: filters.topicId });
  }
  if (filters?.chapterId) {
    conditions.push({ chapterId: filters.chapterId });
  }
  if (filters?.subjectId) {
    conditions.push({ subjectId: filters.subjectId });
  }

  if (filters?.groupId) {
    conditions.push({ groupId: filters.groupId });
  } else {
    conditions.push({
      OR: [
        ...(scope.activeGroupIds.length > 0
          ? [{ groupId: { in: scope.activeGroupIds } }]
          : []),
        {
          groupId: null,
          OR: [
            { workspaceId: scope.personalWorkspaceId },
            { ownerId: scope.userId },
          ],
        },
      ],
    });
  }

  return { AND: conditions };
}

/**
 * Builds SQL WHERE conditions for Subject (alias 's').
 */
export function buildSubjectSqlWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.Sql {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return Prisma.sql`1 = 0`;
  }
  if (filters?.chapterId || filters?.topicId) {
    return Prisma.sql`1 = 0`;
  }

  const conditions: Prisma.Sql[] = [Prisma.sql`s."deletedAt" IS NULL`];

  if (filters?.subjectId) {
    conditions.push(Prisma.sql`s.id = ${filters.subjectId}`);
  }

  if (filters?.groupId) {
    conditions.push(Prisma.sql`s."groupId" = ${filters.groupId}`);
  } else {
    if (scope.activeGroupIds.length > 0) {
      conditions.push(
        Prisma.sql`(s."workspaceId" = ${scope.personalWorkspaceId} OR s."groupId" IN (${Prisma.join(
          scope.activeGroupIds.map((id) => Prisma.sql`${id}`)
        )}))`
      );
    } else {
      conditions.push(Prisma.sql`s."workspaceId" = ${scope.personalWorkspaceId}`);
    }
  }

  return Prisma.join(conditions, " AND ");
}

/**
 * Builds SQL WHERE conditions for Chapter (alias 'c', joined with 's').
 */
export function buildChapterSqlWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.Sql {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return Prisma.sql`1 = 0`;
  }
  if (filters?.topicId) {
    return Prisma.sql`1 = 0`;
  }

  const conditions: Prisma.Sql[] = [
    Prisma.sql`c."deletedAt" IS NULL`,
    Prisma.sql`s.id IS NOT NULL`,
    Prisma.sql`s."deletedAt" IS NULL`,
  ];

  if (filters?.chapterId) {
    conditions.push(Prisma.sql`c.id = ${filters.chapterId}`);
  }
  if (filters?.subjectId) {
    conditions.push(Prisma.sql`c."subjectId" = ${filters.subjectId}`);
  }

  if (filters?.groupId) {
    conditions.push(Prisma.sql`s."groupId" = ${filters.groupId}`);
  } else {
    if (scope.activeGroupIds.length > 0) {
      conditions.push(
        Prisma.sql`(s."workspaceId" = ${scope.personalWorkspaceId} OR s."groupId" IN (${Prisma.join(
          scope.activeGroupIds.map((id) => Prisma.sql`${id}`)
        )}))`
      );
    } else {
      conditions.push(Prisma.sql`s."workspaceId" = ${scope.personalWorkspaceId}`);
    }
  }

  return Prisma.join(conditions, " AND ");
}

/**
 * Builds SQL WHERE conditions for Topic (alias 't', joined with 'c' and 's').
 */
export function buildTopicSqlWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.Sql {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return Prisma.sql`1 = 0`;
  }

  const conditions: Prisma.Sql[] = [
    Prisma.sql`t."deletedAt" IS NULL`,
    Prisma.sql`c.id IS NOT NULL`,
    Prisma.sql`c."deletedAt" IS NULL`,
    Prisma.sql`s.id IS NOT NULL`,
    Prisma.sql`s."deletedAt" IS NULL`,
  ];

  if (filters?.topicId) {
    conditions.push(Prisma.sql`t.id = ${filters.topicId}`);
  }
  if (filters?.chapterId) {
    conditions.push(Prisma.sql`t."chapterId" = ${filters.chapterId}`);
  }
  if (filters?.subjectId) {
    conditions.push(Prisma.sql`c."subjectId" = ${filters.subjectId}`);
  }

  if (filters?.groupId) {
    conditions.push(Prisma.sql`s."groupId" = ${filters.groupId}`);
  } else {
    if (scope.activeGroupIds.length > 0) {
      conditions.push(
        Prisma.sql`(s."workspaceId" = ${scope.personalWorkspaceId} OR s."groupId" IN (${Prisma.join(
          scope.activeGroupIds.map((id) => Prisma.sql`${id}`)
        )}))`
      );
    } else {
      conditions.push(Prisma.sql`s."workspaceId" = ${scope.personalWorkspaceId}`);
    }
  }

  return Prisma.join(conditions, " AND ");
}

/**
 * Builds SQL WHERE conditions for Note (alias 'n', left-joined with 't', 'c', 's').
 */
export function buildNoteSqlWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.Sql {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return Prisma.sql`1 = 0`;
  }

  const conditions: Prisma.Sql[] = [Prisma.sql`n."deletedAt" IS NULL`];

  if (filters?.topicId) {
    conditions.push(Prisma.sql`n."topicId" = ${filters.topicId}`);
  }
  if (filters?.chapterId) {
    conditions.push(Prisma.sql`t."chapterId" = ${filters.chapterId}`);
  }
  if (filters?.subjectId) {
    conditions.push(Prisma.sql`c."subjectId" = ${filters.subjectId}`);
  }

  if (filters?.groupId) {
    conditions.push(
      Prisma.sql`(
        n."topicId" IS NOT NULL
        AND t.id IS NOT NULL AND t."deletedAt" IS NULL
        AND c.id IS NOT NULL AND c."deletedAt" IS NULL
        AND s.id IS NOT NULL AND s."deletedAt" IS NULL
        AND s."groupId" = ${filters.groupId}
      )`
    );
  } else if (filters?.topicId || filters?.chapterId || filters?.subjectId) {
    const scopeClause =
      scope.activeGroupIds.length > 0
        ? Prisma.sql`(s."workspaceId" = ${scope.personalWorkspaceId} OR s."groupId" IN (${Prisma.join(
            scope.activeGroupIds.map((id) => Prisma.sql`${id}`)
          )}))`
        : Prisma.sql`s."workspaceId" = ${scope.personalWorkspaceId}`;

    conditions.push(
      Prisma.sql`(
        n."topicId" IS NOT NULL
        AND t.id IS NOT NULL AND t."deletedAt" IS NULL
        AND c.id IS NOT NULL AND c."deletedAt" IS NULL
        AND s.id IS NOT NULL AND s."deletedAt" IS NULL
        AND ${scopeClause}
      )`
    );
  } else {
    const scopeClause =
      scope.activeGroupIds.length > 0
        ? Prisma.sql`(s."workspaceId" = ${scope.personalWorkspaceId} OR s."groupId" IN (${Prisma.join(
            scope.activeGroupIds.map((id) => Prisma.sql`${id}`)
          )}))`
        : Prisma.sql`s."workspaceId" = ${scope.personalWorkspaceId}`;

    conditions.push(
      Prisma.sql`(
        (
          n."topicId" IS NOT NULL
          AND t.id IS NOT NULL AND t."deletedAt" IS NULL
          AND c.id IS NOT NULL AND c."deletedAt" IS NULL
          AND s.id IS NOT NULL AND s."deletedAt" IS NULL
          AND ${scopeClause}
        )
        OR
        (
          n."topicId" IS NULL
          AND n."authorId" = ${scope.userId}
        )
      )`
    );
  }

  return Prisma.join(conditions, " AND ");
}

/**
 * Builds SQL WHERE conditions for Material (alias 'm', left-joined with 's', 'c', 't').
 */
export function buildMaterialSqlWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.Sql {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return Prisma.sql`1 = 0`;
  }

  const conditions: Prisma.Sql[] = [
    Prisma.sql`m."deletedAt" IS NULL`,
    Prisma.sql`(s.id IS NULL OR s."deletedAt" IS NULL)`,
    Prisma.sql`(c.id IS NULL OR c."deletedAt" IS NULL)`,
    Prisma.sql`(t.id IS NULL OR t."deletedAt" IS NULL)`,
    Prisma.sql`(m."subjectId" IS NULL OR (s.id IS NOT NULL AND s."deletedAt" IS NULL))`,
    Prisma.sql`(m."chapterId" IS NULL OR (c.id IS NOT NULL AND c."deletedAt" IS NULL))`,
    Prisma.sql`(m."topicId" IS NULL OR (t.id IS NOT NULL AND t."deletedAt" IS NULL))`,
  ];

  if (filters?.topicId) {
    conditions.push(Prisma.sql`m."topicId" = ${filters.topicId}`);
  }
  if (filters?.chapterId) {
    conditions.push(Prisma.sql`(m."chapterId" = ${filters.chapterId} OR c.id = ${filters.chapterId})`);
  }
  if (filters?.subjectId) {
    conditions.push(Prisma.sql`(m."subjectId" = ${filters.subjectId} OR s.id = ${filters.subjectId})`);
  }

  if (filters?.groupId) {
    conditions.push(Prisma.sql`(m."groupId" = ${filters.groupId} OR s."groupId" = ${filters.groupId})`);
  } else {
    if (scope.activeGroupIds.length > 0) {
      conditions.push(
        Prisma.sql`(
          (m."groupId" IS NOT NULL AND m."groupId" IN (${Prisma.join(
            scope.activeGroupIds.map((id) => Prisma.sql`${id}`)
          )}))
          OR
          (m."groupId" IS NULL AND (m."workspaceId" = ${scope.personalWorkspaceId} OR m."ownerId" = ${scope.userId}))
        )`
      );
    } else {
      conditions.push(
        Prisma.sql`(m."groupId" IS NULL AND (m."workspaceId" = ${scope.personalWorkspaceId} OR m."ownerId" = ${scope.userId}))`
      );
    }
  }

  return Prisma.join(conditions, " AND ");
}

/**
 * Builds SQL WHERE conditions for Group (alias 'g').
 */
export function buildGroupSqlWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.Sql {
  if (filters?.subjectId || filters?.chapterId || filters?.topicId) {
    return Prisma.sql`1 = 0`;
  }
  if (filters?.groupId) {
    if (!scope.activeGroupIds.includes(filters.groupId)) {
      return Prisma.sql`1 = 0`;
    }
    return Prisma.sql`g."deletedAt" IS NULL AND g.id = ${filters.groupId}`;
  }

  if (scope.activeGroupIds.length === 0) {
    return Prisma.sql`1 = 0`;
  }

  return Prisma.sql`g."deletedAt" IS NULL AND g.id IN (${Prisma.join(
    scope.activeGroupIds.map((id) => Prisma.sql`${id}`)
  )})`;
}

/**
 * Builds SQL WHERE conditions for FlashcardDeck (alias 'fd', left-joined with 's', 'c', 't').
 */
export function buildFlashcardDeckSqlWhere(
  scope: UserSearchScope,
  filters?: SearchHierarchyFilters
): Prisma.Sql {
  if (filters?.groupId && !scope.activeGroupIds.includes(filters.groupId)) {
    return Prisma.sql`1 = 0`;
  }

  const conditions: Prisma.Sql[] = [
    Prisma.sql`(s.id IS NULL OR s."deletedAt" IS NULL)`,
    Prisma.sql`(c.id IS NULL OR c."deletedAt" IS NULL)`,
    Prisma.sql`(t.id IS NULL OR t."deletedAt" IS NULL)`,
    Prisma.sql`(fd."subjectId" IS NULL OR (s.id IS NOT NULL AND s."deletedAt" IS NULL))`,
    Prisma.sql`(fd."chapterId" IS NULL OR (c.id IS NOT NULL AND c."deletedAt" IS NULL))`,
    Prisma.sql`(fd."topicId" IS NULL OR (t.id IS NOT NULL AND t."deletedAt" IS NULL))`,
  ];

  if (filters?.topicId) {
    conditions.push(Prisma.sql`fd."topicId" = ${filters.topicId}`);
  }
  if (filters?.chapterId) {
    conditions.push(Prisma.sql`(fd."chapterId" = ${filters.chapterId} OR c.id = ${filters.chapterId})`);
  }
  if (filters?.subjectId) {
    conditions.push(Prisma.sql`(fd."subjectId" = ${filters.subjectId} OR s.id = ${filters.subjectId})`);
  }

  if (filters?.groupId) {
    conditions.push(Prisma.sql`(fd."groupId" = ${filters.groupId} OR s."groupId" = ${filters.groupId})`);
  } else {
    if (scope.activeGroupIds.length > 0) {
      conditions.push(
        Prisma.sql`(
          (fd."groupId" IS NOT NULL AND fd."groupId" IN (${Prisma.join(
            scope.activeGroupIds.map((id) => Prisma.sql`${id}`)
          )}))
          OR
          (fd."groupId" IS NULL AND (fd."workspaceId" = ${scope.personalWorkspaceId} OR fd."ownerId" = ${scope.userId}))
        )`
      );
    } else {
      conditions.push(
        Prisma.sql`(fd."groupId" IS NULL AND (fd."workspaceId" = ${scope.personalWorkspaceId} OR fd."ownerId" = ${scope.userId}))`
      );
    }
  }

  return Prisma.join(conditions, " AND ");
}
