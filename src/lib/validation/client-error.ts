import { z } from "zod";

/**
 * Body accepted by POST /api/client-errors (Phase 9.2, spec §C — "global
 * application errors" is one of the explicitly prioritized high-value
 * boundaries). This is a public, unauthenticated endpoint (a crash can
 * happen on the sign-in page, before any session exists), so every field
 * is capped in length: this is a report of an error message the user's
 * own browser already generated and displayed, not a channel for
 * arbitrary free-form data.
 */
export const clientErrorSchema = z.object({
  message: z.string().min(1).max(500),
  digest: z.string().max(100).optional(),
  stack: z.string().max(2000).optional(),
  /** Which app/error boundary reported this — currently only "global". */
  boundary: z.string().max(50).optional(),
});

export type ClientErrorInput = z.infer<typeof clientErrorSchema>;
