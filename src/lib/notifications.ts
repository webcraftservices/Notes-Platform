import type { NotificationType, Prisma, PrismaClient } from "@prisma/client";

/** Either the global db client or an active `db.$transaction` callback client. */
type DbOrTx = PrismaClient | Prisma.TransactionClient;

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** In-app link the notification navigates to when clicked, e.g. "/groups/abc". */
  link?: string;
}

/** Records one personal notification for a single recipient. */
export function createNotification(client: DbOrTx, input: CreateNotificationInput) {
  return client.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });
}

/**
 * Creates the same notification for several recipients at once (e.g. every
 * OWNER/ADMIN of a group). Skips silently if `userIds` is empty.
 */
export function createNotifications(
  client: DbOrTx,
  userIds: string[],
  input: Omit<CreateNotificationInput, "userId">,
) {
  if (userIds.length === 0) return Promise.resolve({ count: 0 });
  return client.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
    })),
  });
}

/**
 * Returns the userIds of a group's OWNER/ADMIN members, optionally excluding
 * the user who triggered the event (so actors don't get notified about their
 * own action). Used for "someone joined/left/declined" notifications, which
 * are administrative rather than personal.
 */
export async function getGroupAdminUserIds(
  client: DbOrTx,
  groupId: string,
  excludeUserId?: string,
): Promise<string[]> {
  const admins = await client.groupMember.findMany({
    where: {
      groupId,
      role: { in: ["OWNER", "ADMIN"] },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: { userId: true },
  });
  return admins.map((member) => member.userId);
}
