import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      {trail.map((crumb, i) => {
        const isLast = i === trail.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-ink-faint" />}
            {crumb.href && !isLast ? (
              <Link href={crumb.href} className="text-ink-muted hover:text-ink dark:text-white/50 dark:hover:text-white">
                {crumb.label}
              </Link>
            ) : (
              <span className={isLast ? "font-medium text-ink dark:text-white" : "text-ink-muted dark:text-white/50"}>
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
