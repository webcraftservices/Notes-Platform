import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  children,
}: {
  className?: string;
  variant?: "default" | "accent" | "success" | "muted";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide",
        variant === "default" && "bg-paper text-ink-muted dark:bg-graphite-800 dark:text-white/60",
        variant === "accent" && "bg-accent-soft text-accent-strong",
        variant === "success" && "bg-signal-success/10 text-signal-success",
        variant === "muted" && "bg-transparent text-ink-faint dark:text-white/30",
        className
      )}
    >
      {children}
    </span>
  );
}
