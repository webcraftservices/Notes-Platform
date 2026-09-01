import { ActivityAction, type ActivityActionValue } from "@/lib/activity";
import { formatRoleLabel } from "@/lib/group-style";

/** The minimal shape the formatter needs — matches an ActivityLog row plus its actor's display name. */
export interface ActivityLogEntry {
  action: string;
  actorName: string;
  targetType?: string | null;
  metadata?: unknown;
}

function metadataString(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Turns a group ActivityLog row into a human-readable sentence for the
 * Activity panel, e.g. "Nishant created the group" or
 * "Priya changed Rahul's role to Member".
 *
 * Kept as a pure function (no db access) so it's covered by a plain unit
 * test rather than needing a seeded database, per the project's existing
 * testing convention for display-formatting helpers (see group-style.ts).
 */
export function formatActivityMessage(entry: ActivityLogEntry): string {
  const actor = entry.actorName;
  const target = metadataString(entry.metadata, "targetName") ?? metadataString(entry.metadata, "name");

  switch (entry.action as ActivityActionValue) {
    case ActivityAction.GROUP_CREATED:
      return `${actor} created the group`;
    case ActivityAction.MEMBER_INVITED: {
      const email = metadataString(entry.metadata, "email");
      return email ? `${actor} invited ${email}` : `${actor} sent an invitation`;
    }
    case ActivityAction.MEMBER_JOINED:
      return `${actor} joined the group`;
    case ActivityAction.MEMBER_LEFT:
      return `${actor} left the group`;
    case ActivityAction.MEMBER_REMOVED: {
      const removedName = metadataString(entry.metadata, "targetName");
      return removedName ? `${actor} removed ${removedName} from the group` : `${actor} removed a member`;
    }
    case ActivityAction.MEMBER_ROLE_CHANGED: {
      const memberName = metadataString(entry.metadata, "targetName");
      const newRole = metadataString(entry.metadata, "newRole");
      if (memberName && newRole) {
        return `${actor} changed ${memberName}'s role to ${formatRoleLabel(newRole)}`;
      }
      return `${actor} changed a member's role`;
    }
    case ActivityAction.INVITATION_DECLINED: {
      const email = metadataString(entry.metadata, "email");
      return email ? `${email} declined the invitation` : `${actor} declined an invitation`;
    }
    case ActivityAction.SUBJECT_CREATED:
      return target ? `${actor} created "${target}"` : `${actor} created a subject`;
    case ActivityAction.SUBJECT_UPDATED:
      return target ? `${actor} updated "${target}"` : `${actor} updated a subject`;
    case ActivityAction.SUBJECT_DELETED:
      return target ? `${actor} deleted "${target}"` : `${actor} deleted a subject`;
    case ActivityAction.MATERIAL_ADDED:
      return target ? `${actor} added "${target}"` : `${actor} added a material`;
    case ActivityAction.MATERIAL_REMOVED:
      return target ? `${actor} removed "${target}"` : `${actor} removed a material`;
    default:
      return `${actor} performed an action`;
  }
}
