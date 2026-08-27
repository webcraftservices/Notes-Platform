"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function EditableHeader({
  endpoint,
  name,
  description,
  titleClassName,
}: {
  endpoint: string;
  name: string;
  description: string | null;
  titleClassName?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!draftName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName, description: draftDescription || null }),
      });
      if (!res.ok) {
        toast.error("Couldn't save your changes.");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraftName(name);
    setDraftDescription(description ?? "");
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          className={titleClassName ?? "font-display text-xl font-semibold"}
          autoFocus
        />
        <Textarea
          value={draftDescription}
          onChange={(e) => setDraftDescription(e.target.value)}
          placeholder="Add a description…"
          rows={2}
        />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving || !draftName.trim()}
            className="flex items-center gap-1 rounded-sm bg-ink px-2.5 py-1.5 text-xs font-medium text-paper disabled:opacity-50 dark:bg-white dark:text-graphite-950"
          >
            <Check className="h-3.5 w-3.5" /> Save
          </button>
          <button
            onClick={cancel}
            className="flex items-center gap-1 rounded-sm border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted dark:border-line-dark dark:text-white/60"
          >
            <X className="h-3.5 w-3.5" /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group/header">
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-2 text-left"
      >
        <h1 className={titleClassName ?? "font-display text-xl font-semibold text-ink dark:text-white"}>
          {name}
        </h1>
        <Pencil className="h-3.5 w-3.5 text-ink-faint opacity-0 transition-opacity group-hover/header:opacity-100" />
      </button>
      <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
        {description || (
          <button onClick={() => setEditing(true)} className="italic text-ink-faint hover:text-ink-muted">
            Add a description…
          </button>
        )}
      </p>
    </div>
  );
}
