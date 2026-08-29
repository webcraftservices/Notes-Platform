/**
 * Enforces Phase 6.1 Decision 1: a Subject belongs to exactly one scope —
 * a personal Workspace OR a shared Group, never both, never neither.
 *
 * Subject.workspaceId and Subject.groupId are both nullable at the DB
 * level (see the Phase 6.1 migration
 * `20260828054500_subject_scope_nullable_workspace`) because Postgres/
 * Prisma have no first-class "exactly one of these two columns" column
 * constraint, so this invariant is enforced here in application code —
 * mirroring how `lib/materials-scope.ts` enforces Material's own
 * scope-consistency rule, and how `lib/chunking.ts`/`lib/mime.ts`/
 * `lib/http-range.ts` keep single-purpose validation logic in a small,
 * dependency-free file of its own.
 *
 * This file intentionally imports nothing (not `lib/db`, not
 * `lib/access`) so it stays unit-testable in isolation, independent of
 * whether a Prisma client has been generated.
 *
 * Callers (Subject create/update routes, from Phase 6.4 onward) must call
 * `assertSubjectScopeInvariant` with the *resolved* final state of the
 * row (existing values merged with the incoming patch), not a raw partial
 * PATCH body — a PATCH that only sends `{ name: "..." }` says nothing
 * about scope and must not be treated as "neither set."
 */

export class SubjectScopeInvariantError extends Error {
  constructor() {
    super(
      "A Subject must belong to exactly one scope: a workspace or a group — not both, and not neither."
    );
    this.name = "SubjectScopeInvariantError";
  }
}

export interface SubjectScopeCandidate {
  workspaceId?: string | null;
  groupId?: string | null;
}

/**
 * Throws SubjectScopeInvariantError unless exactly one of
 * workspaceId/groupId is a non-empty string. Empty string is treated the
 * same as null/undefined (not a valid id), so a caller can't satisfy the
 * invariant by passing `""` instead of omitting the field.
 */
export function assertSubjectScopeInvariant(scope: SubjectScopeCandidate): void {
  const hasWorkspace = !!scope.workspaceId;
  const hasGroup = !!scope.groupId;
  if (hasWorkspace === hasGroup) {
    throw new SubjectScopeInvariantError();
  }
}

/** A Subject's owner, expressed so the invalid "both" or "neither" state is unrepresentable. */
export type SubjectOwnerFields =
  | { ownerType: "workspace"; workspaceId: string; groupId: null }
  | { ownerType: "group"; workspaceId: null; groupId: string };

/**
 * Turns a Subject's own workspaceId/groupId into a discriminated-union
 * owner descriptor. Added for `lib/access.ts`'s `ResolvedAIScope`
 * (Phase 6.1's `Subject.workspaceId` nullability fix) so any
 * Subject-derived scope resolver can build a correctly-typed owner field
 * by spreading this rather than assuming `workspaceId` is always a
 * string — but it's a general-purpose Subject→owner mapping, not
 * AI-specific, so it lives here next to the invariant it relies on rather
 * than in access.ts.
 *
 * Calls `assertSubjectScopeInvariant` first (defense in depth — nothing
 * should ever construct a Subject that violates it, but a resolver should
 * never silently trust that). No `!`/`as` casts: the two `if` branches
 * below narrow `workspaceId`/`groupId` via ordinary truthiness checks, so
 * TypeScript verifies the return type on its own.
 */
export function resolveSubjectOwner(subject: SubjectScopeCandidate): SubjectOwnerFields {
  assertSubjectScopeInvariant(subject);
  if (subject.groupId) {
    return { ownerType: "group", workspaceId: null, groupId: subject.groupId };
  }
  if (subject.workspaceId) {
    return { ownerType: "workspace", workspaceId: subject.workspaceId, groupId: null };
  }
  // Unreachable: assertSubjectScopeInvariant already guarantees one of the
  // two branches above was taken. This throw only exists so the function
  // has a return type TypeScript can fully verify without a cast.
  throw new SubjectScopeInvariantError();
}
