import Link from "next/link";
import { cn } from "@/lib/utils";

const SCOPES = [
  { value: "all", label: "All" },
  { value: "unorganized", label: "Unorganized" },
  { value: "archived", label: "Archived" },
];

export function MaterialsScopeTabs({ scope, q }: { scope: string; q: string }) {
  return (
    <div className="mb-5 flex items-center gap-1 border-b border-line dark:border-line-dark">
      {SCOPES.map((s) => {
        const params = new URLSearchParams();
        if (s.value !== "all") params.set("scope", s.value);
        if (q) params.set("q", q);
        const href = `/materials${params.toString() ? `?${params}` : ""}`;
        const active = scope === s.value;
        return (
          <Link
            key={s.value}
            href={href}
            className={cn(
              "relative px-3.5 py-2.5 text-sm font-medium transition-colors",
              active ? "text-ink dark:text-white" : "text-ink-muted hover:text-ink dark:text-white/50 dark:hover:text-white"
            )}
          >
            {s.label}
            {active && <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-accent" />}
          </Link>
        );
      })}
    </div>
  );
}
