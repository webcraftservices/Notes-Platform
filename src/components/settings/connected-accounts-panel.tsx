"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Cloud, CheckCircle2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type ConnectionState = "checking" | "not_configured" | "not_enabled" | "disconnected" | "connected";

export function ConnectedAccountsPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ConnectionState>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadStatus = useCallback(async () => {
    setState("checking");
    try {
      const res = await fetch("/api/integrations/google/status");
      if (!res.ok) {
        setState("not_configured");
        return;
      }
      const data = await res.json();
      if (!data.enabledOnPlan) {
        setState("not_enabled");
        return;
      }
      if (data.connected) {
        setEmail(data.email ?? null);
        setConnectedAt(data.connectedAt ?? null);
        setLastSyncedAt(data.lastSyncedAt ?? null);
        setSyncStatus(data.syncStatus ?? "IDLE");
        setLastSyncError(data.lastSyncError ?? null);
        setState("connected");
      } else {
        setState("disconnected");
      }
    } catch {
      setState("not_configured");
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // The OAuth callback redirects back to /settings?google=connected|error —
  // surface the outcome once, then clean the URL.
  useEffect(() => {
    const result = searchParams.get("google");
    if (!result) return;
    if (result === "connected") {
      toast.success("Google Drive connected");
      loadStatus();
    } else if (result === "error") {
      toast.error(searchParams.get("message") ?? "Google Drive connection failed.");
    }
    router.replace("/settings");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSyncNow() {
    setSyncingNow(true);
    try {
      const res = await fetch("/api/integrations/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registerWatch: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Couldn't synchronize with Google Drive.");
        loadStatus();
        return;
      }
      const updatedCount =
        (data?.summary?.materialsUpdated ?? 0) + (data?.summary?.notesSynced ?? 0);
      toast.success(
        updatedCount > 0
          ? `Google Drive synced (${updatedCount} item${updatedCount === 1 ? "" : "s"} updated)`
          : "Google Drive is up to date"
      );
      loadStatus();
    } finally {
      setSyncingNow(false);
    }
  }

  async function handleDisconnect() {
    const res = await fetch("/api/integrations/google/disconnect", { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't disconnect Google Drive.");
      return;
    }
    toast.success("Google Drive disconnected. Previously imported files are unaffected.");
    loadStatus();
  }

  return (
    <section className="card p-5">
      <h2 className="font-display text-sm font-semibold text-ink dark:text-white">Connected accounts</h2>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Cloud className="mt-0.5 h-5 w-5 text-ink-faint" strokeWidth={1.5} />
          <div>
            <p className="text-sm font-medium text-ink dark:text-white">Google Drive, Docs &amp; Slides</p>
            {state === "connected" ? (
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-xs text-signal-success">
                  <CheckCircle2 className="h-3 w-3" />
                  Connected{email ? ` as ${email}` : ""}
                  {connectedAt ? ` · since ${new Date(connectedAt).toLocaleDateString()}` : ""}
                </p>
                {lastSyncedAt && (
                  <p className="text-[11px] text-ink-faint dark:text-white/40">
                    Last incremental sync: {new Date(lastSyncedAt).toLocaleString()}
                  </p>
                )}
                {(syncStatus === "RECONNECT_REQUIRED" || lastSyncError) && (
                  <p className="flex items-center gap-1 text-xs text-signal-danger">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {lastSyncError ?? "Reconnect Google Drive to resume synchronization."}
                  </p>
                )}
              </div>
            ) : state === "not_enabled" ? (
              <p className="text-xs text-ink-faint dark:text-white/30">Not available on the Free plan</p>
            ) : state === "not_configured" ? (
              <p className="text-xs text-ink-faint dark:text-white/30">Not configured on this server</p>
            ) : (
              <p className="text-xs text-ink-faint dark:text-white/30">
                Import &amp; continuously sync Drive files, Google Docs, and Google Slides
              </p>
            )}
          </div>
        </div>

        {state === "checking" ? (
          <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />
        ) : state === "connected" ? (
          <div className="flex items-center gap-2">
            {syncStatus === "RECONNECT_REQUIRED" ? (
              <Button
                variant="secondary"
                onClick={() => window.location.assign("/api/integrations/google/connect")}
              >
                Reconnect
              </Button>
            ) : (
              <Button variant="secondary" loading={syncingNow} onClick={handleSyncNow}>
                <RefreshCw className="h-3.5 w-3.5" />
                Sync now
              </Button>
            )}
            <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
              Disconnect
            </Button>
          </div>
        ) : state === "disconnected" ? (
          <Button variant="secondary" onClick={() => window.location.assign("/api/integrations/google/connect")}>
            Connect
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Disconnect Google Drive?"
        description="Materials already imported from Google Drive stay exactly as they are — only the connection itself is removed. You can reconnect any time."
        confirmLabel="Disconnect"
        onConfirm={handleDisconnect}
      />
    </section>
  );
}
