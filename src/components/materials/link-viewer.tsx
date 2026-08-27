import { ExternalLink } from "lucide-react";

export function LinkViewer({ url }: { url: string }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
      <ExternalLink className="mb-3 h-6 w-6 text-ink-faint" strokeWidth={1.5} />
      <p className="max-w-md truncate text-sm text-ink-muted dark:text-white/50">{url}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 rounded-sm bg-ink px-4 py-2.5 text-sm font-medium text-paper dark:bg-white dark:text-graphite-950"
      >
        Open link
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
