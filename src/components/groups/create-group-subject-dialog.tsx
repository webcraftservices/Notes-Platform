"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
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

/**
 * Group-scoped counterpart to CreateSubjectDialog (Phase 6.4). Kept as its
 * own self-contained dialog (own open state, own trigger button) rather
 * than teaching the personal-workspace CreateSubjectDialog/ui-store about
 * an optional groupId — that dialog is a global singleton wired to a
 * command-palette-style "New Subject" action with no notion of "which
 * group tab is currently open," so bolting group context onto it would
 * mean plumbing groupId through global UI state instead of local props.
 * Only rendered for ADMIN/OWNER (server also enforces this in
 * POST /api/subjects — see assertSubjectManageAccess's caller there).
 */
export function CreateGroupSubjectDialog({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
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
        body: JSON.stringify({
          name,
          description: description || undefined,
          icon,
          color,
          groupId,
        }),
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
      <DialogTrigger asChild>
        <Button variant="secondary" className="gap-1.5">
          <Plus className="h-4 w-4" /> New subject
        </Button>
      </DialogTrigger>
      <DialogContent
        title="New group subject"
        description="Visible to every member of this group; only admins can create, rename, or delete it."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="group-subject-name">Name</Label>
            <Input
              id="group-subject-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Physics"
              autoFocus
              required
            />
          </div>
          <div>
            <Label htmlFor="group-subject-description">Description (optional)</Label>
            <Textarea
              id="group-subject-description"
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
