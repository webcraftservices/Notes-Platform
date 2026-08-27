"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/stores/ui-store";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import { UserMenu } from "@/components/shell/user-menu";

/**
 * The mobile equivalent of the desktop Sidebar (spec §94 — "Mobile: Bottom
 * navigation or drawer"). Same nav items, same active-state logic, just a
 * slide-in panel instead of a persistent column, since a 240px fixed
 * sidebar doesn't fit a phone viewport.
 */
export function MobileNavDrawer({
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
  const open = useUIStore((s) => s.mobileNavOpen);
  const setOpen = useUIStore((s) => s.setMobileNavOpen);
  const pathname = usePathname();

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/20 backdrop-blur-[2px] dark:bg-black/50 lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-paper dark:bg-graphite-950 lg:hidden">
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <div className="flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-ink text-[12px] font-display font-semibold text-paper dark:bg-white dark:text-graphite-950">
                K
              </div>
              <span className="truncate font-display text-sm font-semibold text-ink dark:text-white">
                {workspaceName}
              </span>
            </div>
            <Dialog.Close className="text-ink-faint">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <nav className="flex-1 space-y-0.5 px-3 py-2">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-sm px-2.5 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-paper-raised text-ink shadow-subtle dark:bg-graphite-800 dark:text-white"
                      : "text-ink-muted hover:bg-paper-raised/60 dark:text-white/50"
                  )}
                >
                  <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-line px-3 py-3 dark:border-line-dark">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="mb-1 flex items-center gap-2.5 rounded-sm px-2.5 py-2.5 text-sm font-medium text-ink-muted dark:text-white/50"
            >
              <Settings className="h-[18px] w-[18px]" strokeWidth={1.75} />
              Settings
            </Link>
            <UserMenu userName={userName} userEmail={userEmail} userImage={userImage} planLabel={planLabel} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
