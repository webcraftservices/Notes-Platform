"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import Image from "next/image";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

export function UserMenu({
  userName,
  userEmail,
  userImage,
  planLabel,
}: {
  userName: string | null;
  userEmail: string;
  userImage: string | null;
  planLabel: string;
}) {
  const initial = (userName ?? userEmail)[0]?.toUpperCase() ?? "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-paper-raised/60 dark:hover:bg-graphite-800/60">
        {userImage ? (
          <Image src={userImage} alt="" width={26} height={26} className="rounded-full" />
        ) : (
          <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-graphite-700 text-[11px] font-medium text-white">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink dark:text-white">
            {userName ?? userEmail}
          </p>
          <Badge variant="muted" className="mt-0.5 !px-0 !py-0 normal-case tracking-normal">
            {planLabel} plan
          </Badge>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/sign-in" })} destructive>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="truncate px-2.5 py-1.5 text-xs text-ink-faint dark:text-white/30">{userEmail}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
