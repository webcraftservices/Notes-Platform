import type { ResolvedAIScope } from "@/lib/access";

/**
 * The Prisma `where` clause that scopes retrieval to exactly the given
 * (already-authorized) ResolvedAIScope — the mechanism enforcing that
 * Subject/Chapter/Topic AI chat can never accidentally retrieve materials
 * from a sibling Subject/Chapter it wasn't scoped to (Phase 5 Task 5).
 *
 * Kept in its own file, separate from retrieval.ts, purely so it can be
 * unit tested directly: retrieval.ts imports `db` at module scope (like
 * every other DB-touching lib file), which this project's Vitest setup
 * can't construct without a real Postgres connection (see
 * document-extraction-guard.ts's identical rationale for the same split).
 * The `import type` below is erased at compile time, so importing this
 * file never pulls in access.ts's `db`-importing module body either.
 */
export function materialWhereForScope(scope: ResolvedAIScope) {
  if (scope.topicId) return { topicId: scope.topicId };
  if (scope.chapterId) return { chapterId: scope.chapterId };
  if (scope.subjectId) return { subjectId: scope.subjectId };
  // Phase 6.5: a bare group scope (ownerType "group" with no
  // subject/chapter/topic set) retrieves across every Material owned
  // directly by the group — mirrors Material.groupId, the same field
  // access.ts's assertScopeAccess already trusts for group-owned content.
  if (scope.ownerType === "group") return { groupId: scope.groupId };
  return { workspaceId: scope.workspaceId };
}
