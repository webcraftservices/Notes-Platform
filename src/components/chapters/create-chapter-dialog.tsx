"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function CreateChapterDialog({ subjectId }: { subjectId: string }) {
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
      const res = await fetch(`/api/subjects/${subjectId}/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't create the chapter.");
        return;
      }
      toast.success("Chapter created");
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
          New Chapter
        </Button>
      </DialogTrigger>
      <DialogContent title="New chapter" description="Chapters hold topics inside this subject.">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="chapter-name">Name</Label>
            <Input
              id="chapter-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Thermodynamics"
              autoFocus
              required
            />
          </div>
          <div>
            <Label htmlFor="chapter-description">Description (optional)</Label>
            <Textarea
              id="chapter-description"
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
              Create chapter
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
