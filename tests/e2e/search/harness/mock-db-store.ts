/**
 * In-memory state store and Prisma Client mock for Phase 12 E2E Search tests.
 * Provides high-fidelity mock implementations for @/lib/db and @/lib/access.
 */

import {
  getFreshFixtureData,
  FixtureDataSet,
  FixtureUser,
  FixtureWorkspace,
  FixtureWorkspaceMember,
  FixtureGroup,
  FixtureGroupMember,
  FixtureSubject,
  FixtureChapter,
  FixtureTopic,
  FixtureNote,
  FixtureNoteBlock,
  FixtureNoteChunk,
  FixtureMaterial,
  FixtureMaterialChunk,
  FixtureFlashcardDeck,
  FixtureFlashcard,
  FixtureQuiz,
  FixtureQuizQuestion,
} from "./fixtures";
import { UserSearchScope } from "./contracts";

type WhereClause = Record<string, any>;

/**
 * Evaluates whether a target object matches a Prisma-style WHERE clause.
 */
function matchesWhere(item: Record<string, any>, where?: WhereClause): boolean {
  if (!where || Object.keys(where).length === 0) return true;

  for (const [key, expected] of Object.entries(where)) {
    if (key === "AND") {
      if (Array.isArray(expected)) {
        if (!expected.every((clause) => matchesWhere(item, clause))) return false;
      }
      continue;
    }

    if (key === "OR") {
      if (Array.isArray(expected)) {
        if (!expected.some((clause) => matchesWhere(item, clause))) return false;
      }
      continue;
    }

    if (key === "NOT") {
      if (Array.isArray(expected)) {
        if (expected.some((clause) => matchesWhere(item, clause))) return false;
      } else if (typeof expected === "object" && expected !== null) {
        if (matchesWhere(item, expected)) return false;
      }
      continue;
    }

    // Composite primary / unique key handling (e.g., workspaceId_userId: { workspaceId, userId })
    if (key.includes("_") && typeof expected === "object" && expected !== null) {
      let compositeMatch = true;
      for (const [subKey, subVal] of Object.entries(expected)) {
        if (item[subKey] !== subVal) {
          compositeMatch = false;
          break;
        }
      }
      if (compositeMatch) continue;
      // If it doesn't match as composite, don't fail yet if item doesn't have the compound property name
    }

    const actual = item[key];

    if (expected === null) {
      if (actual !== null && actual !== undefined) return false;
      continue;
    }

    if (typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      // Prisma filter operators: in, notIn, contains, mode, not, equals, gt, gte, lt, lte
      let handledOperator = false;

      if ("in" in expected && Array.isArray(expected.in)) {
        handledOperator = true;
        if (!expected.in.includes(actual)) return false;
      }

      if ("notIn" in expected && Array.isArray(expected.notIn)) {
        handledOperator = true;
        if (expected.notIn.includes(actual)) return false;
      }

      if ("equals" in expected) {
        handledOperator = true;
        if (actual !== expected.equals) return false;
      }

      if ("not" in expected) {
        handledOperator = true;
        if (actual === expected.not) return false;
      }

      if ("contains" in expected && typeof actual === "string") {
        handledOperator = true;
        const needle = String(expected.contains);
        const haystack = expected.mode === "insensitive" ? actual.toLowerCase() : actual;
        const target = expected.mode === "insensitive" ? needle.toLowerCase() : needle;
        if (!haystack.includes(target)) return false;
      }

      if ("gt" in expected && typeof actual === "number") {
        handledOperator = true;
        if (!(actual > expected.gt)) return false;
      }

      if ("gte" in expected && typeof actual === "number") {
        handledOperator = true;
        if (!(actual >= expected.gte)) return false;
      }

      if ("lt" in expected && typeof actual === "number") {
        handledOperator = true;
        if (!(actual < expected.lt)) return false;
      }

      if ("lte" in expected && typeof actual === "number") {
        handledOperator = true;
        if (!(actual <= expected.lte)) return false;
      }

      if (handledOperator) continue;

      // Nested relation filter (e.g. group: { deletedAt: null })
      if (typeof actual === "object" && actual !== null) {
        if (!matchesWhere(actual, expected)) return false;
        continue;
      }
    }

    if (actual !== expected) {
      return false;
    }
  }

  return true;
}

