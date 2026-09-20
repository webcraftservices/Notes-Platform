"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // Best-effort, fire-and-forget: before Phase 9.2 this error was only
    // ever visible in the user's own browser console — nothing durable
    // saw it. A failure to report must never affect this error page
    // itself, so this is deliberately not awaited and has no visible
    // effect on `reset`/rendering either way.
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        digest: error.digest,
        stack: error.stack,
        boundary: "global",
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <AlertTriangle className="mb-4 h-8 w-8 text-signal-danger" strokeWidth={1.5} />
      <h1 className="font-display text-xl font-semibold text-ink dark:text-white">Something went wrong</h1>
      <p className="mt-1.5 max-w-sm text-sm text-ink-muted dark:text-white/50">
        This has been logged. Try again, and if it keeps happening, refresh the page.
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
