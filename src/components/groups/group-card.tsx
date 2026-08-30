import Link from "next/link";
import { getGroupColor, getGroupInitials, formatRoleLabel } from "@/lib/group-style";
import { Badge } from "@/components/ui/badge";
import type { MemberRole } from "@prisma/client";

export interface GroupCardData {
  id: string;
  name: string;
  description: string | null;
  role: MemberRole;
  memberCount: number;
}

export function GroupCard({ group }: { group: GroupCardData }) {
  const palette = getGroupColor(group.id);
  const initials = getGroupInitials(group.name);

  return (
    <Link href={`/groups/${group.id}`} className="card group block p-5 transition-shadow hover:shadow-panel">
      <div className="flex items-start justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded ${palette.bg}`}>
          <span className={`text-xs font-semibold ${palette.text}`}>{initials}</span>
        </div>
        <Badge
          variant={group.role === "OWNER" ? "accent" : "default"}
          className="normal-case tracking-normal"
        >
          {formatRoleLabel(group.role)}
        </Badge>
      </div>
      <h3 className="mt-3 truncate font-display text-[15px] font-semibold text-ink dark:text-white">
        {group.name}
      </h3>
      {group.description && (
        <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted dark:text-white/50">
          {group.description}
        </p>
      )}
      <p className="mt-3 text-xs text-ink-faint dark:text-white/30">
        {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
      </p>
    </Link>
  );
}
