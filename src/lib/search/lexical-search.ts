/**
 * src/lib/search/lexical-search.ts
 *
 * PostgreSQL GIN Full-Text Search Builder & Runner for Zenote Phase 12.
 * Executes weighted tsvector queries across Subjects, Chapters, Topics,
 * Materials, Notes, StudyGroups, and FlashcardDecks with zero join duplication,
 * fail-closed tenancy filters, and websearch_to_tsquery normalization.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { UserSearchScope } from "./search-access";

export type SearchableEntityType =
  | "subject"
  | "chapter"
  | "topic"
  | "material"
  | "note"
  | "group"
  | "flashcard";

export interface LexicalSearchParams {
  query: string;
  scope: UserSearchScope;
  types?: SearchableEntityType[];
  groupId?: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
  limit?: number;
  offset?: number;
}

export interface RawLexicalHit {
  id: string;
  entityType: SearchableEntityType;
  title: string;
  snippetSourceText?: string;
  rankScore: number;
  hierarchy: {
    subjectId?: string;
    subjectName?: string;
    chapterId?: string;
    chapterName?: string;
    topicId?: string;
    topicName?: string;
    groupId?: string;
    groupName?: string;
  };
  navigation?: {
    href: string;
    pageNumber?: number;
    timestampSeconds?: number;
  };
}

/**
 * Normalizes user search input for PostgreSQL FTS:
 * - Trims leading/trailing whitespace
 * - Collapses repeated whitespace
 * - Enforces max length cap (200 chars)
 */
