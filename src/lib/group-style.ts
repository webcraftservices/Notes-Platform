import { SUBJECT_COLORS, SUBJECT_COLOR_KEYS } from "@/lib/subject-style";

/**
 * Groups (unlike Subjects) have no user-chosen icon/color — Phase 6.1's
 * `Group` model has only `name`/`description`. Rather than inventing a
 * second color palette, this deterministically maps a Group's `id` onto
 * the same `SUBJECT_COLORS` tokens Subject cards already use, so a given
 * group always renders in the same color (stable across reloads, since
 * it's derived from the id, not random) without adding any new design
 * tokens or a color-picker UI Phase 6.1/6.2 never asked for.
 */
export function getGroupColor(groupId: string) {
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) {
    hash = (hash * 31 + groupId.charCodeAt(i)) >>> 0;
  }
  const key = SUBJECT_COLOR_KEYS[hash % SUBJECT_COLOR_KEYS.length]!;
  return SUBJECT_COLORS[key]!;
}

/** "OWNER" -> "Owner", "ADMIN" -> "Admin" — used anywhere a MemberRole is shown as UI text. */
export function formatRoleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/** "Physics Study Group" -> "PS", "Physics" -> "PH", "" -> "?" */
export function getGroupInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
