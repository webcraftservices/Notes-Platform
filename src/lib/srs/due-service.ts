import { db } from "@/lib/db";
import {
  getAccessibleAIScope,
  getAccessibleFlashcardDeck,
  getPrimaryWorkspace,
  type ResolvedAIScope,
} from "@/lib/access";
import { materialWhereForScope } from "@/lib/retrieval-scope";
import {
  deriveCardStateFromReview,
  normalizeTimezone,
  type PersistedReviewRecord,
} from "./fsrs";
import {
  buildStudyQueue,
  computeDeckStudyStats,
  serializeCardSchedule,
  type CardScheduleSummary,
  type DeckStudyStats,
} from "./study-queue";

export interface DueQueueCardItem {
  id: string;
  deckId: string;
  deckTitle: string;
  front: string;
  back: string;
  sources: { materialId: string; label: string; timestampSeconds?: number; page?: number }[] | null;
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
  review: {
    id: string;
    wasCorrect: boolean;
    rating: string | null;
    state: string;
    reviewedAt: string;
  } | null;
  schedule: CardScheduleSummary;
}

export interface DeckQueueSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
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
  stats: DeckStudyStats;
}

export interface DueFlashcardsResponse {
  timezone: string;
  generatedAt: string;
  stats: DeckStudyStats;
  decks: DeckQueueSummary[];
  queue: DueQueueCardItem[];
}

/**
 * Resolves the user's configured timezone from `Profile.timezone`, falling back to `"UTC"`.
 */
export async function getUserTimezone(userId: string): Promise<string> {
  if (typeof db.profile?.findUnique !== "function") {
    return "UTC";
  }
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return normalizeTimezone(profile?.timezone);
}

/**
 * Builds the fail-closed ancestor soft-delete filter for `FlashcardDeck`.
 * Ensures that if a deck is attached to a Topic, Chapter, Subject, or Group
 * that has been soft-deleted (`deletedAt !== null`), the deck and its cards
 * are strictly excluded.
 */
export function buildActiveDeckAncestorFilter() {
  return {
    AND: [
      {
        OR: [
          { topicId: null },
          {
            topic: {
              deletedAt: null,
              chapter: {
                deletedAt: null,
                subject: { deletedAt: null },
              },
            },
          },
        ],
      },
      {
        OR: [
          { chapterId: null },
          {
            chapter: {
              deletedAt: null,
              subject: { deletedAt: null },
            },
          },
        ],
      },
      {
        OR: [{ subjectId: null }, { subject: { deletedAt: null } }],
      },
      {
        OR: [{ groupId: null }, { group: { deletedAt: null } }],
      },
    ],
  };
}

/**
 * Computes the authenticated user's daily due flashcard review queue and per-deck
 * study counts across either a specific deck, a curriculum/group scope, or all
 * accessible decks in the user's workspace and active groups.
 */
