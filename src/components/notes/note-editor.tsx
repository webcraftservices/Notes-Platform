"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { nanoid } from "nanoid";
import { Plus, Loader2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { NoteBlockCard, type LocalBlock } from "@/components/notes/note-block-card";
import { SaveStatusIndicator } from "@/components/notes/save-status-indicator";
import { VersionHistoryDialog } from "@/components/notes/version-history-dialog";
import { Button } from "@/components/ui/button";
import { EMPTY_TIPTAP_DOC } from "@/lib/note-block-style";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface ApiBlock {
  id: string;
  kind: string;
  heading: string | null;
  content: unknown;
  order: number;
}

function toLocal(blocks: ApiBlock[]): LocalBlock[] {
  return blocks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      heading: b.heading,
      content: (b.content ?? EMPTY_TIPTAP_DOC) as Record<string, unknown>,
      order: b.order,
    }));
}

export function NoteEditor({ topicId }: { topicId: string }) {
  const [noteId, setNoteId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<LocalBlock[] | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const blocksRef = useRef<LocalBlock[]>([]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    fetch(`/api/topics/${topicId}/note`)
      .then((r) => r.json())
      .then((d) => {
        setNoteId(d.note.id);
        const local = toLocal(d.note.blocks);
        setBlocks(local);
        blocksRef.current = local;
      })
      .catch(() => toast.error("Couldn't load notes for this topic."));
  }, [topicId]);

  const performSave = useCallback(
    async (explicit = false) => {
      if (!noteId) return;
      setSaveStatus("saving");
      try {
        const res = await fetch(`/api/notes/${noteId}/blocks`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks: blocksRef.current, explicit }),
        });
        if (!res.ok) {
          setSaveStatus("error");
          return;
        }
        const { blocks: saved } = await res.json();
        const local = toLocal(saved);
        setBlocks(local);
        blocksRef.current = local;
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    },
    [noteId]
  );

  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => performSave(false), 800);
  }, [performSave]);

  function updateBlocks(updater: (prev: LocalBlock[]) => LocalBlock[]) {
    setBlocks((prev) => {
      const next = updater(prev ?? []);
      blocksRef.current = next;
      return next;
    });
    scheduleSave();
  }

  function handleBlockChange(id: string, patch: Partial<LocalBlock>) {
    updateBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function handleDeleteBlock(id: string) {
    updateBlocks((prev) => prev.filter((b) => b.id !== id).map((b, i) => ({ ...b, order: i })));
  }

  function handleAddBlock() {
    updateBlocks((prev) => [
      ...prev,
      {
        id: `tmp-${nanoid(12)}`,
        kind: "CUSTOM",
        heading: "",
        content: EMPTY_TIPTAP_DOC,
        order: prev.length,
      },
    ]);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    updateBlocks((prev) => {
      const oldIndex = prev.findIndex((b) => b.id === active.id);
      const newIndex = prev.findIndex((b) => b.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex).map((b, i) => ({ ...b, order: i }));
    });
  }

  function handleRestore(restored: LocalBlock[]) {
    setBlocks(restored);
    blocksRef.current = restored;
    setSaveStatus("saved");
  }

  if (!noteId || blocks === null) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <SaveStatusIndicator status={saveStatus} />
        <div className="flex items-center gap-3">
          <VersionHistoryDialog noteId={noteId} onRestore={handleRestore} />
          <button
            onClick={() => performSave(true)}
            className="text-xs font-medium text-ink-muted hover:text-ink dark:text-white/50 dark:hover:text-white"
          >
            Save version now
          </button>
        </div>
      </div>

      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center dark:border-line-dark">
          <p className="text-sm text-ink-muted dark:text-white/50">
            No sections yet. Add one to start writing.
          </p>
          <Button variant="secondary" className="mt-4" onClick={handleAddBlock}>
            <Plus className="h-4 w-4" />
            Add section
          </Button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {blocks.map((block) => (
                <NoteBlockCard
                  key={block.id}
                  block={block}
                  onChange={handleBlockChange}
                  onDelete={handleDeleteBlock}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {blocks.length > 0 && (
        <Button variant="secondary" className="mt-3" onClick={handleAddBlock}>
          <Plus className="h-4 w-4" />
          Add section
        </Button>
      )}
    </div>
  );
}
