import { ExternalLink } from "lucide-react";
import type { Material } from "@prisma/client";

/**
 * GOOGLE_DOC materials have no storageKey (their content lives in
 * Material.extractedText, not object storage — see that field's schema
 * comment), so the normal readUrl-fetching path in MaterialPreview doesn't
 * apply. Rendered directly from the material row the page already loaded.
 */
export function GoogleDocViewer({ material }: { material: Material }) {
  const ref = material.externalRef as { webViewLink?: string } | null;

  if (material.status === "PROCESSING" || material.status === "UPLOADING") {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-ink-muted dark:text-white/50">Importing this Google Doc…</p>
      </div>
    );
  }

  if (material.status === "FAILED") {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-ink dark:text-white">Couldn&apos;t import this Google Doc.</p>
        <p className="mt-1 text-sm text-ink-muted dark:text-white/50">Try re-importing it from Google Drive.</p>
      </div>
    );
  }

  return (
    <div className="card max-h-[75vh] overflow-auto p-6">
      {ref?.webViewLink && (
        <a
          href={ref.webViewLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
        >
          Open in Google Docs
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink dark:text-white/90">
        {material.extractedText || "This document has no text content."}
      </div>
    </div>
  );
}
