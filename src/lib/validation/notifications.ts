import { z } from "zod";

/**
 * PATCH /api/notifications/[notificationId] body. The only mutable field is
 * read state — recipient, type and content are set once at creation time
 * (see lib/notifications.ts) and are never client-editable, per the Phase
 * 6.6 spec's "never trust a client-supplied userId" / "don't allow changing
 * recipient/type/content" rules.
 */
export const updateNotificationSchema = z.object({
  read: z.boolean(),
});

export type UpdateNotificationInput = z.infer<typeof updateNotificationSchema>;
