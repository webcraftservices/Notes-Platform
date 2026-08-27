"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Option {
  id: string;
  name: string;
}

export function MoveMaterialDialog({
  materialId,
  open,
  onOpenChange,
}: {
  materialId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [chapters, setChapters] = useState<Option[]>([]);
  const [topics, setTopics] = useState<Option[]>([]);
  const [subjectId, setSubjectId] = useState<string>("");
  const [chapterId, setChapterId] = useState<string>("");
  const [topicId, setTopicId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/subjects")
      .then((r) => r.json())
      .then((d) => setSubjects(d.subjects ?? []));
  }, [open]);

  useEffect(() => {
    setChapterId("");
    setTopicId("");
    setChapters([]);
    if (!subjectId) return;
    fetch(`/api/subjects/${subjectId}/chapters`)
      .then((r) => r.json())
      .then((d) => setChapters(d.chapters ?? []));
  }, [subjectId]);

  useEffect(() => {
    setTopicId("");
    setTopics([]);
    if (!chapterId) return;
    fetch(`/api/chapters/${chapterId}/topics`)
      .then((r) => r.json())
      .then((d) => setTopics(d.topics ?? []));
  }, [chapterId]);

  async function handleMove(target: "unorganized" | "selection") {
    setSaving(true);
    try {
      const body =
        target === "unorganized"
          ? { subjectId: null, chapterId: null, topicId: null }
          : {
              subjectId: subjectId || null,
              chapterId: chapterId || null,
              topicId: topicId || null,
            };
      const res = await fetch(`/api/materials/${materialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error("Couldn't move this material.");
        return;
      }
      toast.success("Material moved");
      onOpenChange(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Move material" description="Attach this to a subject, chapter, or topic — or leave it unorganized.">
        <div className="space-y-4">
          <div>
            <Label htmlFor="move-subject">Subject</Label>
            <select
              id="move-subject"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full rounded-sm border border-line bg-paper-raised px-3 py-2.5 text-sm text-ink dark:border-line-dark dark:bg-graphite-800 dark:text-white"
            >
              <option value="">Select a subject…</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {subjectId && (
            <div>
              <Label htmlFor="move-chapter">Chapter (optional)</Label>
              <select
                id="move-chapter"
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
                className="w-full rounded-sm border border-line bg-paper-raised px-3 py-2.5 text-sm text-ink dark:border-line-dark dark:bg-graphite-800 dark:text-white"
              >
                <option value="">Whole subject</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {chapterId && (
            <div>
              <Label htmlFor="move-topic">Topic (optional)</Label>
              <select
                id="move-topic"
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                className="w-full rounded-sm border border-line bg-paper-raised px-3 py-2.5 text-sm text-ink dark:border-line-dark dark:bg-graphite-800 dark:text-white"
              >
                <option value="">Whole chapter</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <Button type="button" variant="secondary" loading={saving} onClick={() => handleMove("unorganized")}>
              Move to Unorganized
            </Button>
            <Button type="button" loading={saving} disabled={!subjectId} onClick={() => handleMove("selection")}>
              Move here
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
