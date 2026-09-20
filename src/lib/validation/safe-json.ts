import { z } from "zod";

/**
 * Phase 9.3 security audit finding (category H/I): closes a real,
 * evidence-confirmed stored-XSS path, not a speculative one.
 *
 * `@tiptap/core` <3.30.4 (we run 2.27.2 — a major-version upgrade to fix
 * it directly is out of this phase's scope; see docs/security-hardening.md)
 * has a known vulnerability (GHSA-cp6q-959q-f8rh): its `mergeAttributes()`
 * turns an own `__proto__` key on a node/mark's `attrs` into an inherited,
 * *executable* DOM attribute when the document is rendered. `NoteBlock`
 * content is exactly that: arbitrary Tiptap/ProseMirror JSON, previously
 * accepted with zero shape restriction (`z.record(z.any())`), then
 * rendered through Tiptap's React editor for every viewer of a note —
 * including, for a Group-shared note, every OTHER group member. Without
 * this guard, any user who can write a note block could plant a
 * `__proto__` key in a node's `attrs` that executes when a different user
 * simply opens that note.
 *
 * The fix is applied at our own trust boundary (reject the dangerous key
 * before it's ever stored) rather than patching or upgrading Tiptap
 * itself — this is deliberate: it's a small, targeted, fully-understood
 * change instead of a risky major-version bump across the whole editor.
 *
 * Reused for `submitQuizAttemptSchema`'s `answers` record too (lower
 * severity there — values are constrained to string/boolean, so there's
 * no DOM-attribute-injection path — but it's the same shape of risk at
 * negligible extra cost, so it gets the same guard for consistency).
 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function containsDangerousKey(value: unknown, seen: Set<unknown> = new Set()): boolean {
  if (value === null || typeof value !== "object") return false;
  // Own-property enumeration only (Object.keys never walks the prototype
  // chain and never triggers the `__proto__` accessor — this is a safe
  // read, not the unsafe assignment/merge this guard exists to prevent
  // happening *later*, elsewhere).
  if (seen.has(value)) return false; // defends this check itself against pathological repeated/circular structures
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => containsDangerousKey(item, seen));
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (containsDangerousKey((value as Record<string, unknown>)[key], seen)) return true;
  }
  return false;
}

/** Wraps a zod schema for arbitrary nested JSON with the check above. */
export function rejectPrototypePollution<T extends z.ZodTypeAny>(schema: T): T {
  return schema.superRefine((value, ctx) => {
    if (containsDangerousKey(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Contains a disallowed key (__proto__, constructor, or prototype).",
      });
    }
  }) as unknown as T;
}