export function normalizeSearchQuery(rawQuery: string): string {
  if (!rawQuery) return "";
  return rawQuery.trim().replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Generates canonical navigation URL for each entity type adhering to Zenote routing.
 */
export function buildLexicalNavigationHref(
  entityType: SearchableEntityType,
  id: string,
  hierarchy: RawLexicalHit["hierarchy"]
): string {
  switch (entityType) {
    case "subject":
      return `/subjects/${encodeURIComponent(id)}`;
    case "chapter":
      return hierarchy.subjectId
        ? `/subjects/${encodeURIComponent(hierarchy.subjectId)}/chapters/${encodeURIComponent(id)}`
        : `/subjects`;
    case "topic":
      return hierarchy.subjectId && hierarchy.chapterId
        ? `/subjects/${encodeURIComponent(hierarchy.subjectId)}/chapters/${encodeURIComponent(hierarchy.chapterId)}/topics/${encodeURIComponent(id)}`
        : `/subjects`;
    case "note":
      return hierarchy.subjectId && hierarchy.chapterId && hierarchy.topicId
        ? `/subjects/${encodeURIComponent(hierarchy.subjectId)}/chapters/${encodeURIComponent(hierarchy.chapterId)}/topics/${encodeURIComponent(hierarchy.topicId)}?tab=notes`
        : `/notes/${encodeURIComponent(id)}`;
    case "material":
      return `/materials/${encodeURIComponent(id)}`;
    case "group":
      return `/groups/${encodeURIComponent(id)}`;
    case "flashcard":
      return `/flashcards/${encodeURIComponent(id)}`;
  }
}

// ============================================================================
// SQL Helpers for Safe Group Conditions and Hierarchy Filtering
// ============================================================================

function scopeGroupCondition(scope: UserSearchScope, subjectAlias: string, groupAlias: string): Prisma.Sql {
  if (scope.activeGroupIds.length === 0) return Prisma.sql`1 = 0`;
  return Prisma.sql`(${Prisma.raw(subjectAlias)}."groupId" IN (${Prisma.join(
    scope.activeGroupIds.map((id) => Prisma.sql`${id}`)
  )}) AND ${Prisma.raw(groupAlias)}."deletedAt" IS NULL)`;
}

function scopeGroupInCondition(scope: UserSearchScope, groupColumnExpr: string, groupAlias: string): Prisma.Sql {
  if (scope.activeGroupIds.length === 0) return Prisma.sql`1 = 0`;
  return Prisma.sql`(${Prisma.raw(groupColumnExpr)} IN (${Prisma.join(
    scope.activeGroupIds.map((id) => Prisma.sql`${id}`)
  )}) AND ${Prisma.raw(groupAlias)}."deletedAt" IS NULL)`;
}

// ============================================================================
// Entity Lexical Query Functions
// ============================================================================

async function querySubjects(
  params: LexicalSearchParams,
  normalizedQuery: string,
  limit: number
): Promise<RawLexicalHit[]> {
  const { scope, groupId, subjectId } = params;

  const rows = await db.$queryRaw<
    {
      id: string;
      entityType: string;
      title: string;
      snippetSourceText: string;
      subjectId: string | null;
      subjectName: string | null;
      chapterId: string | null;
      chapterName: string | null;
      topicId: string | null;
      topicName: string | null;
      groupId: string | null;
      groupName: string | null;
      rankScore: number;
    }[]
  >`
    SELECT
      s.id,
      'subject'::text AS "entityType",
      s.name AS "title",
      coalesce(s.description, s.name) AS "snippetSourceText",
      s.id AS "subjectId",
      s.name AS "subjectName",
      NULL::text AS "chapterId",
      NULL::text AS "chapterName",
      NULL::text AS "topicId",
      NULL::text AS "topicName",
      s."groupId",
      g.name AS "groupName",
      ts_rank_cd(
        (
          setweight(to_tsvector('english', coalesce(s."name", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(s."description", '')), 'B')
        ),
        websearch_to_tsquery('english', ${normalizedQuery})
      )::float AS "rankScore"
    FROM "Subject" s
    LEFT JOIN "Group" g ON g.id = s."groupId"
    WHERE
      s."deletedAt" IS NULL
      AND (
        (s."workspaceId" = ${scope.personalWorkspaceId})
        OR
        (s."groupId" IS NOT NULL AND ${scopeGroupCondition(scope, "s", "g")})
      )
      ${groupId ? Prisma.sql`AND s."groupId" = ${groupId}` : Prisma.empty}
      ${subjectId ? Prisma.sql`AND s.id = ${subjectId}` : Prisma.empty}
      AND (
        setweight(to_tsvector('english', coalesce(s."name", '')), 'A') ||
        setweight(to_tsvector('english', coalesce(s."description", '')), 'B')
      ) @@ websearch_to_tsquery('english', ${normalizedQuery})
    ORDER BY "rankScore" DESC
    LIMIT ${limit};
  `;

  return rows.map((r) => {
    const hierarchy = {
      subjectId: r.subjectId ?? undefined,
      subjectName: r.subjectName ?? undefined,
      chapterId: r.chapterId ?? undefined,
      chapterName: r.chapterName ?? undefined,
      topicId: r.topicId ?? undefined,
      topicName: r.topicName ?? undefined,
      groupId: r.groupId ?? undefined,
      groupName: r.groupName ?? undefined,
    };
    return {
      id: r.id,
      entityType: "subject",
      title: r.title,
      snippetSourceText: r.snippetSourceText,
      rankScore: Number(r.rankScore),
      hierarchy,
      navigation: {
        href: buildLexicalNavigationHref("subject", r.id, hierarchy),
      },
    };
  });
}

async function queryChapters(
  params: LexicalSearchParams,
  normalizedQuery: string,
  limit: number
): Promise<RawLexicalHit[]> {
  const { scope, groupId, subjectId, chapterId } = params;

  const rows = await db.$queryRaw<
    {
      id: string;
      entityType: string;
      title: string;
      snippetSourceText: string;
      subjectId: string | null;
      subjectName: string | null;
      chapterId: string | null;
      chapterName: string | null;
      topicId: string | null;
      topicName: string | null;
      groupId: string | null;
      groupName: string | null;
      rankScore: number;
    }[]
  >`
    SELECT
      c.id,
      'chapter'::text AS "entityType",
      c.name AS "title",
      coalesce(c.description, c.name) AS "snippetSourceText",
      s.id AS "subjectId",
      s.name AS "subjectName",
      c.id AS "chapterId",
      c.name AS "chapterName",
      NULL::text AS "topicId",
      NULL::text AS "topicName",
      s."groupId",
      g.name AS "groupName",
      ts_rank_cd(
        (
          setweight(to_tsvector('english', coalesce(c."name", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(c."description", '')), 'B')
        ),
        websearch_to_tsquery('english', ${normalizedQuery})
      )::float AS "rankScore"
    FROM "Chapter" c
    JOIN "Subject" s ON s.id = c."subjectId"
    LEFT JOIN "Group" g ON g.id = s."groupId"
    WHERE
      c."deletedAt" IS NULL
      AND s."deletedAt" IS NULL
      AND (
        (s."workspaceId" = ${scope.personalWorkspaceId})
        OR
        (s."groupId" IS NOT NULL AND ${scopeGroupCondition(scope, "s", "g")})
      )
      ${groupId ? Prisma.sql`AND s."groupId" = ${groupId}` : Prisma.empty}
      ${subjectId ? Prisma.sql`AND c."subjectId" = ${subjectId}` : Prisma.empty}
      ${chapterId ? Prisma.sql`AND c.id = ${chapterId}` : Prisma.empty}
      AND (
        setweight(to_tsvector('english', coalesce(c."name", '')), 'A') ||
        setweight(to_tsvector('english', coalesce(c."description", '')), 'B')
      ) @@ websearch_to_tsquery('english', ${normalizedQuery})
    ORDER BY "rankScore" DESC
    LIMIT ${limit};
  `;

  return rows.map((r) => {
    const hierarchy = {
      subjectId: r.subjectId ?? undefined,
      subjectName: r.subjectName ?? undefined,
      chapterId: r.chapterId ?? undefined,
      chapterName: r.chapterName ?? undefined,
      topicId: r.topicId ?? undefined,
      topicName: r.topicName ?? undefined,
      groupId: r.groupId ?? undefined,
      groupName: r.groupName ?? undefined,
    };
    return {
      id: r.id,
      entityType: "chapter",
      title: r.title,
      snippetSourceText: r.snippetSourceText,
      rankScore: Number(r.rankScore),
      hierarchy,
      navigation: {
        href: buildLexicalNavigationHref("chapter", r.id, hierarchy),
      },
    };
  });
}

async function queryTopics(
  params: LexicalSearchParams,
  normalizedQuery: string,
  limit: number
): Promise<RawLexicalHit[]> {
  const { scope, groupId, subjectId, chapterId, topicId } = params;

  const rows = await db.$queryRaw<
    {
      id: string;
      entityType: string;
      title: string;
      snippetSourceText: string;
      subjectId: string | null;
      subjectName: string | null;
      chapterId: string | null;
      chapterName: string | null;
      topicId: string | null;
      topicName: string | null;
      groupId: string | null;
      groupName: string | null;
      rankScore: number;
    }[]
  >`
    SELECT
      t.id,
      'topic'::text AS "entityType",
      t.name AS "title",
      coalesce(t.description, t.name) AS "snippetSourceText",
      s.id AS "subjectId",
      s.name AS "subjectName",
      c.id AS "chapterId",
      c.name AS "chapterName",
      t.id AS "topicId",
      t.name AS "topicName",
      s."groupId",
      g.name AS "groupName",
      ts_rank_cd(
        (
          setweight(to_tsvector('english', coalesce(t."name", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(t."description", '')), 'B')
        ),
        websearch_to_tsquery('english', ${normalizedQuery})
      )::float AS "rankScore"
    FROM "Topic" t
    JOIN "Chapter" c ON c.id = t."chapterId"
    JOIN "Subject" s ON s.id = c."subjectId"
    LEFT JOIN "Group" g ON g.id = s."groupId"
    WHERE
      t."deletedAt" IS NULL
      AND c."deletedAt" IS NULL
      AND s."deletedAt" IS NULL
      AND (
        (s."workspaceId" = ${scope.personalWorkspaceId})
        OR
        (s."groupId" IS NOT NULL AND ${scopeGroupCondition(scope, "s", "g")})
      )
      ${groupId ? Prisma.sql`AND s."groupId" = ${groupId}` : Prisma.empty}
      ${subjectId ? Prisma.sql`AND c."subjectId" = ${subjectId}` : Prisma.empty}
      ${chapterId ? Prisma.sql`AND t."chapterId" = ${chapterId}` : Prisma.empty}
      ${topicId ? Prisma.sql`AND t.id = ${topicId}` : Prisma.empty}
      AND (
        setweight(to_tsvector('english', coalesce(t."name", '')), 'A') ||
        setweight(to_tsvector('english', coalesce(t."description", '')), 'B')
      ) @@ websearch_to_tsquery('english', ${normalizedQuery})
    ORDER BY "rankScore" DESC
    LIMIT ${limit};
  `;

  return rows.map((r) => {
    const hierarchy = {
      subjectId: r.subjectId ?? undefined,
      subjectName: r.subjectName ?? undefined,
      chapterId: r.chapterId ?? undefined,
      chapterName: r.chapterName ?? undefined,
      topicId: r.topicId ?? undefined,
      topicName: r.topicName ?? undefined,
      groupId: r.groupId ?? undefined,
      groupName: r.groupName ?? undefined,
    };
    return {
      id: r.id,
      entityType: "topic",
      title: r.title,
      snippetSourceText: r.snippetSourceText,
      rankScore: Number(r.rankScore),
      hierarchy,
      navigation: {
        href: buildLexicalNavigationHref("topic", r.id, hierarchy),
      },
    };
  });
}

async function queryMaterials(
  params: LexicalSearchParams,
  normalizedQuery: string,
  limit: number
): Promise<RawLexicalHit[]> {
  const { scope, groupId, subjectId, chapterId, topicId } = params;

  const rows = await db.$queryRaw<
    {
      id: string;
      entityType: string;
      title: string;
      snippetSourceText: string;
      subjectId: string | null;
      subjectName: string | null;
      chapterId: string | null;
      chapterName: string | null;
      topicId: string | null;
      topicName: string | null;
      groupId: string | null;
      groupName: string | null;
      rankScore: number;
    }[]
  >`
    SELECT
      m.id,
      'material'::text AS "entityType",
      m.title,
      coalesce(m."extractedText", m."originalFilename", m.title) AS "snippetSourceText",
      s.id AS "subjectId",
      s.name AS "subjectName",
      c.id AS "chapterId",
      c.name AS "chapterName",
      t.id AS "topicId",
      t.name AS "topicName",
      coalesce(m."groupId", s."groupId") AS "groupId",
      g.name AS "groupName",
      ts_rank_cd(
        (
          setweight(to_tsvector('english', coalesce(m."title", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(m."originalFilename", '')), 'B') ||
          setweight(to_tsvector('english', coalesce(m."extractedText", '')), 'C')
        ),
        websearch_to_tsquery('english', ${normalizedQuery})
      )::float AS "rankScore"
    FROM "Material" m
    LEFT JOIN "Topic" t ON t.id = m."topicId"
    LEFT JOIN "Chapter" c ON c.id = coalesce(m."chapterId", t."chapterId")
    LEFT JOIN "Subject" s ON s.id = coalesce(m."subjectId", c."subjectId")
    LEFT JOIN "Group" g ON g.id = coalesce(m."groupId", s."groupId")
    WHERE
      m."deletedAt" IS NULL
      AND (m."topicId" IS NULL OR t."deletedAt" IS NULL)
      AND (c.id IS NULL OR c."deletedAt" IS NULL)
      AND (s.id IS NULL OR s."deletedAt" IS NULL)
      AND (
        (
          coalesce(m."groupId", s."groupId") IS NOT NULL
          AND ${scopeGroupInCondition(scope, `coalesce(m."groupId", s."groupId")`, "g")}
        )
        OR
        (
          coalesce(m."groupId", s."groupId") IS NULL
          AND (
            m."ownerId" = ${scope.userId}
            OR m."workspaceId" = ${scope.personalWorkspaceId}
            OR s."workspaceId" = ${scope.personalWorkspaceId}
          )
        )
      )
      ${groupId ? Prisma.sql`AND coalesce(m."groupId", s."groupId") = ${groupId}` : Prisma.empty}
      ${subjectId ? Prisma.sql`AND coalesce(m."subjectId", c."subjectId") = ${subjectId}` : Prisma.empty}
      ${chapterId ? Prisma.sql`AND coalesce(m."chapterId", t."chapterId") = ${chapterId}` : Prisma.empty}
      ${topicId ? Prisma.sql`AND m."topicId" = ${topicId}` : Prisma.empty}
      AND (
        setweight(to_tsvector('english', coalesce(m."title", '')), 'A') ||
        setweight(to_tsvector('english', coalesce(m."originalFilename", '')), 'B') ||
        setweight(to_tsvector('english', coalesce(m."extractedText", '')), 'C')
      ) @@ websearch_to_tsquery('english', ${normalizedQuery})
    ORDER BY "rankScore" DESC
    LIMIT ${limit};
  `;

  return rows.map((r) => {
    const hierarchy = {
      subjectId: r.subjectId ?? undefined,
      subjectName: r.subjectName ?? undefined,
      chapterId: r.chapterId ?? undefined,
      chapterName: r.chapterName ?? undefined,
      topicId: r.topicId ?? undefined,
      topicName: r.topicName ?? undefined,
      groupId: r.groupId ?? undefined,
      groupName: r.groupName ?? undefined,
    };
    return {
      id: r.id,
      entityType: "material",
      title: r.title,
      snippetSourceText: r.snippetSourceText,
      rankScore: Number(r.rankScore),
      hierarchy,
      navigation: {
        href: buildLexicalNavigationHref("material", r.id, hierarchy),
      },
    };
  });
}

async function queryNotes(
  params: LexicalSearchParams,
  normalizedQuery: string,
  limit: number
): Promise<RawLexicalHit[]> {
  const { scope, groupId, subjectId, chapterId, topicId } = params;

  const rows = await db.$queryRaw<
    {
      id: string;
      entityType: string;
      title: string;
      snippetSourceText: string;
      subjectId: string | null;
      subjectName: string | null;
      chapterId: string | null;
      chapterName: string | null;
      topicId: string | null;
      topicName: string | null;
      groupId: string | null;
      groupName: string | null;
      rankScore: number;
    }[]
  >`
    SELECT
      n.id,
      'note'::text AS "entityType",
      n.title,
      coalesce(n."plainText", n.title) AS "snippetSourceText",
      s.id AS "subjectId",
      s.name AS "subjectName",
      c.id AS "chapterId",
      c.name AS "chapterName",
      t.id AS "topicId",
      t.name AS "topicName",
      s."groupId",
      g.name AS "groupName",
      ts_rank_cd(
        (
          setweight(to_tsvector('english', coalesce(n."title", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(n."plainText", '')), 'B')
        ),
        websearch_to_tsquery('english', ${normalizedQuery})
      )::float AS "rankScore"
    FROM "Note" n
    LEFT JOIN "Topic" t ON t.id = n."topicId"
    LEFT JOIN "Chapter" c ON c.id = t."chapterId"
    LEFT JOIN "Subject" s ON s.id = c."subjectId"
    LEFT JOIN "Group" g ON g.id = s."groupId"
    WHERE
      n."deletedAt" IS NULL
      AND (
        (
          n."topicId" IS NOT NULL
          AND t."deletedAt" IS NULL
          AND c."deletedAt" IS NULL
          AND s."deletedAt" IS NULL
          AND (
            (s."workspaceId" = ${scope.personalWorkspaceId})
            OR
            (s."groupId" IS NOT NULL AND ${scopeGroupCondition(scope, "s", "g")})
          )
        )
        OR
        (
          n."topicId" IS NULL
          AND n."authorId" = ${scope.userId}
        )
      )
      ${groupId ? Prisma.sql`AND s."groupId" = ${groupId}` : Prisma.empty}
      ${subjectId ? Prisma.sql`AND c."subjectId" = ${subjectId}` : Prisma.empty}
      ${chapterId ? Prisma.sql`AND t."chapterId" = ${chapterId}` : Prisma.empty}
      ${topicId ? Prisma.sql`AND n."topicId" = ${topicId}` : Prisma.empty}
      AND (
        setweight(to_tsvector('english', coalesce(n."title", '')), 'A') ||
        setweight(to_tsvector('english', coalesce(n."plainText", '')), 'B')
      ) @@ websearch_to_tsquery('english', ${normalizedQuery})
    ORDER BY "rankScore" DESC
    LIMIT ${limit};
  `;

  return rows.map((r) => {
    const hierarchy = {
      subjectId: r.subjectId ?? undefined,
      subjectName: r.subjectName ?? undefined,
      chapterId: r.chapterId ?? undefined,
      chapterName: r.chapterName ?? undefined,
      topicId: r.topicId ?? undefined,
      topicName: r.topicName ?? undefined,
      groupId: r.groupId ?? undefined,
      groupName: r.groupName ?? undefined,
    };
    return {
      id: r.id,
      entityType: "note",
      title: r.title,
      snippetSourceText: r.snippetSourceText,
      rankScore: Number(r.rankScore),
      hierarchy,
      navigation: {
        href: buildLexicalNavigationHref("note", r.id, hierarchy),
      },
    };
  });
}

async function queryGroups(
  params: LexicalSearchParams,
  normalizedQuery: string,
  limit: number
): Promise<RawLexicalHit[]> {
  const { scope, groupId } = params;

  if (scope.activeGroupIds.length === 0) {
    return [];
  }

  const rows = await db.$queryRaw<
    {
      id: string;
      entityType: string;
      title: string;
      snippetSourceText: string;
      subjectId: string | null;
      subjectName: string | null;
      chapterId: string | null;
      chapterName: string | null;
      topicId: string | null;
      topicName: string | null;
      groupId: string | null;
      groupName: string | null;
      rankScore: number;
    }[]
  >`
    SELECT
      g.id,
      'group'::text AS "entityType",
      g.name AS "title",
      coalesce(g.description, g.name) AS "snippetSourceText",
      NULL::text AS "subjectId",
      NULL::text AS "subjectName",
      NULL::text AS "chapterId",
      NULL::text AS "chapterName",
      NULL::text AS "topicId",
      NULL::text AS "topicName",
      g.id AS "groupId",
      g.name AS "groupName",
      ts_rank_cd(
        (
          setweight(to_tsvector('english', coalesce(g."name", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(g."description", '')), 'B')
        ),
        websearch_to_tsquery('english', ${normalizedQuery})
      )::float AS "rankScore"
    FROM "Group" g
    WHERE
      g."deletedAt" IS NULL
      AND ${scopeGroupInCondition(scope, `g.id`, "g")}
      ${groupId ? Prisma.sql`AND g.id = ${groupId}` : Prisma.empty}
      AND (
        setweight(to_tsvector('english', coalesce(g."name", '')), 'A') ||
        setweight(to_tsvector('english', coalesce(g."description", '')), 'B')
      ) @@ websearch_to_tsquery('english', ${normalizedQuery})
    ORDER BY "rankScore" DESC
    LIMIT ${limit};
  `;

  return rows.map((r) => {
    const hierarchy = {
      groupId: r.groupId ?? undefined,
      groupName: r.groupName ?? undefined,
    };
    return {
      id: r.id,
      entityType: "group",
      title: r.title,
      snippetSourceText: r.snippetSourceText,
      rankScore: Number(r.rankScore),
      hierarchy,
      navigation: {
        href: buildLexicalNavigationHref("group", r.id, hierarchy),
      },
    };
  });
}

async function queryFlashcards(
  params: LexicalSearchParams,
  normalizedQuery: string,
  limit: number
): Promise<RawLexicalHit[]> {
  const { scope, groupId, subjectId, chapterId, topicId } = params;

  const rows = await db.$queryRaw<
    {
      id: string;
      entityType: string;
      title: string;
      snippetSourceText: string;
      subjectId: string | null;
      subjectName: string | null;
      chapterId: string | null;
      chapterName: string | null;
      topicId: string | null;
      topicName: string | null;
      groupId: string | null;
      groupName: string | null;
      rankScore: number;
    }[]
  >`
    SELECT
      fd.id,
      'flashcard'::text AS "entityType",
      fd.title,
      coalesce(matched_card."cardSnippet", fd.title) AS "snippetSourceText",
      s.id AS "subjectId",
      s.name AS "subjectName",
      c.id AS "chapterId",
      c.name AS "chapterName",
      t.id AS "topicId",
      t.name AS "topicName",
      coalesce(fd."groupId", s."groupId") AS "groupId",
      g.name AS "groupName",
      (
        ts_rank_cd(
          (
            setweight(to_tsvector('english', coalesce(fd."title", '')), 'A')
          ),
          websearch_to_tsquery('english', ${normalizedQuery})
        ) + coalesce(matched_card."cardRank", 0)
      )::float AS "rankScore"
    FROM "FlashcardDeck" fd
    LEFT JOIN "Topic" t ON t.id = fd."topicId"
    LEFT JOIN "Chapter" c ON c.id = coalesce(fd."chapterId", t."chapterId")
    LEFT JOIN "Subject" s ON s.id = coalesce(fd."subjectId", c."subjectId")
    LEFT JOIN "Group" g ON g.id = coalesce(fd."groupId", s."groupId")
    LEFT JOIN LATERAL (
      SELECT
        fc.id,
        concat(fc."front", ' — ', fc."back") AS "cardSnippet",
        ts_rank_cd(
          (
            setweight(to_tsvector('english', coalesce(fc."front", '')), 'B') ||
            setweight(to_tsvector('english', coalesce(fc."back", '')), 'C')
          ),
          websearch_to_tsquery('english', ${normalizedQuery})
        )::float AS "cardRank"
      FROM "Flashcard" fc
      WHERE
        fc."deckId" = fd.id
        AND (
          setweight(to_tsvector('english', coalesce(fc."front", '')), 'B') ||
          setweight(to_tsvector('english', coalesce(fc."back", '')), 'C')
        ) @@ websearch_to_tsquery('english', ${normalizedQuery})
      ORDER BY "cardRank" DESC, fc.id ASC
      LIMIT 1
    ) matched_card ON TRUE
    WHERE
      (fd."topicId" IS NULL OR t."deletedAt" IS NULL)
      AND (c.id IS NULL OR c."deletedAt" IS NULL)
      AND (s.id IS NULL OR s."deletedAt" IS NULL)
      AND (
        (
          coalesce(fd."groupId", s."groupId") IS NOT NULL
          AND ${scopeGroupInCondition(scope, `coalesce(fd."groupId", s."groupId")`, "g")}
        )
        OR
        (
          coalesce(fd."groupId", s."groupId") IS NULL
          AND (
            fd."ownerId" = ${scope.userId}
            OR fd."workspaceId" = ${scope.personalWorkspaceId}
            OR s."workspaceId" = ${scope.personalWorkspaceId}
          )
        )
      )
      ${groupId ? Prisma.sql`AND coalesce(fd."groupId", s."groupId") = ${groupId}` : Prisma.empty}
      ${subjectId ? Prisma.sql`AND coalesce(fd."subjectId", c."subjectId") = ${subjectId}` : Prisma.empty}
      ${chapterId ? Prisma.sql`AND coalesce(fd."chapterId", t."chapterId") = ${chapterId}` : Prisma.empty}
      ${topicId ? Prisma.sql`AND fd."topicId" = ${topicId}` : Prisma.empty}
      AND (
        (
          setweight(to_tsvector('english', coalesce(fd."title", '')), 'A')
        ) @@ websearch_to_tsquery('english', ${normalizedQuery})
        OR matched_card.id IS NOT NULL
      )
    ORDER BY "rankScore" DESC
    LIMIT ${limit};
  `;

  return rows.map((r) => {
    const hierarchy = {
      subjectId: r.subjectId ?? undefined,
      subjectName: r.subjectName ?? undefined,
      chapterId: r.chapterId ?? undefined,
      chapterName: r.chapterName ?? undefined,
      topicId: r.topicId ?? undefined,
      topicName: r.topicName ?? undefined,
      groupId: r.groupId ?? undefined,
      groupName: r.groupName ?? undefined,
    };
    return {
      id: r.id,
      entityType: "flashcard",
      title: r.title,
      snippetSourceText: r.snippetSourceText,
      rankScore: Number(r.rankScore),
      hierarchy,
      navigation: {
        href: buildLexicalNavigationHref("flashcard", r.id, hierarchy),
      },
    };
  });
}

// ============================================================================
// Top-Level Execution Function
// ============================================================================

export async function executeLexicalSearch(params: LexicalSearchParams): Promise<RawLexicalHit[]> {
  const normalizedQuery = normalizeSearchQuery(params.query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  // If groupId is explicitly requested, fail closed if user is not an active member
  if (params.groupId && !params.scope.activeGroupIds.includes(params.groupId)) {
    return [];
  }

  const requestedTypes = new Set<SearchableEntityType>(
    params.types && params.types.length > 0
      ? params.types
      : ["subject", "chapter", "topic", "material", "note", "group", "flashcard"]
  );

  const queryLimit = Math.max(params.limit ?? 20, 50);

  const entityPromises: Promise<RawLexicalHit[]>[] = [];

  if (requestedTypes.has("subject") && !params.chapterId && !params.topicId) {
    entityPromises.push(querySubjects(params, normalizedQuery, queryLimit));
  }
  if (requestedTypes.has("chapter") && !params.topicId) {
    entityPromises.push(queryChapters(params, normalizedQuery, queryLimit));
  }
  if (requestedTypes.has("topic")) {
    entityPromises.push(queryTopics(params, normalizedQuery, queryLimit));
  }
  if (requestedTypes.has("material")) {
    entityPromises.push(queryMaterials(params, normalizedQuery, queryLimit));
  }
  if (requestedTypes.has("note")) {
    entityPromises.push(queryNotes(params, normalizedQuery, queryLimit));
  }
  if (requestedTypes.has("group") && !params.subjectId && !params.chapterId && !params.topicId) {
    entityPromises.push(queryGroups(params, normalizedQuery, queryLimit));
  }
  if (requestedTypes.has("flashcard")) {
    entityPromises.push(queryFlashcards(params, normalizedQuery, queryLimit));
  }

  const nestedHits = await Promise.all(entityPromises);
  const allHits = nestedHits.flat();

  // Sort by lexical rankScore descending
  allHits.sort((a, b) => b.rankScore - a.rankScore);

  return allHits;
}
