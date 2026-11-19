import React from "react";
import { splitSnippetForHighlight } from "@/lib/search/snippet-extractor";

export interface HighlightedSnippetProps {
  snippet: string;
  query: string;
  className?: string;
}

/**
 * Renders a contextual snippet with XSS-safe query term highlighting.
 * Never uses dangerouslySetInnerHTML; splits plain text into React text nodes and <mark> spans.
 */
export function HighlightedSnippet({ snippet, query, className }: HighlightedSnippetProps) {
  if (!snippet) return null;

  const segments = splitSnippetForHighlight(snippet, query);

  return (
    <p className={className ?? "text-xs text-ink-muted dark:text-white/60"}>
      {segments.map((seg, idx) =>
        seg.highlighted ? (
          <mark
            key={idx}
            className="rounded-xs bg-accent-soft px-0.5 font-medium text-accent dark:bg-accent/20 dark:text-accent"
          >
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={idx}>{seg.text}</React.Fragment>
        )
      )}
    </p>
  );
}
