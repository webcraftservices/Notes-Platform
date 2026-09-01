"use client";

import { Search, Menu } from "lucide-react";
import { useCommandPalette } from "@/components/shell/command-palette";
import { useUIStore } from "@/lib/stores/ui-store";
import { NotificationBell } from "@/components/notifications/notification-bell";

export function Topbar({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  const { setOpen } = useCommandPalette();
  const setMobileNavOpen = useUIStore((s) => s.setMobileNavOpen);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4 dark:border-line-dark sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => setMobileNavOpen(true)}
          className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-muted lg:hidden dark:text-white/50"
          aria-label="Open navigation"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>
        <div className="min-w-0">{children}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {actions}
        <NotificationBell />
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-sm border border-line px-2.5 py-1.5 text-xs text-ink-faint transition-colors hover:border-ink-faint hover:text-ink-muted dark:border-line-dark dark:hover:text-white/70"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search or jump to…</span>
          <kbd className="ml-1 hidden rounded-sm bg-paper px-1.5 py-0.5 font-mono text-[10px] sm:inline dark:bg-graphite-800">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}
