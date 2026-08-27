"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserMenu } from "@/components/shell/user-menu";
import { NAV_ITEMS } from "@/components/shell/nav-items";

export function Sidebar({
  userName,
  userEmail,
  userImage,
  workspaceName,
  planLabel,
}: {
  userName: string | null;
  userEmail: string;
  userImage: string | null;
  workspaceName: string;
  planLabel: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-paper dark:border-line-dark dark:bg-graphite-950 lg:flex">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-[12px] font-display font-semibold text-paper dark:bg-white dark:text-graphite-950">
          K
        </div>
        <span className="truncate font-display text-sm font-semibold text-ink dark:text-white">
          {workspaceName}
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                active
                  ? "bg-paper-raised text-ink shadow-subtle dark:bg-graphite-800 dark:text-white"
                  : "text-ink-muted hover:bg-paper-raised/60 hover:text-ink dark:text-white/50 dark:hover:bg-graphite-800/60 dark:hover:text-white"
              )}
            >
              <item.icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-3 py-3 dark:border-line-dark">
        <Link
          href="/settings"
          className="mb-1 flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13.5px] font-medium text-ink-muted transition-colors hover:bg-paper-raised/60 hover:text-ink dark:text-white/50 dark:hover:bg-graphite-800/60 dark:hover:text-white"
        >
          <Settings className="h-[17px] w-[17px]" strokeWidth={1.75} />
          Settings
        </Link>
        <UserMenu userName={userName} userEmail={userEmail} userImage={userImage} planLabel={planLabel} />
      </div>
    </aside>
  );
}
