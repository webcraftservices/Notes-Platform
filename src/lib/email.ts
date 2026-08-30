/**
 * Email normalization for Group invitations (Phase 6.2).
 *
 * The existing auth system (see `api/auth/register/route.ts`) stores
 * `User.email` exactly as submitted — only Zod's `.email()` format check
 * runs, no case-folding — and `User.email` is a plain case-sensitive
 * `@unique` Postgres column. There is no existing canonical email
 * representation to inherit from elsewhere in the codebase.
 *
 * For invitations specifically, treating `Test@Example.com` and
 * `test@example.com` as different people would be a real, user-visible
 * bug ("I invited them, why can't they accept?"), so this file defines
 * one canonical form — trim + lowercase — and every invitation code path
 * (duplicate-invite detection, already-a-member detection, accept,
 * decline) must funnel through it.
 *
 * `GroupInvitation.email` is stored already-normalized (see
 * `createInvitationSchema`'s `.transform`), so exact-string comparisons
 * against it are safe. `User.email` is stored as-typed, so comparisons
 * against `User.email` must use a case-insensitive query
 * (`{ equals: normalizeEmail(x), mode: "insensitive" }`) rather than
 * assuming the stored value is already normalized — see
 * `findUserByNormalizedEmail` in `lib/access.ts`.
 *
 * Kept in its own file with no imports from `lib/db`/`lib/access`, same
 * pure/DB-free pattern as `lib/group-role.ts` and `lib/mime.ts`, so it
 * stays unit-testable in isolation.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