/**
 * Creates a generic in-memory model repository with standard Prisma CRUD methods.
 */
function createMockRepository<T extends { id?: string }>(getItems: () => T[], setItems: (items: T[]) => void) {
  return {
    async findUnique(args: { where: WhereClause; include?: Record<string, boolean>; select?: Record<string, boolean> }): Promise<T | null> {
      const items = getItems();
      const match = items.find((item) => matchesWhere(item, args.where)) ?? null;
      return match ? JSON.parse(JSON.stringify(match)) : null;
    },

    async findFirst(args?: {
      where?: WhereClause;
      include?: Record<string, boolean>;
      select?: Record<string, boolean>;
      orderBy?: Record<string, "asc" | "desc">;
    }): Promise<T | null> {
      const items = getItems();
      const filtered = args?.where ? items.filter((item) => matchesWhere(item, args.where)) : items;
      if (filtered.length === 0) return null;
      return JSON.parse(JSON.stringify(filtered[0]));
    },

    async findMany(args?: {
      where?: WhereClause;
      include?: Record<string, boolean>;
      select?: Record<string, boolean>;
      orderBy?: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
      skip?: number;
      take?: number;
    }): Promise<T[]> {
      let items = getItems();
      if (args?.where) {
        items = items.filter((item) => matchesWhere(item, args.where));
      }
      if (args?.skip) {
        items = items.slice(args.skip);
      }
      if (args?.take !== undefined) {
        items = items.slice(0, args.take);
      }
      return JSON.parse(JSON.stringify(items));
    },

    async count(args?: { where?: WhereClause }): Promise<number> {
      const items = getItems();
      if (!args?.where) return items.length;
      return items.filter((item) => matchesWhere(item, args.where)).length;
    },

    async create(args: { data: any; include?: Record<string, boolean>; select?: Record<string, boolean> }): Promise<T> {
      const items = getItems();
      const newItem: T = {
        id: args.data.id || `mock-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data,
      };
      items.push(newItem);
      setItems(items);
      return JSON.parse(JSON.stringify(newItem));
    },

    async createMany(args: { data: any[] }): Promise<{ count: number }> {
      const items = getItems();
      let count = 0;
      for (const d of args.data) {
        items.push({
          id: d.id || `mock-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...d,
        });
        count++;
      }
      setItems(items);
      return { count };
    },

    async update(args: { where: WhereClause; data: any; include?: Record<string, boolean>; select?: Record<string, boolean> }): Promise<T> {
      const items = getItems();
      const idx = items.findIndex((item) => matchesWhere(item, args.where));
      const existing = items[idx];
      if (idx === -1 || !existing) {
        throw new Error(`Record to update not found for where: ${JSON.stringify(args.where)}`);
      }
      const updated = {
        ...existing,
        ...args.data,
        updatedAt: new Date(),
      };
      items[idx] = updated;
      setItems(items);
      return JSON.parse(JSON.stringify(updated));
    },

    async updateMany(args: { where?: WhereClause; data: any }): Promise<{ count: number }> {
      const items = getItems();
      let count = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && (!args.where || matchesWhere(item, args.where))) {
          items[i] = {
            ...item,
            ...args.data,
            updatedAt: new Date(),
          };
          count++;
        }
      }
      setItems(items);
      return { count };
    },

    async delete(args: { where: WhereClause }): Promise<T> {
      const items = getItems();
      const idx = items.findIndex((item) => matchesWhere(item, args.where));
      if (idx === -1) {
        throw new Error(`Record to delete not found for where: ${JSON.stringify(args.where)}`);
      }
      const [deleted] = items.splice(idx, 1);
      setItems(items);
      return JSON.parse(JSON.stringify(deleted));
    },

    async deleteMany(args?: { where?: WhereClause }): Promise<{ count: number }> {
      const items = getItems();
      if (!args?.where) {
        const count = items.length;
        setItems([]);
        return { count };
      }
      const remaining: T[] = [];
      let count = 0;
      for (const item of items) {
        if (item && matchesWhere(item, args.where)) {
          count++;
        } else if (item) {
          remaining.push(item);
        }
      }
      setItems(remaining);
      return { count };
    },

    async upsert(args: { where: WhereClause; update: any; create: any }): Promise<T> {
      const items = getItems();
      const idx = items.findIndex((item) => matchesWhere(item, args.where));
      const existing = items[idx];
      if (idx !== -1 && existing) {
        const updated = { ...existing, ...args.update, updatedAt: new Date() };
        items[idx] = updated;
        setItems(items);
        return JSON.parse(JSON.stringify(updated));
      } else {
        const newItem: T = {
          id: args.create.id || `mock-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args.create,
        };
        items.push(newItem);
        setItems(items);
        return JSON.parse(JSON.stringify(newItem));
      }
    },
  };
}

/**
 * State store managing all in-memory mock data collections.
 */
export class MockDbStore {
  private data: FixtureDataSet;
  private currentUser: { id: string; email: string; name: string } | null = null;

  constructor() {
    this.data = getFreshFixtureData();
  }

  public reset(): void {
    this.data = getFreshFixtureData();
    this.currentUser = {
      id: "user-alice",
      email: "alice@example.com",
      name: "Alice Smith",
    };
  }

  public seed(custom?: Partial<FixtureDataSet>): void {
    const fresh = getFreshFixtureData();
    this.data = {
      ...fresh,
      ...(custom || {}),
    };
  }

  public getData(): FixtureDataSet {
    return this.data;
  }

  public setCurrentUser(user: { id: string; email?: string; name?: string } | null): void {
    if (!user) {
      this.currentUser = null;
    } else {
      this.currentUser = {
        id: user.id,
        email: user.email || `${user.id}@example.com`,
        name: user.name || user.id,
      };
    }
  }

  public getCurrentUser(): { id: string; email: string; name: string } | null {
    return this.currentUser;
  }

  /**
   * Resolves the user search scope in memory matching src/lib/search/search-access.ts
   */
  public resolveUserSearchScope(userId: string): UserSearchScope {
    const userWorkspaces = this.data.workspaceMembers.filter(
      (wm) => wm.userId === userId && wm.role === "OWNER"
    );
    const personalWorkspaceId = userWorkspaces[0]?.workspaceId || `ws-${userId}`;

    const activeGroupMemberships = this.data.groupMembers.filter((gm) => {
      if (gm.userId !== userId) return false;
      const group = this.data.groups.find((g) => g.id === gm.groupId);
      return group && !group.deletedAt;
    });

    const activeGroupIds = activeGroupMemberships.map((gm) => gm.groupId);

    return {
      userId,
      personalWorkspaceId,
      activeGroupIds,
    };
  }

  /**
   * Builds the mock Prisma client object matching @/lib/db
   */
  public createPrismaClientMock() {
    const userRepo = createMockRepository<FixtureUser>(
      () => this.data.users,
      (items) => (this.data.users = items)
    );

    const workspaceRepo = createMockRepository<FixtureWorkspace>(
      () => this.data.workspaces,
      (items) => (this.data.workspaces = items)
    );

    const workspaceMemberRepo = createMockRepository<FixtureWorkspaceMember>(
      () => this.data.workspaceMembers,
      (items) => (this.data.workspaceMembers = items)
    );

    const groupRepo = createMockRepository<FixtureGroup>(
      () => this.data.groups,
      (items) => (this.data.groups = items)
    );

    const groupMemberRepo = createMockRepository<FixtureGroupMember>(
      () => this.data.groupMembers,
      (items) => (this.data.groupMembers = items)
    );

    const subjectRepo = createMockRepository<FixtureSubject>(
      () => this.data.subjects,
      (items) => (this.data.subjects = items)
    );

    const chapterRepo = createMockRepository<FixtureChapter>(
      () => this.data.chapters,
      (items) => (this.data.chapters = items)
    );

    const topicRepo = createMockRepository<FixtureTopic>(
      () => this.data.topics,
      (items) => (this.data.topics = items)
    );

    const noteRepo = createMockRepository<FixtureNote>(
      () => this.data.notes,
      (items) => (this.data.notes = items)
    );

    const noteBlockRepo = createMockRepository<FixtureNoteBlock>(
      () => this.data.noteBlocks,
      (items) => (this.data.noteBlocks = items)
    );

    const noteChunkRepo = createMockRepository<FixtureNoteChunk>(
      () => this.data.noteChunks,
      (items) => (this.data.noteChunks = items)
    );

    const materialRepo = createMockRepository<FixtureMaterial>(
      () => this.data.materials,
      (items) => (this.data.materials = items)
    );

    const materialChunkRepo = createMockRepository<FixtureMaterialChunk>(
      () => this.data.materialChunks,
      (items) => (this.data.materialChunks = items)
    );

    const flashcardDeckRepo = createMockRepository<FixtureFlashcardDeck>(
      () => this.data.flashcardDecks,
      (items) => (this.data.flashcardDecks = items)
    );

    const flashcardRepo = createMockRepository<FixtureFlashcard>(
      () => this.data.flashcards,
      (items) => (this.data.flashcards = items)
    );

    const quizRepo = createMockRepository<FixtureQuiz>(
      () => this.data.quizzes,
      (items) => (this.data.quizzes = items)
    );

    const quizQuestionRepo = createMockRepository<FixtureQuizQuestion>(
      () => this.data.quizQuestions,
      (items) => (this.data.quizQuestions = items)
    );

    const client: any = {
      user: userRepo,
      workspace: workspaceRepo,
      workspaceMember: workspaceMemberRepo,
      group: groupRepo,
      studyGroup: groupRepo, // Aliased for compatibility
      groupMember: groupMemberRepo,
      studyGroupMember: groupMemberRepo, // Aliased for compatibility
      subject: subjectRepo,
      chapter: chapterRepo,
      topic: topicRepo,
      note: noteRepo,
      noteBlock: noteBlockRepo,
      noteChunk: noteChunkRepo,
      material: materialRepo,
      materialChunk: materialChunkRepo,
      flashcardDeck: flashcardDeckRepo,
      flashcard: flashcardRepo,
      quiz: quizRepo,
      quizQuestion: quizQuestionRepo,

      $queryRaw: async (_query: any, ..._values: any[]) => [],
      $queryRawUnsafe: async (_query: string, ..._values: any[]) => [],
      $executeRaw: async (_query: any, ..._values: any[]) => 0,
      $executeRawUnsafe: async (_query: string, ..._values: any[]) => 0,

      $transaction: async (arg: any) => {
        if (typeof arg === "function") {
          return await arg(client);
        }
        if (Array.isArray(arg)) {
          return await Promise.all(arg);
        }
        return arg;
      },
    };

    return client;
  }

  /**
   * Builds the mock access control object matching @/lib/access
   */
  public createAccessMock() {
    return {
      getSessionUser: async () => this.currentUser,
      requireUser: async () => {
        if (!this.currentUser) {
          throw new Error("Not authorized: no session user");
        }
        return this.currentUser;
      },
      getPrimaryWorkspace: async (userId: string) => {
        const member = this.data.workspaceMembers.find((wm) => wm.userId === userId);
        if (!member) {
          throw new Error(`User ${userId} has no workspace`);
        }
        const ws = this.data.workspaces.find((w) => w.id === member.workspaceId);
        return ws ?? null;
      },
      userIsWorkspaceMember: async (workspaceId: string, userId: string) => {
        return this.data.workspaceMembers.some(
          (wm) => wm.workspaceId === workspaceId && wm.userId === userId
        );
      },
      userIsGroupMember: async (groupId: string, userId: string) => {
        const member = this.data.groupMembers.find(
          (gm) => gm.groupId === groupId && gm.userId === userId
        );
        if (!member) return false;
        const group = this.data.groups.find((g) => g.id === groupId);
        return group ? !group.deletedAt : false;
      },
    };
  }
}

// Global default instance for easy import across test files
export const globalMockStore = new MockDbStore();
