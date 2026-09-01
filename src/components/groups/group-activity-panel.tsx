"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatActivityMessage } from "@/lib/activity-style";

export interface GroupActivityEntry {
  id: string;
  action: string;
  metadata: unknown;
  createdAt: string;
  actor: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
}

/**
 * Replaces the Phase 6.3 `PhasePlaceholder` on the group Activity tab.
 * Receives the first page from the server component (same convention as
 * GroupMembersPanel/GroupMaterialsPanel) and paginates further pages
 * itself via `GET /api/groups/[groupId]/activity?cursor=...`.
 */
export function GroupActivityPanel({
  groupId,
  initialActivity,
  initialNextCursor,
}: {
  groupId: string;
  initialActivity: GroupActivityEntry[];
  initialNextCursor: string | null;
}) {
  const [activity, setActivity] = useState(initialActivity);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/activity?cursor=${nextCursor}`);
      if (!res.ok) return;
      const body = await res.json();
      setActivity((prev) => [...prev, ...body.activity]);
      setNextCursor(body.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (activity.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Invitations, membership changes, and shared subjects/materials will show up here as the group uses them."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-line rounded-lg border border-line dark:divide-line-dark dark:border-line-dark">
        {activity.map((entry) => (
          <div key={entry.id} className="flex items-start gap-3 p-4">
            <Avatar
              name={entry.actor.name}
              email={entry.actor.email}
              image={entry.actor.image}
              size={28}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm text-ink dark:text-white">
                {formatActivityMessage({
                  action: entry.action,
                  actorName: entry.actor.name ?? entry.actor.email,
                  metadata: entry.metadata,
                })}
              </p>
              <p className="mt-0.5 text-xs text-ink-faint dark:text-white/40">
                {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
              </p>
            </div>
          </div>
        ))}
      </div>

      {nextCursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
