"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { BlockKindSelect } from "@/components/notes/block-kind-select";
import { BlockToolbar } from "@/components/notes/block-toolbar";
import { cn } from "@/lib/utils";

export interface LocalBlock {
  id: string;
  kind: string;
  heading: string | null;
  content: Record<string, unknown>;
  order: number;
}

export function NoteBlockCard({
  block,
  onChange,
  onDelete,
}: {
  block: LocalBlock;
  onChange: (id: string, patch: Partial<LocalBlock>) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3] } }),
      Placeholder.configure({ placeholder: "Write something…" }),
      Link.configure({ openOnClick: false }),
    ],
    content: block.content,
    editorProps: {
      attributes: {
        class:
          "prose-note min-h-[2.5rem] text-sm leading-relaxed text-ink dark:text-white/90 focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(block.id, { content: editor.getJSON() });
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group card relative p-4 pl-9",
        isDragging && "z-10 opacity-60 shadow-panel"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="absolute left-2 top-4 cursor-grab text-ink-faint opacity-0 transition-opacity hover:text-ink-muted group-hover:opacity-100 active:cursor-grabbing dark:hover:text-white/60"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <BlockKindSelect value={block.kind} onChange={(kind) => onChange(block.id, { kind })} />
        </div>
        <div className="flex items-center gap-1">
          {editor && <BlockToolbar editor={editor} />}
          <button
            onClick={() => onDelete(block.id)}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-ink-faint opacity-0 transition-opacity hover:bg-signal-danger/10 hover:text-signal-danger group-hover:opacity-100"
            aria-label="Delete block"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <input
        value={block.heading ?? ""}
        onChange={(e) => onChange(block.id, { heading: e.target.value })}
        placeholder="Heading (optional)"
        className="mb-1.5 w-full border-0 bg-transparent p-0 font-display text-[15px] font-semibold text-ink outline-none placeholder:text-ink-faint dark:text-white dark:placeholder:text-white/20"
      />

      <EditorContent editor={editor} />
    </div>
  );
}
