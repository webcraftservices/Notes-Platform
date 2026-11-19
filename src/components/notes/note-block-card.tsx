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
  metadata?: Record<string, unknown> | null;
}

function formatSourceAttribution(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  const unitType = typeof meta.sourceUnitType === "string" ? meta.sourceUnitType : null;
  const pages = Array.isArray(meta.sourcePages)
    ? meta.sourcePages.filter((n): n is number => typeof n === "number")
    : null;
  const singlePage = typeof meta.pageNumber === "number" ? meta.pageNumber : null;
  const title = typeof meta.materialTitle === "string" ? meta.materialTitle : null;

  let unitStr = "";
  if (pages && pages.length > 0) {
    const label = unitType === "slide" ? (pages.length > 1 ? "slides" : "slide") : pages.length > 1 ? "pp." : "p.";
    unitStr = `${label} ${pages.join(", ")}`;
  } else if (singlePage) {
    const label = unitType === "slide" ? "slide" : "p.";
    unitStr = `${label} ${singlePage}`;
  }

  if (title && unitStr) {
    return `${title} (${unitStr})`;
  } else if (title) {
    return title;
  } else if (unitStr) {
    return unitStr;
  }
  return null;
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
          {(() => {
            const sourceText = formatSourceAttribution(block.metadata);
            if (!sourceText) return null;
            return (
              <span
                className="inline-flex items-center rounded bg-ink-faint/10 px-1.5 py-0.5 text-[11px] font-medium text-ink-muted dark:bg-white/10 dark:text-white/60 max-w-[200px] truncate"
                title={sourceText}
              >
                {sourceText}
              </span>
            );
          })()}
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
