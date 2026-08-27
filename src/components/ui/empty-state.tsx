import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-16 text-center dark:border-line-dark">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-paper dark:bg-graphite-800">
        <Icon className="h-5 w-5 text-ink-faint" strokeWidth={1.75} />
      </div>
      <h3 className="font-display text-base font-semibold text-ink dark:text-white">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-ink-muted dark:text-white/50">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
