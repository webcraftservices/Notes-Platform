"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ChapterActionsMenu({
  chapter,
  redirectAfterDeleteTo,
}: {
  chapter: { id: string; name: string; archivedAt: Date | null };
  redirectAfterDeleteTo?: string;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function toggleArchive() {
    const res = await fetch(`/api/chapters/${chapter.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !chapter.archivedAt }),
    });
    if (!res.ok) {
      toast.error("Couldn't update the chapter.");
      return;
    }
    toast.success(chapter.archivedAt ? "Chapter restored" : "Chapter archived");
    router.refresh();
  }

  async function handleDelete() {
    const res = await fetch(`/api/chapters/${chapter.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete the chapter.");
      return;
    }
    toast.success("Chapter deleted");
    if (redirectAfterDeleteTo) router.push(redirectAfterDeleteTo);
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          onClick={(e) => e.preventDefault()}
          className="flex h-7 w-7 items-center justify-center rounded-sm bg-paper-raised text-ink-muted shadow-subtle transition-colors hover:text-ink dark:bg-graphite-800 dark:text-white/50 dark:hover:text-white"
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={toggleArchive}>
            {chapter.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {chapter.archivedAt ? "Restore" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${chapter.name}"?`}
        description="This removes the chapter and all its topics. You can't undo this from here."
        confirmLabel="Delete chapter"
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
