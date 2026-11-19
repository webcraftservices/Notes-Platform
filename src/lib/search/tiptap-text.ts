/**
 * src/lib/search/tiptap-text.ts
 *
 * Robust, zero-dependency plain-text extraction from ProseMirror/Tiptap JSON ASTs.
 * Used for PostgreSQL full-text search indexing (GIN) and semantic search chunking.
 */

export interface NoteBlockTextSource {
  heading?: string | null;
  content: unknown;
  order?: number;
}

const MAX_RECURSION_DEPTH = 64;

/**
 * Recursively extracts plain text from any ProseMirror/Tiptap JSON node or document tree.
 *
 * Guarantees:
 * 1. Never throws on null, undefined, unexpected types, malformed nodes, or circular structures.
 * 2. Separates block elements (paragraphs, headings, lists, blockquotes, code blocks) with newlines.
 * 3. Joins inline elements (text nodes, marks, hard breaks) seamlessly.
 * 4. Normalizes whitespace, collapses excessive blank lines (3+ -> 2), and trims output.
 */
export function extractPlainTextFromTiptap(content: unknown): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content.trim();
  if (typeof content !== "object") return "";

  const visited = new WeakSet<object>();
  const rawText = walkNode(content, 0, visited);
  return normalizeExtractedText(rawText);
}

function walkNode(node: unknown, depth: number, visited: WeakSet<object>): string {
  if (depth > MAX_RECURSION_DEPTH) return "";
  if (!node || typeof node !== "object") return "";

  // Guard against circular structures
  if (visited.has(node)) return "";
  visited.add(node);

  // Array of nodes
  if (Array.isArray(node)) {
    return node
      .map((child) => walkNode(child, depth + 1, visited))
      .filter(Boolean)
      .join("\n");
  }

  const n = node as Record<string, unknown>;

  // Leaf text node (with or without marks like bold, italic, code, link)
  if (n.type === "text" && typeof n.text === "string") {
    return n.text;
  }

  // Hard breaks (<br>)
  if (n.type === "hardBreak" || n.type === "hard_break") {
    return "\n";
  }

  // Horizontal rules (<hr>)
  if (n.type === "horizontalRule" || n.type === "horizontal_rule") {
    return "\n";
  }

  // Container nodes with content array
  if (Array.isArray(n.content)) {
    const nodeType = typeof n.type === "string" ? n.type : "";

    // 1. Inline containers (paragraphs, headings, codeBlocks):
    // Child inline nodes (text, hardBreak) are concatenated directly.
    if (
      nodeType === "paragraph" ||
      nodeType === "heading" ||
      nodeType === "codeBlock" ||
      nodeType === "code_block"
    ) {
      return n.content.map((child) => walkNode(child, depth + 1, visited)).join("");
    }

    // 2. Table rows: join cells with double space
    if (nodeType === "tableRow" || nodeType === "table_row") {
      return n.content
        .map((cell) => walkNode(cell, depth + 1, visited).trim())
        .filter(Boolean)
        .join("  ");
    }

    // 3. Table cells / headers: join internal blocks with space
    if (
      nodeType === "tableCell" ||
      nodeType === "table_cell" ||
      nodeType === "tableHeader" ||
      nodeType === "table_header"
    ) {
      return n.content
        .map((child) => walkNode(child, depth + 1, visited).trim())
        .filter(Boolean)
        .join(" ");
    }

    // 4. List items / task items: join internal blocks with newline
    if (
      nodeType === "listItem" ||
      nodeType === "list_item" ||
      nodeType === "taskItem" ||
      nodeType === "task_item"
    ) {
      return n.content
        .map((child) => walkNode(child, depth + 1, visited).trim())
        .filter(Boolean)
        .join("\n");
    }

    // 5. Lists (bulletList, orderedList, taskList): join items with newline
    if (
      nodeType === "bulletList" ||
      nodeType === "bullet_list" ||
      nodeType === "orderedList" ||
      nodeType === "ordered_list" ||
      nodeType === "taskList" ||
      nodeType === "task_list"
    ) {
      return n.content
        .map((child) => walkNode(child, depth + 1, visited).trim())
        .filter(Boolean)
        .join("\n");
    }

    // 6. Blockquote: join internal paragraphs with newline
    if (nodeType === "blockquote") {
      return n.content
        .map((child) => walkNode(child, depth + 1, visited).trim())
        .filter(Boolean)
        .join("\n");
    }

    // 7. Root doc: separate blocks by double newlines
    if (nodeType === "doc") {
      return n.content
        .map((child) => walkNode(child, depth + 1, visited).trim())
        .filter(Boolean)
        .join("\n\n");
    }

    // Generic fallback for any other container node
    return n.content
      .map((child) => walkNode(child, depth + 1, visited).trim())
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function normalizeExtractedText(text: string): string {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Combines note title and an array of blocks into a unified plain-text document.
 * Blocks are sorted by `order` ascending. Empty blocks are cleanly omitted.
 */
export function buildNotePlainText(
  title: string | null | undefined,
  blocks: NoteBlockTextSource[]
): string {
  const parts: string[] = [];

  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    parts.push(trimmedTitle);
  }

  const sortedBlocks = [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const block of sortedBlocks) {
    const blockParts: string[] = [];
    const heading = block.heading?.trim();
    if (heading) {
      blockParts.push(heading);
    }
    const body = extractPlainTextFromTiptap(block.content);
    if (body) {
      blockParts.push(body);
    }
    if (blockParts.length > 0) {
      parts.push(blockParts.join("\n"));
    }
  }

  return parts.join("\n\n").trim();
}
