"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";

interface NotificationData {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Notification entry point for the authenticated shell, per spec §10
 * ("bell icon in the header, unread badge, dropdown, mark as read,
 * navigate on click"). Lives in Topbar so it's on every authenticated
 * page without redesigning the shell.
 *
 * Polls `GET /api/notifications?unread=true` every 30s for the unread
 * count — no realtime infrastructure exists yet in this codebase (no
 * websockets/SSE anywhere), so polling is the smallest correct behavior
 * rather than a half-built realtime layer. The dropdown itself fetches
 * the fuller list lazily, only when opened.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationData[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function pollUnreadCount() {
      const res = await fetch("/api/notifications?unread=true").catch(() => null);
      if (!res || !res.ok || cancelled) return;
      const body = await res.json();
      setUnreadCount(body.unreadCount ?? 0);
    }
    pollUnreadCount();
    const interval = setInterval(pollUnreadCount, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && notifications === null) {
      setLoading(true);
      const res = await fetch("/api/notifications").catch(() => null);
      setLoading(false);
      if (!res || !res.ok) return;
      const body = await res.json();
      setNotifications(body.notifications);
      setUnreadCount(body.unreadCount ?? 0);
    }
  }

  async function handleClick(notification: NotificationData) {
    if (!notification.readAt) {
      setNotifications((prev) =>
        prev?.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)) ?? null,
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      await fetch(`/api/notifications/${notification.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      }).catch(() => {});
    }
    setOpen(false);
    if (notification.link) router.push(notification.link);
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors hover:text-ink dark:text-white/50 dark:hover:text-white"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-2 w-2 rounded-full bg-accent-strong" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b border-line px-3 py-2.5 dark:border-line-dark">
          <p className="font-display text-[13px] font-semibold text-ink dark:text-white">Notifications</p>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {loading && (
            <p className="px-3 py-6 text-center text-sm text-ink-faint dark:text-white/40">Loading…</p>
          )}
          {!loading && notifications?.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-ink-faint dark:text-white/40">
              You&apos;re all caught up.
            </p>
          )}
          {!loading &&
            notifications?.map((notification) => (
              <button
                key={notification.id}
                onClick={() => handleClick(notification)}
                className="flex w-full flex-col items-start gap-0.5 border-b border-line px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-paper dark:border-line-dark dark:hover:bg-graphite-800"
              >
                <div className="flex w-full items-start gap-2">
                  {!notification.readAt && (
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-strong" />
                  )}
                  <p
                    className={`min-w-0 flex-1 text-[13px] ${notification.readAt ? "text-ink-muted dark:text-white/60" : "font-medium text-ink dark:text-white"}`}
                  >
                    {notification.title}
                  </p>
                </div>
                <p className="pl-3.5 text-xs text-ink-faint dark:text-white/40">
                  {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                </p>
              </button>
            ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
