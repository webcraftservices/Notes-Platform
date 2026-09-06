"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, AlertCircle, Search, FileText, ExternalLink, RefreshCw, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { UploadScope } from "@/lib/hooks/use-material-upload";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  iconLink?: string;
  supported: boolean;
  unsupportedReason?: string;
  materialTypeLabel?: string;
}

type ConnectionState = "checking" | "not_configured" | "not_enabled" | "disconnected" | "connected";

export function GoogleDriveBrowser({
  scope,
  onImported,
}: {
  scope: UploadScope;
  onImported?: (materialId: string) => void;
}) {
  const router = useRouter();
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setConnection("checking");
    try {
      const res = await fetch("/api/integrations/google/status");
      if (!res.ok) {
        setConnection("not_configured");
        return;
      }
      const data = await res.json();
      if (!data.enabledOnPlan) {
        setConnection("not_enabled");
        return;
      }
      if (data.connected) {
        setEmail(data.email ?? null);
        setConnection("connected");
      } else {
        setConnection("disconnected");
      }
    } catch {
      setConnection("not_configured");
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const loadFiles = useCallback(async (q: string) => {
    setLoadingFiles(true);
    setFilesError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/integrations/google/files?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFilesError(data?.error ?? "Unable to load Google Drive.");
        setFiles(null);
        return;
      }
      setFiles(data.files ?? []);
    } catch {
      setFilesError("Unable to load Google Drive.");
      setFiles(null);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (connection === "connected") loadFiles("");
  }, [connection, loadFiles]);

  async function handleImport(file: DriveFile, force = false) {
    setImportingId(file.id);
    try {
      const res = await fetch("/api/integrations/google/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
          modifiedTime: file.modifiedTime,
          force,
          ...scope,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Import failed.");
        return;
      }
      if (data.duplicate && !data.changed) {
        toast.success("Already imported — no changes since last import.");
      } else if (data.duplicate && data.changed && !force) {
        // Automatically re-import: the user already asked to import this
        // file, and Google reports it changed since we last pulled it —
        // treating that as "update it" is the simplest safe behavior
        // (spec §18), rather than silently doing nothing or requiring a
        // second click.
        await handleImport(file, true);
        return;
      } else {
        toast.success(force ? "Re-imported — processing…" : "Importing — processing…");
      }
      router.refresh();
      onImported?.(data.material.id);
    } finally {
      setImportingId(null);
    }
  }

  if (connection === "checking") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
      </div>
    );
  }

  if (connection === "not_configured") {
    return (
      <p className="py-8 text-center text-sm text-ink-muted dark:text-white/50">
        Google Drive integration isn&apos;t configured on this server yet. See{" "}
        <code className="rounded bg-paper px-1 py-0.5 text-xs dark:bg-graphite-800">docs/google-setup.md</code>.
      </p>
    );
  }

  if (connection === "not_enabled") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Cloud className="h-6 w-6 text-ink-faint" strokeWidth={1.5} />
        <p className="max-w-xs text-sm text-ink-muted dark:text-white/50">
          Google Drive import isn&apos;t available on the Free plan. Upgrade in Settings to connect it.
        </p>
      </div>
    );
  }

  if (connection === "disconnected") {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Cloud className="h-6 w-6 text-ink-faint" strokeWidth={1.5} />
        <p className="max-w-xs text-sm text-ink-muted dark:text-white/50">
          Connect Google Drive to browse and import your files and Google Docs.
        </p>
        <Button onClick={() => window.location.assign("/api/integrations/google/connect")}>
          Connect Google Drive
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadFiles(query);
            }}
            placeholder="Search your Drive…"
            className="pl-9"
          />
        </div>
        <Button variant="secondary" onClick={() => loadFiles(query)} disabled={loadingFiles}>
          <RefreshCw className={`h-4 w-4 ${loadingFiles ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {email && <p className="text-xs text-ink-faint dark:text-white/30">Connected as {email}</p>}

      {loadingFiles && !files ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
        </div>
      ) : filesError ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <AlertCircle className="h-5 w-5 text-signal-danger" />
          <p className="text-sm text-ink-muted dark:text-white/50">{filesError}</p>
        </div>
      ) : files && files.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-faint dark:text-white/30">No files found.</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {files?.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-3 rounded-sm px-2 py-2 hover:bg-paper dark:hover:bg-graphite-800"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <FileText className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink dark:text-white">{file.name}</p>
                  <p className="truncate text-xs text-ink-faint dark:text-white/30">
                    {file.materialTypeLabel ?? "Unsupported"} · {new Date(file.modifiedTime).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {file.webViewLink && (
                  <a
                    href={file.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-faint hover:text-ink dark:hover:text-white"
                    title="Open in Google Drive"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {file.supported ? (
                  <Button
                    variant="secondary"
                    className="px-3 py-1.5 text-xs"
                    loading={importingId === file.id}
                    onClick={() => handleImport(file)}
                  >
                    Import
                  </Button>
                ) : (
                  <span title={file.unsupportedReason}>
                    <Badge variant="muted">Unsupported</Badge>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
