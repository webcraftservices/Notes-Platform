"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SUBJECT_ICONS,
  SUBJECT_ICON_KEYS,
  SUBJECT_COLORS,
  SUBJECT_COLOR_KEYS,
} from "@/lib/subject-style";
import { useUIStore } from "@/lib/stores/ui-store";

export function CreateSubjectDialog() {
  const open = useUIStore((s) => s.createSubjectOpen);
  const setOpen = useUIStore((s) => s.setCreateSubjectOpen);
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(SUBJECT_ICON_KEYS[0]);
  const [color, setColor] = useState(SUBJECT_COLOR_KEYS[0]);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setDescription("");
    setIcon(SUBJECT_ICON_KEYS[0]);
    setColor(SUBJECT_COLOR_KEYS[0]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined, icon, color }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't create the subject.");
        return;
      }
      const { subject } = await res.json();
      toast.success(`${subject.name} created`);
      reset();
      setOpen(false);
      router.refresh();
      router.push(`/subjects/${subject.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="New subject" description="Subjects hold your chapters, topics, and materials.">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="subject-name">Name</Label>
            <Input
              id="subject-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Physics"
              autoFocus
              required
            />
          </div>
          <div>
            <Label htmlFor="subject-description">Description (optional)</Label>
            <Textarea
              id="subject-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this subject covers"
            />
          </div>
          <div>
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-1.5">
              {SUBJECT_ICON_KEYS.map((key) => {
                const Icon = SUBJECT_ICONS[key] ?? SUBJECT_ICONS[SUBJECT_ICON_KEYS[0]!]!;
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setIcon(key)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-sm border transition-colors",
                      icon === key
                        ? "border-accent bg-accent-soft text-accent-strong"
                        : "border-line text-ink-muted hover:border-ink-faint dark:border-line-dark dark:text-white/50"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {SUBJECT_COLOR_KEYS.map((key) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setColor(key)}
                  aria-label={key}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform",
                    SUBJECT_COLORS[key]?.bg,
                    color === key ? "scale-110 border-ink dark:border-white" : "border-transparent"
                  )}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!name.trim()}>
              Create subject
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
