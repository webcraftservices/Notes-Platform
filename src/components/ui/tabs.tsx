"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn("flex items-center gap-1 border-b border-line dark:border-line-dark", className)}
    {...props}
  />
);

export const TabsTrigger = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      "relative px-3.5 py-2.5 text-sm font-medium text-ink-muted transition-colors",
      "hover:text-ink dark:text-white/50 dark:hover:text-white",
      "data-[state=active]:text-ink dark:data-[state=active]:text-white",
      "after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:rounded-full after:bg-transparent",
      "data-[state=active]:after:bg-accent",
      "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-ink-muted",
      className
    )}
    {...props}
  />
);

export const TabsContent = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn("pt-6 focus-visible:outline-none", className)} {...props} />
);
