"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, FolderInput, Download, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RenameMaterialDialog } from "@/components/materials/rename-material-dialog";
import { MoveMaterialDialog } from "@/components/materials/move-material-dialog";

export function MaterialActionsMenu({
  material,
  redirectAfterDeleteTo,
}: {
  material: { id: string; title: string; archivedAt: Date | null; type: string; status: string };
  redirectAfterDeleteTo?: string;
}) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDownload() {
    if (material.type === "LINK") return;
    const res = await fetch(`/api/materials/${material.id}`);
    if (!res.ok) {
      toast.error("Couldn't load this file.");
      return;
    }
    const { readUrl } = await res.json();
    if (!readUrl) {
      toast.error("This file isn't ready yet.");
      return;
    }
    const url = readUrl.includes("?") ? `${readUrl}&download=1` : `${readUrl}?download=1`;
    window.open(url, "_blank");
  }

  async function toggleArchive() {
    const res = await fetch(`/api/materials/${material.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !material.archivedAt }),
    });
    if (!res.ok) {
      toast.error("Couldn't update this material.");
      return;
    }
    toast.success(material.archivedAt ? "Restored" : "Archived");
    router.refresh();
  }

  async function handleDelete() {
    const res = await fetch(`/api/materials/${material.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete this material.");
      return;
    }
    toast.success("Material deleted");
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
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil className="h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
            <FolderInput className="h-4 w-4" />
            Move
          </DropdownMenuItem>
          {material.type !== "LINK" && material.status === "READY" && (
            <DropdownMenuItem onSelect={handleDownload}>
              <Download className="h-4 w-4" />
              Download
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={toggleArchive}>
            {material.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {material.archivedAt ? "Restore" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameMaterialDialog
        materialId={material.id}
        currentTitle={material.title}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <MoveMaterialDialog materialId={material.id} open={moveOpen} onOpenChange={setMoveOpen} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${material.title}"?`}
        description="This removes the material and its file. You can't undo this from here."
        confirmLabel="Delete material"
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
