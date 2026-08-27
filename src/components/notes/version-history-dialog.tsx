"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { History, RotateCcw, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LocalBlock } from "@/components/notes/note-block-card";

interface Version {
  id: string;
  createdAt: string;
}

export function VersionHistoryDialog({
  noteId,
  onRestore,
}: {
  noteId: string;
  onRestore: (blocks: LocalBlock[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    fetch(`/api/notes/${noteId}/versions`)
      .then((r) => r.json())
      .then((d) => setVersions(d.versions ?? []));
  }, [open, noteId]);

  async function handleRestore(versionId: string) {
    setRestoringId(versionId);
    try {
      const res = await fetch(`/api/notes/${noteId}/versions/${versionId}/restore`, { method: "POST" });
      if (!res.ok) {
        toast.error("Couldn't restore this version.");
        return;
      }
      const { blocks } = await res.json();
      onRestore(
        blocks.map((b: { id: string; kind: string; heading: string | null; content: unknown; order: number }) => ({
          id: b.id,
          kind: b.kind,
          heading: b.heading,
          content: b.content,
          order: b.order,
        }))
      );
      toast.success("Version restored");
      setOpen(false);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-ink-muted hover:bg-paper dark:text-white/50 dark:hover:bg-graphite-800">
          <History className="h-3.5 w-3.5" />
          History
        </button>
      </DialogTrigger>
      <DialogContent title="Version history" description="Automatic snapshots are saved periodically as you edit.">
        {versions === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
          </div>
        ) : versions.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint dark:text-white/30">
            No earlier versions yet — they&apos;ll appear here as you keep editing.
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-sm px-2.5 py-2 hover:bg-paper dark:hover:bg-graphite-800">
                <span className="text-sm text-ink dark:text-white">
                  {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}
                </span>
                <Button
                  variant="secondary"
                  className="!px-2.5 !py-1 text-xs"
                  loading={restoringId === v.id}
                  onClick={() => handleRestore(v.id)}
                >
                  <RotateCcw className="h-3 w-3" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
