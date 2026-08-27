import Link from "next/link";

export function ProgressRow({
  id,
  name,
  completed,
  total,
  percent,
}: {
  id: string;
  name: string;
  completed: number;
  total: number;
  percent: number;
}) {
  return (
    <Link href={`/subjects/${id}`} className="block">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium text-ink dark:text-white">{name}</span>
        <span className="text-xs text-ink-faint dark:text-white/30">
          {completed}/{total} chapters
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line dark:bg-line-dark">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
      </div>
    </Link>
  );
}
