"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function CreateTopicDialog({ chapterId }: { chapterId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/chapters/${chapterId}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't create the topic.");
        return;
      }
      toast.success("Topic created");
      setName("");
      setDescription("");
      setOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Plus className="h-4 w-4" />
          New Topic
        </Button>
      </DialogTrigger>
      <DialogContent title="New topic" description="Topics hold notes, materials, and study tools.">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="topic-name">Name</Label>
            <Input
              id="topic-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Zeroth Law"
              autoFocus
              required
            />
          </div>
          <div>
            <Label htmlFor="topic-description">Description (optional)</Label>
            <Textarea
              id="topic-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!name.trim()}>
              Create topic
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
