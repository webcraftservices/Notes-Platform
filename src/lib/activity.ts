import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Stable, machine-readable activity event identifiers.
 *
 * Follows the naming convention already documented on the ActivityLog.action
 * field in prisma/schema.prisma ("material.uploaded" | "note.edited" |
 * "quiz.generated" ...): "<entity>.<past-tense event>".
 */
export const ActivityAction = {
  GROUP_CREATED: "group.created",
  MEMBER_INVITED: "member.invited",
  MEMBER_JOINED: "member.joined",
  MEMBER_LEFT: "member.left",
  MEMBER_REMOVED: "member.removed",
  MEMBER_ROLE_CHANGED: "member.role_changed",
  INVITATION_DECLINED: "invitation.declined",
  // Post-6.6-verification fixes: cancel/resend are distinct from
  // MEMBER_INVITED (creation) and INVITATION_DECLINED (recipient's own
  // choice) — an admin revoking or re-sending an invite is a different
  // actor and a different meaning, and conflating either with an
  // existing action would misattribute the event in the Activity feed.
  INVITATION_CANCELLED: "invitation.cancelled",
  INVITATION_RESENT: "invitation.resent",
  SUBJECT_CREATED: "subject.created",
  SUBJECT_UPDATED: "subject.updated",
  SUBJECT_DELETED: "subject.deleted",
  MATERIAL_ADDED: "material.added",
  MATERIAL_REMOVED: "material.removed",
} as const;

export type ActivityActionValue = (typeof ActivityAction)[keyof typeof ActivityAction];

/** Either the global db client or an active `db.$transaction` callback client. */
type DbOrTx = PrismaClient | Prisma.TransactionClient;

interface CreateActivityLogInput {
  groupId: string;
  /** The user who performed the action. */
  userId: string;
  action: ActivityActionValue;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Records one group activity event.
 *
 * Pass an active `tx` when the activity write must be atomic with the
 * business mutation it describes (e.g. removing a member + logging
 * "member.removed" should both succeed or both roll back). Falls back to
 * the shared `db` client otherwise.
 */
export function createActivityLog(client: DbOrTx, input: CreateActivityLogInput) {
  return client.activityLog.create({
    data: {
      groupId: input.groupId,
      userId: input.userId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
    },
  });
}