export async function getDueFlashcardsForUser(params: {
  userId: string;
  scopeInput?: {
    subjectId?: string;
    chapterId?: string;
    topicId?: string;
    groupId?: string;
  };
  deckId?: string;
  limit?: number;
  newLimit?: number;
  includeNew?: boolean;
  now?: Date;
}): Promise<DueFlashcardsResponse | null> {
  const {
    userId,
    scopeInput,
    deckId,
    limit = 50,
    newLimit = 20,
    includeNew = true,
    now = new Date(),
  } = params;

  const timezone = await getUserTimezone(userId);
  const ancestorFilter = buildActiveDeckAncestorFilter();

  let deckWhere: Record<string, unknown>;

  if (deckId) {
    const accessibleDeck = await getAccessibleFlashcardDeck(deckId, userId);
    if (!accessibleDeck) {
      return null;
    }
    deckWhere = {
      id: accessibleDeck.id,
      ...ancestorFilter,
    };
  } else if (
    scopeInput &&
    Object.values(scopeInput).some((v) => v !== undefined)
  ) {
    const resolvedScope: ResolvedAIScope = await getAccessibleAIScope(scopeInput, userId);
    deckWhere = {
      ...materialWhereForScope(resolvedScope),
      ...ancestorFilter,
    };
  } else {
    // Global across user's personal workspace and active non-deleted study groups
    const [workspace, groupMemberships] = await Promise.all([
      getPrimaryWorkspace(userId),
      typeof db.groupMember?.findMany === "function"
        ? db.groupMember.findMany({
            where: { userId, group: { deletedAt: null } },
            select: { groupId: true },
          })
        : Promise.resolve([]),
    ]);
    const activeGroupIds = groupMemberships.map((m) => m.groupId);

    const ownershipBranches: Record<string, unknown>[] = [
      { groupId: null, ownerId: userId },
      { groupId: null, workspaceId: workspace.id },
    ];
    if (activeGroupIds.length > 0) {
      ownershipBranches.push({ groupId: { in: activeGroupIds } });
    }

    deckWhere = {
      AND: [
        { OR: ownershipBranches },
        ...ancestorFilter.AND,
      ],
    };
  }

  const decks = await db.flashcardDeck.findMany({
    where: deckWhere,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: {
      subject: { select: { id: true, name: true, deletedAt: true } },
      chapter: { select: { id: true, name: true, deletedAt: true } },
      topic: { select: { id: true, name: true, deletedAt: true } },
      group: { select: { id: true, name: true, deletedAt: true } },
      cards: {
        orderBy: { id: "asc" },
        include: {
          reviews: {
            where: { userId },
            orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
            take: 1,
          },
        },
      },
    },
  });

  const allCardItems: DueQueueCardItem[] = [];
  const deckSummaries: DeckQueueSummary[] = [];

  for (const deck of decks) {
    // Defensive check if any loaded ancestor was marked deleted
    if (
      (deck.topic && deck.topic.deletedAt !== null) ||
      (deck.chapter && deck.chapter.deletedAt !== null) ||
      (deck.subject && deck.subject.deletedAt !== null) ||
      (deck.group && deck.group.deletedAt !== null)
    ) {
      continue;
    }

    const hierarchy = {
      subjectId: deck.subject?.id ?? deck.subjectId ?? undefined,
      subjectName: deck.subject?.name ?? undefined,
      chapterId: deck.chapter?.id ?? deck.chapterId ?? undefined,
      chapterName: deck.chapter?.name ?? undefined,
      topicId: deck.topic?.id ?? deck.topicId ?? undefined,
      topicName: deck.topic?.name ?? undefined,
      groupId: deck.group?.id ?? deck.groupId ?? undefined,
      groupName: deck.group?.name ?? undefined,
    };

    const deckCardItems: DueQueueCardItem[] = deck.cards.map((card) => {
      const latestReview = (card.reviews?.[0] ?? null) as
        | (PersistedReviewRecord & { id: string; reviewedAt: Date })
        | null;
      const stateObj = deriveCardStateFromReview(latestReview);
      const schedule = serializeCardSchedule(stateObj, now, timezone);

      return {
        id: card.id,
        deckId: deck.id,
        deckTitle: deck.title,
        front: card.front,
        back: card.back,
        sources: (card.sources as DueQueueCardItem["sources"]) ?? null,
        hierarchy,
        review: latestReview
          ? {
              id: latestReview.id,
              wasCorrect: latestReview.wasCorrect,
              rating: latestReview.rating ?? null,
              state: stateObj.state,
              reviewedAt:
                latestReview.reviewedAt instanceof Date
                  ? latestReview.reviewedAt.toISOString()
                  : String(latestReview.reviewedAt),
            }
          : null,
        schedule,
      };
    });

    const deckStats = computeDeckStudyStats(deckCardItems, now, timezone);
    deckSummaries.push({
      id: deck.id,
      title: deck.title,
      createdAt: deck.createdAt instanceof Date ? deck.createdAt.toISOString() : String(deck.createdAt),
      updatedAt: deck.updatedAt instanceof Date ? deck.updatedAt.toISOString() : String(deck.updatedAt),
      hierarchy,
      stats: deckStats,
    });

    allCardItems.push(...deckCardItems);
  }

  const partitioned = buildStudyQueue(allCardItems, {
    mode: includeNew ? "smart" : "due_only",
    newLimit,
    limit,
    now,
    timezone,
  });

  return {
    timezone,
    generatedAt: now.toISOString(),
    stats: partitioned.stats,
    decks: deckSummaries,
    queue: partitioned.queue,
  };
}

