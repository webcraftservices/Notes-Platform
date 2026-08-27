"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
] as const;

const STATUS_STYLES: Record<string, string> = {
  NOT_STARTED: "bg-paper text-ink-muted dark:bg-graphite-800 dark:text-white/50",
  IN_PROGRESS: "bg-signal-info/10 text-signal-info",
  COMPLETED: "bg-signal-success/10 text-signal-success",
};

export function ChapterStatusSelect({
  chapterId,
  status,
}: {
  chapterId: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
}) {
  const [value, setValue] = useState(status);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function handleChange(newStatus: string) {
    const previous = value;
    setValue(newStatus as typeof value);
    const res = await fetch(`/api/chapters/${chapterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      setValue(previous);
      toast.error("Couldn't update status.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <select
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      disabled={isPending}
      className={cn(
        "cursor-pointer rounded-sm border-0 py-1 pl-2.5 pr-7 font-mono text-[11px] font-medium uppercase tracking-wide outline-none",
        STATUS_STYLES[value]
      )}
    >
      {STATUS_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
