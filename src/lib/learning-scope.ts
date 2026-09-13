/**
 * Phase 8.1 — Learning scope.
 *
 * FlashcardDeck and Quiz were given Material's exact scope shape (see the
 * schema comment above `FlashcardDeck` in prisma/schema.prisma):
 * subjectId/chapterId/topicId narrow within an owner, workspaceId/groupId
 * always identify the owner, and an unattached deck/quiz falls back to
 * the caller's personal workspace — same as an "Unorganized" Material.
 *
 * That means resolving + authorizing a learning scope from a
 * subject/chapter/topic input is *exactly* the problem
 * `lib/materials-scope.ts`'s `resolveMaterialScope` already solves (it
 * already re-derives ancestor IDs from an authorized Topic/Chapter/
 * Subject via the existing `getAccessible*` helpers in `lib/access.ts`,
 * and already prevents cross-group attachment the same way). Phase 8.1
 * intentionally does not introduce a second resolver — this module only
 * re-exports it under learning-domain names so Phase 8.2+ (flashcard/quiz
 * generation) has a stable, self-describing import instead of reaching
 * into `materials-scope.ts` directly. `resolveLearningScope` IS
 * `resolveMaterialScope` (same function reference — see
 * `lib/__tests__/learning-scope.test.ts`), not a copy that could drift.
 *
 * Deliberately out of scope for 8.1: a bare-group learning scope (no
 * subject/chapter/topic). See the FlashcardDeck schema comment for why.
 */
export {
  resolveMaterialScope as resolveLearningScope,
  ScopeNotFoundError,
  type MaterialScope as LearningScope,
} from "@/lib/materials-scope";
