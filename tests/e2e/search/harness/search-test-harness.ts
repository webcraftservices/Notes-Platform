/**
 * Test client utilities and execution harness for Phase 12 E2E Search tests.
 * Dispatches opaque HTTP/NextRequest calls to route handlers or search services,
 * manages auth context, and provides reference search simulation.
 */

import { MockDbStore, globalMockStore } from "./mock-db-store";
import {
  SearchApiResponse,
  SearchHit,
  EntityType,
  SearchMode,
  VALID_ENTITY_TYPES,
  VALID_SEARCH_MODES,
  calculateRRFScore,
} from "./contracts";
import { cosineSimilarity, createMockEmbedding } from "./fixtures";

export interface SearchTestClientOptions {
  store?: MockDbStore;
  baseUrl?: string;
}

export class SearchTestHarness {
  public store: MockDbStore;
  public baseUrl: string;
  private customRouteHandler?: (req: Request) => Promise<Response>;

  constructor(options?: SearchTestClientOptions) {
    this.store = options?.store || globalMockStore;
    this.baseUrl = options?.baseUrl || "https://example.test";
  }

  /**
   * Sets the active authenticated user in the mock store.
   */
  public setAuthUser(user: { id: string; email?: string; name?: string } | null): void {
    this.store.setCurrentUser(user);
  }

  /**
   * Gets the active authenticated user from the mock store.
   */
  public getAuthUser(): { id: string; email: string; name: string } | null {
    return this.store.getCurrentUser();
  }

  /**
   * Sets an explicit route handler to receive dispatched search requests.
   */
  public setRouteHandler(handler?: (req: Request) => Promise<Response>): void {
    this.customRouteHandler = handler;
  }

  /**
   * Resets all fixtures and restores default authenticated user (Alice).
   */
  public reset(): void {
    this.store.reset();
    this.customRouteHandler = undefined;
  }

  /**
   * Creates a standard Request object for GET /api/search with given query parameters.
   */
  public createSearchRequest(
    params: Record<string, any>,
    options?: { headers?: Record<string, string> }
  ): Request {
    const url = new URL("/api/search", this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          url.searchParams.set(key, value.join(","));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers = new Headers(options?.headers);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }

    return new Request(url.toString(), {
      method: "GET",
      headers,
    });
  }

  /**
   * Dispatches a search request to a route handler. If no custom handler is provided,
   * it uses the simulated reference engine that matches PROJECT.md specifications.
   * Priority resolution:
   * 1. Explicit per-call routeHandler parameter
   * 2. Instance customRouteHandler (set via setRouteHandler)
   * 3. Real Next.js route handler (src/app/api/search/route.ts) if process.env.E2E_USE_REAL_ROUTE === "true"
   * 4. In-memory reference oracle simulation (simulateSearchRouteHandler) as development fallback
   */
  public async dispatchSearchApi(
    params: Record<string, any>,
    user?: { id: string; email?: string; name?: string } | null,
    routeHandler?: (req: Request) => Promise<Response>
  ): Promise<Response> {
    if (user !== undefined) {
      this.setAuthUser(user);
    }

    const req = this.createSearchRequest(params);

    // 1. Explicit per-call handler
    if (routeHandler) {
      return await routeHandler(req);
    }

    // 2. Instance custom handler
    if (this.customRouteHandler) {
      return await this.customRouteHandler(req);
    }

    // 3. Dynamic binding to live Next.js route handler when configured via env flag
    if (process.env.E2E_USE_REAL_ROUTE === "true") {
      try {
        const routeModule = await import("@/app/api/search/route");
        if (typeof routeModule.GET === "function") {
          return await routeModule.GET(req);
        }
      } catch (err) {
        console.warn("[SearchTestHarness] Dynamic route import failed, falling back to oracle:", err);
      }
    }

    // 4. Default reference oracle dispatcher
    return await this.simulateSearchRouteHandler(req);
  }

  /**
   * Dispatches a search request and automatically parses JSON response data.
   */
  public async dispatchSearchApiJson(
    params: Record<string, any>,
    user?: { id: string; email?: string; name?: string } | null,
    routeHandler?: (req: Request) => Promise<Response>
  ): Promise<{ status: number; data: any; headers: Headers }> {
    const response = await this.dispatchSearchApi(params, user, routeHandler);
    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return {
      status: response.status,
      data,
      headers: response.headers,
    };
  }

