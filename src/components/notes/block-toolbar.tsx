"use client";

import type { Editor } from "@tiptap/react";
import { Bold, Italic, List, ListOrdered, Link2, Heading2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function BlockToolbar({ editor }: { editor: Editor }) {
  const buttons = [
    {
      icon: Bold,
      label: "Bold",
      active: editor.isActive("bold"),
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      icon: Italic,
      label: "Italic",
      active: editor.isActive("italic"),
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      icon: Heading2,
      label: "Heading",
      active: editor.isActive("heading", { level: 3 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      icon: List,
      label: "Bulleted list",
      active: editor.isActive("bulletList"),
      onClick: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      icon: ListOrdered,
      label: "Numbered list",
      active: editor.isActive("orderedList"),
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      icon: Link2,
      label: "Link",
      active: editor.isActive("link"),
      onClick: () => {
        const previousUrl = editor.getAttributes("link").href as string | undefined;
        const url = window.prompt("Link URL", previousUrl ?? "");
        if (url === null) return;
        if (url === "") {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          return;
        }
        editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
      },
    },
  ];

  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100">
      {buttons.map((btn) => (
        <button
          key={btn.label}
          type="button"
          title={btn.label}
          onClick={btn.onClick}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-sm text-ink-faint transition-colors hover:bg-paper hover:text-ink dark:hover:bg-graphite-700 dark:hover:text-white",
            btn.active && "bg-accent-soft text-accent-strong hover:bg-accent-soft"
          )}
        >
          <btn.icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
