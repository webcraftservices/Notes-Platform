"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/lib/stores/ui-store";

export function CreateGroupDialog() {
  const open = useUIStore((s) => s.createGroupOpen);
  const setOpen = useUIStore((s) => s.setCreateGroupOpen);
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setDescription("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't create the group.");
        return;
      }
      const { group } = await res.json();
      toast.success(`${group.name} created`);
      reset();
      setOpen(false);
      router.refresh();
      router.push(`/groups/${group.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        title="New group"
        description="Groups let you share subjects, materials, and AI answers with people you invite."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Physics — Semester 3"
              autoFocus
              required
            />
          </div>
          <div>
            <Label htmlFor="group-description">Description (optional)</Label>
            <Textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this group is for"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!name.trim()}>
              Create group
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