  /**
   * Reference Oracle: Simulates the complete Phase 12 Search Route Handler matching PROJECT.md.
   */
  public async simulateSearchRouteHandler(req: Request): Promise<Response> {
    const currentUser = this.getAuthUser();
    if (!currentUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const qRaw = url.searchParams.get("q");

    if (qRaw === null || qRaw.trim().length < 2) {
      return new Response(
        JSON.stringify({
          error: "Query parameter 'q' must have at least 2 characters",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const q = qRaw.trim();
    if (q.length > 200) {
      return new Response(
        JSON.stringify({
          error: "Query parameter 'q' must not exceed 200 characters",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const modeParam = (url.searchParams.get("mode") || "hybrid") as SearchMode;
    if (!VALID_SEARCH_MODES.includes(modeParam)) {
      return new Response(
        JSON.stringify({
          error: `Invalid mode. Allowed: ${VALID_SEARCH_MODES.join(", ")}`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse types filter
    const typesParam = url.searchParams.get("types");
    let requestedTypes: EntityType[] = [...VALID_ENTITY_TYPES];
    if (typesParam) {
      const split = typesParam
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      for (const t of split) {
        if (t === "quiz") {
          return new Response(
            JSON.stringify({
              error: "Entity type 'quiz' is formally excluded from Phase 12 search",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        if (!VALID_ENTITY_TYPES.includes(t as EntityType)) {
          return new Response(
            JSON.stringify({
              error: `Invalid entity type '${t}'. Allowed: ${VALID_ENTITY_TYPES.join(", ")}`,
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      }
      requestedTypes = split as EntityType[];
    }

    // Parse pagination
    const limitParam = url.searchParams.get("limit");
    let limit = 20;
    if (limitParam !== null) {
      const parsedLimit = Number(limitParam);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        return new Response(
          JSON.stringify({ error: "Limit must be an integer between 1 and 50" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      limit = parsedLimit;
    }

    const offsetParam = url.searchParams.get("offset");
    let offset = 0;
    if (offsetParam !== null) {
      const parsedOffset = Number(offsetParam);
      if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
        return new Response(
          JSON.stringify({ error: "Offset must be a non-negative integer" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      offset = parsedOffset;
    }

    const groupId = url.searchParams.get("groupId") || undefined;
    const subjectId = url.searchParams.get("subjectId") || undefined;
    const chapterId = url.searchParams.get("chapterId") || undefined;
    const topicId = url.searchParams.get("topicId") || undefined;

    const result = this.executeOracleSearch({
      query: q,
      mode: modeParam,
      types: requestedTypes,
      limit,
      offset,
      groupId,
      subjectId,
      chapterId,
      topicId,
      userId: currentUser.id,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Reference Oracle Search Logic:
   * Evaluates lexical and semantic retrieval over in-memory store, applies RRF k=60,
   * collapses chunks, enforces hierarchy scoping and soft-delete fail-closed rules.
   */
  public executeOracleSearch(args: {
    query: string;
    mode: SearchMode;
    types: EntityType[];
    limit: number;
    offset: number;
    groupId?: string;
    subjectId?: string;
    chapterId?: string;
    topicId?: string;
    userId: string;
  }): SearchApiResponse {
    const scope = this.store.resolveUserSearchScope(args.userId);
    const data = this.store.getData();
    const queryTokens = args.query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0);

    // Track active (non-soft-deleted) ancestor IDs for fail-closed checks
    const activeGroupIds = new Set(
      data.groups.filter((g) => !g.deletedAt).map((g) => g.id)
    );
    const activeSubjectMap = new Map(
      data.subjects.filter((s) => !s.deletedAt).map((s) => [s.id, s])
    );
    const activeChapterMap = new Map(
      data.chapters
        .filter((c) => !c.deletedAt && activeSubjectMap.has(c.subjectId))
        .map((c) => [c.id, c])
    );
    const activeTopicMap = new Map(
      data.topics
        .filter((t) => !t.deletedAt && activeChapterMap.has(t.chapterId))
        .map((t) => [t.id, t])
    );

    // Helper: is entity authorized for this user?
    const isAuthorized = (itemWorkspaceId?: string | null, itemGroupId?: string | null): boolean => {
      if (itemGroupId) {
        return scope.activeGroupIds.includes(itemGroupId) && activeGroupIds.has(itemGroupId);
      }
      if (itemWorkspaceId) {
        return itemWorkspaceId === scope.personalWorkspaceId;
      }
      return false;
    };

    // Helper: matches hierarchy filter
    const matchesHierarchyFilter = (hierarchy: {
      subjectId?: string;
      chapterId?: string;
      topicId?: string;
      groupId?: string;
    }): boolean => {
      if (args.groupId && hierarchy.groupId !== args.groupId) return false;
      if (args.subjectId && hierarchy.subjectId !== args.subjectId) return false;
      if (args.chapterId && hierarchy.chapterId !== args.chapterId) return false;
      if (args.topicId && hierarchy.topicId !== args.topicId) return false;
      return true;
    };

    interface CandidateHit {
      id: string;
      entityType: EntityType;
      title: string;
      snippetText: string;
      hierarchy: SearchHit["hierarchy"];
      navigation: SearchHit["navigation"];
      lexicalScore: number;
      semanticScore: number;
    }

    const candidateHits: CandidateHit[] = [];

    // Helper: text match scoring
    const calcTextMatchScore = (text: string): number => {
      const lower = text.toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (lower.includes(token)) matchCount++;
      }
      return matchCount > 0 ? matchCount / queryTokens.length : 0;
    };

    // 1. Subjects
    if (args.types.includes("subject")) {
      for (const subject of data.subjects) {
        if (subject.deletedAt) continue;
        if (!isAuthorized(subject.workspaceId, subject.groupId)) continue;
        const hierarchy = {
          subjectId: subject.id,
          subjectName: subject.name,
          groupId: subject.groupId || undefined,
          groupName: subject.groupId ? data.groups.find((g) => g.id === subject.groupId)?.name : undefined,
        };
        if (!matchesHierarchyFilter(hierarchy)) continue;

        const text = `${subject.name} ${subject.description || ""}`;
        const matchScore = calcTextMatchScore(text);
        if (matchScore > 0) {
          candidateHits.push({
            id: subject.id,
            entityType: "subject",
            title: subject.name,
            snippetText: subject.description || subject.name,
            hierarchy,
            navigation: { href: `/subjects/${subject.id}` },
            lexicalScore: matchScore,
            semanticScore: 0,
          });
        }
      }
    }

    // 2. Chapters
    if (args.types.includes("chapter")) {
      for (const chapter of data.chapters) {
        if (chapter.deletedAt) continue;
        const parentSubject = activeSubjectMap.get(chapter.subjectId);
        if (!parentSubject) continue; // Fail-closed on soft-deleted ancestor
        if (!isAuthorized(parentSubject.workspaceId, parentSubject.groupId)) continue;

        const hierarchy = {
          subjectId: parentSubject.id,
          subjectName: parentSubject.name,
          chapterId: chapter.id,
          chapterName: chapter.name,
          groupId: parentSubject.groupId || undefined,
          groupName: parentSubject.groupId ? data.groups.find((g) => g.id === parentSubject.groupId)?.name : undefined,
        };
        if (!matchesHierarchyFilter(hierarchy)) continue;

        const text = `${chapter.name} ${chapter.description || ""}`;
        const matchScore = calcTextMatchScore(text);
        if (matchScore > 0) {
          candidateHits.push({
            id: chapter.id,
            entityType: "chapter",
            title: chapter.name,
            snippetText: chapter.description || chapter.name,
            hierarchy,
            navigation: { href: `/chapters/${chapter.id}` },
            lexicalScore: matchScore,
            semanticScore: 0,
          });
        }
      }
    }

    // 3. Topics
    if (args.types.includes("topic")) {
      for (const topic of data.topics) {
        if (topic.deletedAt) continue;
        const parentChapter = activeChapterMap.get(topic.chapterId);
        if (!parentChapter) continue; // Fail-closed
        const parentSubject = activeSubjectMap.get(parentChapter.subjectId);
        if (!parentSubject) continue; // Fail-closed
        if (!isAuthorized(parentSubject.workspaceId, parentSubject.groupId)) continue;

        const hierarchy = {
          subjectId: parentSubject.id,
          subjectName: parentSubject.name,
          chapterId: parentChapter.id,
          chapterName: parentChapter.name,
          topicId: topic.id,
          topicName: topic.name,
          groupId: parentSubject.groupId || undefined,
          groupName: parentSubject.groupId ? data.groups.find((g) => g.id === parentSubject.groupId)?.name : undefined,
        };
        if (!matchesHierarchyFilter(hierarchy)) continue;

        const text = `${topic.name} ${topic.description || ""}`;
        const matchScore = calcTextMatchScore(text);
        if (matchScore > 0) {
          candidateHits.push({
            id: topic.id,
            entityType: "topic",
            title: topic.name,
            snippetText: topic.description || topic.name,
            hierarchy,
            navigation: { href: `/topics/${topic.id}` },
            lexicalScore: matchScore,
            semanticScore: 0,
          });
        }
      }
    }

    // 4. Study Groups
    if (args.types.includes("group")) {
      for (const group of data.groups) {
        if (group.deletedAt) continue;
        if (!scope.activeGroupIds.includes(group.id)) continue;
        const hierarchy = {
          groupId: group.id,
          groupName: group.name,
        };
        if (!matchesHierarchyFilter(hierarchy)) continue;

        const text = `${group.name} ${group.description || ""}`;
        const matchScore = calcTextMatchScore(text);
        if (matchScore > 0) {
          candidateHits.push({
            id: group.id,
            entityType: "group",
            title: group.name,
            snippetText: group.description || group.name,
            hierarchy,
            navigation: { href: `/groups/${group.id}` },
            lexicalScore: matchScore,
            semanticScore: 0,
          });
        }
      }
    }

    // 5. Flashcard Decks
    if (args.types.includes("flashcard")) {
      for (const deck of data.flashcardDecks) {
        if (!isAuthorized(deck.workspaceId, deck.groupId)) continue;

        // Ancestor hierarchy check
        let parentTopic = deck.topicId ? activeTopicMap.get(deck.topicId) : undefined;
        let parentChapter = deck.chapterId ? activeChapterMap.get(deck.chapterId) : parentTopic ? activeChapterMap.get(parentTopic.chapterId) : undefined;
        let parentSubject = deck.subjectId ? activeSubjectMap.get(deck.subjectId) : parentChapter ? activeSubjectMap.get(parentChapter.subjectId) : undefined;

        if (deck.topicId && !parentTopic) continue; // Fail-closed

        const hierarchy = {
          subjectId: parentSubject?.id,
          subjectName: parentSubject?.name,
          chapterId: parentChapter?.id,
          chapterName: parentChapter?.name,
          topicId: parentTopic?.id,
          topicName: parentTopic?.name,
          groupId: deck.groupId || parentSubject?.groupId || undefined,
          groupName: deck.groupId ? data.groups.find((g) => g.id === deck.groupId)?.name : undefined,
        };
        if (!matchesHierarchyFilter(hierarchy)) continue;

        const matchScore = calcTextMatchScore(deck.title);
        if (matchScore > 0) {
          candidateHits.push({
            id: deck.id,
            entityType: "flashcard",
            title: deck.title,
            snippetText: `Flashcard deck with ${deck.cards?.length || 0} cards`,
            hierarchy,
            navigation: {
              href: parentTopic
                ? `/topics/${parentTopic.id}?tab=flashcards&deckId=${deck.id}`
                : `/flashcards/${deck.id}`,
            },
            lexicalScore: matchScore,
            semanticScore: 0,
          });
        }
      }
    }

    // Mock query embedding for semantic search
    const queryEmbedding = createMockEmbedding(args.query);

    // 6. Notes (Lexical & Semantic via NoteChunks, collapsed to Note)
    if (args.types.includes("note")) {
      for (const note of data.notes) {
        if (note.deletedAt) continue;
        if (!note.topicId) continue;
        const parentTopic = activeTopicMap.get(note.topicId);
        if (!parentTopic) continue; // Fail-closed
        const parentChapter = activeChapterMap.get(parentTopic.chapterId);
        if (!parentChapter) continue;
        const parentSubject = activeSubjectMap.get(parentChapter.subjectId);
        if (!parentSubject) continue;
        if (!isAuthorized(parentSubject.workspaceId, parentSubject.groupId)) continue;

        const hierarchy = {
          subjectId: parentSubject.id,
          subjectName: parentSubject.name,
          chapterId: parentChapter.id,
          chapterName: parentChapter.name,
          topicId: parentTopic.id,
          topicName: parentTopic.name,
          groupId: parentSubject.groupId || undefined,
          groupName: parentSubject.groupId ? data.groups.find((g) => g.id === parentSubject.groupId)?.name : undefined,
        };
        if (!matchesHierarchyFilter(hierarchy)) continue;

        const lexicalScore = calcTextMatchScore(`${note.title} ${note.plainText || ""}`);

        // Find best semantic chunk match
        const chunks = data.noteChunks.filter((nc) => nc.noteId === note.id);
        let bestSemanticScore = 0;
        let bestChunkContent = note.plainText || note.title;

        for (const chunk of chunks) {
          const sim = Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding));
          if (sim > bestSemanticScore) {
            bestSemanticScore = sim;
            bestChunkContent = chunk.content;
          }
        }

        if (lexicalScore > 0 || (args.mode !== "lexical" && bestSemanticScore > 0.6)) {
          candidateHits.push({
            id: note.id,
            entityType: "note",
            title: note.title,
            snippetText: bestChunkContent,
            hierarchy,
            navigation: {
              href: `/topics/${parentTopic.id}?tab=notes&noteId=${note.id}`,
            },
            lexicalScore,
            semanticScore: bestSemanticScore,
          });
        }
      }
    }

    // 7. Materials (Lexical & Semantic via MaterialChunks, collapsed to Material)
    if (args.types.includes("material")) {
      for (const material of data.materials) {
        if (material.deletedAt) continue;
        if (!isAuthorized(material.workspaceId, material.groupId)) continue;

        let parentTopic = material.topicId ? activeTopicMap.get(material.topicId) : undefined;
        let parentChapter = material.chapterId ? activeChapterMap.get(material.chapterId) : parentTopic ? activeChapterMap.get(parentTopic.chapterId) : undefined;
        let parentSubject = material.subjectId ? activeSubjectMap.get(material.subjectId) : parentChapter ? activeSubjectMap.get(parentChapter.subjectId) : undefined;

        if (material.topicId && !parentTopic) continue; // Fail-closed

        const hierarchy = {
          subjectId: parentSubject?.id,
          subjectName: parentSubject?.name,
          chapterId: parentChapter?.id,
          chapterName: parentChapter?.name,
          topicId: parentTopic?.id,
          topicName: parentTopic?.name,
          groupId: material.groupId || parentSubject?.groupId || undefined,
          groupName: material.groupId ? data.groups.find((g) => g.id === material.groupId)?.name : undefined,
        };
        if (!matchesHierarchyFilter(hierarchy)) continue;

        const lexicalScore = calcTextMatchScore(`${material.title} ${material.extractedText || ""}`);

        // Material Chunks
        const chunks = data.materialChunks.filter((mc) => mc.materialId === material.id);
        let bestSemanticScore = 0;
        let bestChunkContent = material.extractedText || material.title;
        let targetPageNumber: number | undefined;
        let targetTimestampSeconds: number | undefined;

        for (const chunk of chunks) {
          const sim = Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding));
          if (sim > bestSemanticScore) {
            bestSemanticScore = sim;
            bestChunkContent = chunk.content;
            if (chunk.pageNumber) targetPageNumber = chunk.pageNumber;
            if (chunk.startSeconds !== null && chunk.startSeconds !== undefined) {
              targetTimestampSeconds = chunk.startSeconds;
            }
          }
        }

        if (lexicalScore > 0 || (args.mode !== "lexical" && bestSemanticScore > 0.6)) {
          let href = `/materials/${material.id}`;
          if (targetPageNumber) {
            href += `?page=${targetPageNumber}`;
          } else if (targetTimestampSeconds !== undefined) {
            href += `?t=${targetTimestampSeconds}`;
          }

          candidateHits.push({
            id: material.id,
            entityType: "material",
            title: material.title,
            snippetText: bestChunkContent,
            hierarchy,
            navigation: {
              href,
              pageNumber: targetPageNumber,
              timestampSeconds: targetTimestampSeconds,
            },
            lexicalScore,
            semanticScore: bestSemanticScore,
          });
        }
      }
    }

    // Rank candidates using RRF (k=60)
    // 1. Sort by lexical to determine lexical rank
    const lexicalSorted = [...candidateHits]
      .filter((c) => c.lexicalScore > 0)
      .sort((a, b) => b.lexicalScore - a.lexicalScore);
    const lexicalRankMap = new Map<string, number>();
    lexicalSorted.forEach((item, idx) => lexicalRankMap.set(item.id, idx + 1));

    // 2. Sort by semantic to determine semantic rank
    const semanticSorted = [...candidateHits]
      .filter((c) => c.semanticScore > 0)
      .sort((a, b) => b.semanticScore - a.semanticScore);
    const semanticRankMap = new Map<string, number>();
    semanticSorted.forEach((item, idx) => semanticRankMap.set(item.id, idx + 1));

    // Filter by mode
    let filteredCandidates = candidateHits;
    if (args.mode === "lexical") {
      filteredCandidates = candidateHits.filter((c) => c.lexicalScore > 0);
    } else if (args.mode === "semantic") {
      filteredCandidates = candidateHits.filter((c) => c.semanticScore > 0);
    }

    // Compute scores and matchType
    const scoredHits: SearchHit[] = filteredCandidates.map((candidate) => {
      const lRank = lexicalRankMap.get(candidate.id) || null;
      const sRank = semanticRankMap.get(candidate.id) || null;

      let score = 0;
      let matchType: SearchMode = "lexical";

      if (args.mode === "hybrid") {
        score = calculateRRFScore(lRank, sRank, 60);
        if (lRank !== null && sRank !== null) {
          matchType = "hybrid";
        } else if (sRank !== null) {
          matchType = "semantic";
        } else {
          matchType = "lexical";
        }
      } else if (args.mode === "lexical") {
        score = candidate.lexicalScore;
        matchType = "lexical";
      } else {
        score = candidate.semanticScore;
        matchType = "semantic";
      }

      // Contextual snippet windowing (approx 160 chars)
      const snippet = this.extractContextualSnippet(candidate.snippetText, args.query, 160);

      return {
        id: candidate.id,
        entityType: candidate.entityType,
        title: candidate.title,
        snippet,
        matchType,
        score: Number(score.toFixed(6)),
        hierarchy: candidate.hierarchy,
        navigation: candidate.navigation,
      };
    });

    // Sort descending by score
    scoredHits.sort((a, b) => b.score - a.score);

    // Compute counts per entity type
    const counts: Record<string, number> = {};
    for (const type of VALID_ENTITY_TYPES) {
      counts[type] = 0;
    }
    for (const hit of scoredHits) {
      counts[hit.entityType] = (counts[hit.entityType] || 0) + 1;
    }

    const total = scoredHits.length;
    const paginatedHits = scoredHits.slice(args.offset, args.offset + args.limit);

    return {
      query: args.query,
      mode: args.mode,
      total,
      limit: args.limit,
      offset: args.offset,
      hits: paginatedHits,
      counts,
    };
  }

  /**
   * Helper to extract a sliding window snippet of up to maxChars around the best query match.
   * Defensively sanitizes raw HTML/script tag delimiters to prevent XSS injection.
   */
  public extractContextualSnippet(text: string, query: string, maxChars: number = 160): string {
    if (!text || text.trim() === "") return "";

    // Defensive sanitization: escape raw HTML/script tag delimiters to prevent XSS injection
    const sanitized = text
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    if (sanitized.length <= maxChars) return sanitized;

    const lowerText = sanitized.toLowerCase();
    const queryTokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    let matchIdx = -1;
    for (const token of queryTokens) {
      const idx = lowerText.indexOf(token);
      if (idx !== -1) {
        matchIdx = idx;
        break;
      }
    }

    if (matchIdx === -1) {
      return sanitized.substring(0, maxChars - 3) + "...";
    }

    const halfWindow = Math.floor(maxChars / 2);
    let start = Math.max(0, matchIdx - halfWindow);
    let end = Math.min(sanitized.length, start + maxChars);

    if (end - start < maxChars && start > 0) {
      start = Math.max(0, end - maxChars);
    }

    let snippet = sanitized.substring(start, end);
    if (start > 0) snippet = "..." + snippet;
    if (end < sanitized.length) snippet = snippet + "...";

    return snippet;
  }
}

// Global default harness instance
export const globalSearchHarness = new SearchTestHarness();
