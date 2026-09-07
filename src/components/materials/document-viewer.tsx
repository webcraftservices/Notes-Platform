"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function DocumentViewer({
  materialId,
  src,
  title,
}: {
  materialId: string;
  src: string;
  title: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function renderDocument() {
      setHtml(null);
      setError(null);

      try {
        const response = await fetch(src, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("The Word document could not be loaded.");

        const buffer = await response.arrayBuffer();
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });

        if (!controller.signal.aborted) setHtml(result.value);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "The Word document could not be rendered.");
        }
      }
    }

    void renderDocument();
    return () => controller.abort();
  }, [src]);

  async function handleDownload() {
    const response = await fetch(`/api/materials/${materialId}`);
    if (!response.ok) {
      toast.error("Couldn't load this file.");
      return;
    }
    const data = await response.json();
    if (!data.readUrl) {
      toast.error("This file isn't ready yet.");
      return;
    }
    window.open(`${data.readUrl}${data.readUrl.includes("?") ? "&" : "?"}download=1`, "_blank");
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3 dark:border-line-dark">
        <p className="truncate pr-4 text-sm font-medium text-ink dark:text-white">{title}</p>
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>

      {html === null && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
          <p className="mt-3 text-sm text-ink-muted dark:text-white/50">Loading document…</p>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <AlertCircle className="h-5 w-5 text-signal-danger" />
          <p className="mt-3 text-sm text-ink dark:text-white">Couldn&apos;t render this document.</p>
          <p className="mt-1 text-sm text-ink-muted dark:text-white/50">{error}</p>
        </div>
      )}

      {html !== null && (
        <div
          className="max-h-[75vh] overflow-auto bg-paper p-6 text-sm leading-7 text-ink dark:bg-graphite-950 dark:text-white/90
            [&_a]:text-signal-info [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line
            [&_blockquote]:pl-4 [&_h1]:mb-4 [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-semibold
            [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold
            [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold
            [&_li]:ml-6 [&_ol]:my-3 [&_ol]:list-decimal [&_p]:my-3 [&_table]:my-5 [&_table]:w-full
            [&_td]:border [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-line
            [&_th]:bg-paper-raised [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_ul]:my-3 [&_ul]:list-disc
            dark:[&_blockquote]:border-line-dark dark:[&_th]:border-line-dark dark:[&_th]:bg-graphite-900
            dark:[&_td]:border-line-dark"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
