"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Cloud, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type ConnectionState = "checking" | "not_configured" | "not_enabled" | "disconnected" | "connected";

export function ConnectedAccountsPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<ConnectionState>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
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
      <div className="mt-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Cloud className="h-5 w-5 text-ink-faint" strokeWidth={1.5} />
          <div>
            <p className="text-sm font-medium text-ink dark:text-white">Google Drive</p>
            {state === "connected" ? (
              <p className="flex items-center gap-1 text-xs text-signal-success">
                <CheckCircle2 className="h-3 w-3" />
                Connected{email ? ` as ${email}` : ""}
                {connectedAt ? ` · since ${new Date(connectedAt).toLocaleDateString()}` : ""}
              </p>
            ) : state === "not_enabled" ? (
              <p className="text-xs text-ink-faint dark:text-white/30">Not available on the Free plan</p>
            ) : state === "not_configured" ? (
              <p className="text-xs text-ink-faint dark:text-white/30">Not configured on this server</p>
            ) : (
              <p className="text-xs text-ink-faint dark:text-white/30">
                Import files and Google Docs into your Materials
              </p>
            )}
          </div>
        </div>

        {state === "checking" ? (
          <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />
        ) : state === "connected" ? (
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            Disconnect
          </Button>
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
