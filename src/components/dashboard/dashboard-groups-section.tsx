import React from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { GroupCard, type GroupCardData } from "@/components/groups/group-card";
import { NewGroupButton } from "@/components/groups/new-group-button";

export function DashboardGroupsSection({ groups }: { groups: GroupCardData[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink dark:text-white">
          <Users className="h-4 w-4 text-ink-faint" />
          Groups
        </h2>
        {groups.length > 0 && (
          <Link
            href="/groups"
            className="text-xs font-medium text-ink-muted hover:text-ink dark:text-white/50 dark:hover:text-white"
          >
            View all
          </Link>
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No groups yet"
          description="Collaborative groups for sharing subjects and materials with others."
          action={<NewGroupButton />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}

