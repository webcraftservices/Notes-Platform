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
