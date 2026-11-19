"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toSafeHttpUrl } from "@/lib/safe-url";

interface GoogleExternalRef {
  provider: "google_drive";
  fileId: string;
  webViewLink: string | null;
  modifiedTime: string | null;
  mimeType: string;
  remoteDeleted?: boolean;
  lastSyncedAt?: string;
}

export function GoogleSourceCard({
  materialTitle,
  externalRef,
  scope,
}: {
  materialId: string;
  materialTitle: string;
  externalRef: GoogleExternalRef;
  scope: { subjectId?: string; chapterId?: string; topicId?: string };
}) {
  const router = useRouter();
  const [reimporting, setReimporting] = useState(false);
  const safeWebViewLink = toSafeHttpUrl(externalRef.webViewLink);

  const sourceLabel =
    externalRef.mimeType === "application/vnd.google-apps.document"
      ? "Google Docs"
      : externalRef.mimeType === "application/vnd.google-apps.presentation"
        ? "Google Slides"
        : "Google Drive";

  async function handleReimport() {
    setReimporting(true);
    try {
      const res = await fetch("/api/integrations/google/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: externalRef.fileId,
          name: materialTitle,
          mimeType: externalRef.mimeType,
          webViewLink: externalRef.webViewLink ?? undefined,
          modifiedTime: externalRef.modifiedTime ?? undefined,
          force: true,
          ...scope,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't re-import from Google Drive.");
        return;
      }
      toast.success("Re-importing — processing…");
      router.refresh();
    } finally {
      setReimporting(false);
    }
  }

  return (
    <div className="card p-4">
      <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-white/30">
        Source
      </h3>
      <p className="mb-2 text-sm text-ink-muted dark:text-white/50">
        Imported from {sourceLabel}
      </p>
      {externalRef.lastSyncedAt && (
        <p className="mb-3 text-xs text-ink-faint dark:text-white/35">
          Last synced {new Date(externalRef.lastSyncedAt).toLocaleString()}
        </p>
      )}
      {externalRef.remoteDeleted && (
        <div className="mb-3 flex items-start gap-2 rounded-sm border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The original file was removed or moved to Trash in Google Drive. Your imported Zenote copy remains intact.
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {safeWebViewLink && (
          <a
            href={safeWebViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-paper-raised px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper dark:border-line-dark dark:bg-graphite-800 dark:text-white"
          >
            Open original
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <Button variant="secondary" className="px-3 py-1.5 text-xs" loading={reimporting} onClick={handleReimport}>
          <RefreshCw className="h-3 w-3" />
          Re-import
        </Button>
      </div>
    </div>
  );
}
