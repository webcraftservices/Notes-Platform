"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  align = "end",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-[180px] overflow-hidden rounded-sm border border-line bg-paper-raised p-1 shadow-panel",
          "dark:border-line-dark dark:bg-graphite-800",
          "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-ink outline-none transition-colors",
        "hover:bg-paper focus:bg-paper dark:text-white/80 dark:hover:bg-graphite-700 dark:focus:bg-graphite-700",
        destructive && "text-signal-danger hover:bg-signal-danger/10 focus:bg-signal-danger/10 dark:text-signal-danger",
        className
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) => (
  <DropdownMenuPrimitive.Separator className={cn("my-1 h-px bg-line dark:bg-line-dark", className)} {...props} />
);
