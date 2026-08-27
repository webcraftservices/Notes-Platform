"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus } from "lucide-react";
import { toast } from "sonner";

export function TagEditor({ materialId, tags }: { materialId: string; tags: string[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveTags(next: string[]) {
    setSaving(true);
    try {
      const res = await fetch(`/api/materials/${materialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
      if (!res.ok) {
        toast.error("Couldn't update tags.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function addTag(e: React.FormEvent) {
    e.preventDefault();
    const value = draft.trim().replace(/^#/, "");
    if (!value || tags.includes(value)) {
      setDraft("");
      return;
    }
    setDraft("");
    saveTags([...tags, value]);
  }

  function removeTag(tag: string) {
    saveTags(tags.filter((t) => t !== tag));
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {tags.length === 0 && <p className="text-sm text-ink-faint dark:text-white/30">No tags yet</p>}
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-sm bg-paper px-2 py-1 font-mono text-[11px] text-ink-muted dark:bg-graphite-800 dark:text-white/60"
          >
            #{tag}
            <button onClick={() => removeTag(tag)} disabled={saving} className="hover:text-signal-danger">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={addTag} className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a tag…"
          className="w-full rounded-sm border border-line bg-paper-raised px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint dark:border-line-dark dark:bg-graphite-800 dark:text-white"
        />
        <button
          type="submit"
          disabled={!draft.trim() || saving}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-line text-ink-muted disabled:opacity-40 dark:border-line-dark dark:text-white/50"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
