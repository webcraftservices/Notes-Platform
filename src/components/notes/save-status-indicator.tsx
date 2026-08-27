import { Check, Loader2, AlertCircle } from "lucide-react";

export function SaveStatusIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-faint dark:text-white/30">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-faint dark:text-white/30">
        <Check className="h-3 w-3" /> Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-signal-danger">
        <AlertCircle className="h-3 w-3" /> Couldn&apos;t save
      </span>
    );
  }
  return null;
}
