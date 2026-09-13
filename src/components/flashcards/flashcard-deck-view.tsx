import Link from "next/link";
import { materialSourceHref, materialSourceAriaLabel } from "@/lib/material-link";
import { Badge } from "@/components/ui/badge";

interface DeckCard {
  id: string;
  front: string;
  back: string;
  sources: { materialId: string; label: string; timestampSeconds?: number; page?: number }[] | null;
}

/**
 * Phase 8.2's intentionally basic deck display (task §10): title, card
 * count, a simple front/back list, and source provenance links reusing
 * the exact same `materialSourceHref`/`Badge` treatment AIChatPanel
 * already uses for citations — no new provenance-rendering pattern.
 * Deliberately NOT a study/flip experience yet: no flip animation, no
 * keyboard controls, no progress/answer tracking. That's a later
 * subphase (task §10's explicit exclusion list).
 */
export function FlashcardDeckView({ title, cards }: { title: string; cards: DeckCard[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-ink dark:text-white">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
          {cards.length} card{cards.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="space-y-4">
        {cards.map((card, i) => (
          <div
            key={card.id}
            className="rounded-sm border border-line bg-paper-raised p-4 dark:border-line-dark dark:bg-graphite-800"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint dark:text-white/40">
              Card {i + 1}
            </p>
            <p className="mt-2 text-sm font-medium text-ink dark:text-white">{card.front}</p>
            <p className="mt-2 text-sm text-ink-muted dark:text-white/60">{card.back}</p>
            {card.sources && card.sources.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/60 pt-3 dark:border-line-dark/60">
                {card.sources.map((source, j) => (
                  <Link
                    key={j}
                    href={materialSourceHref(source)}
                    aria-label={materialSourceAriaLabel(source)}
                    className="rounded-sm transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong dark:hover:bg-graphite-800"
                  >
                    <Badge variant="muted" className="cursor-pointer">
                      {source.label}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
