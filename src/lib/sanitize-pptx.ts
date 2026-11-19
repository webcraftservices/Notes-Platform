import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitizes untrusted `.pptx` slide markup and CSS generated client-side
 * by `pptx2html` BEFORE jQuery parses or appends strings to the live DOM.
 */

const STYLE_ELEMENT_ONLY_RE = /^\s*<style(?:\s[^>]*)?>([\s\S]*?)<\/style>\s*$/i;

export function sanitizePptxCss(css: string): string {
  if (!css) return "";
  return css
    // Prevent style-tag breakout or injected HTML tags inside CSS
    .replace(/<\/?\s*style\b[^>]*>/gi, "")
    .replace(/[<>]/g, "")
    // Neutralize legacy CSS script execution and external CSS imports
    .replace(/@import\b[^;]*(;|$)/gi, "/* blocked-import */$1")
    .replace(/expression\s*\(/gi, "/* blocked */(")
    .replace(/-moz-binding\s*:/gi, "/* blocked */:")
    .replace(/behavior\s*:/gi, "/* blocked */:")
    .replace(/javascript\s*:/gi, "/* blocked */:")
    .replace(/vbscript\s*:/gi, "/* blocked */:")
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript|data\s*:\s*text\/html)/gi, "url($1about:invalid");
}

export function sanitizePptxHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "form",
      "meta",
      "link",
      "base",
      "style",
    ],
    FORBID_ATTR: ["srcdoc"],
  });
}

export function sanitizePptxDomChunk(chunk: unknown): unknown {
  if (typeof chunk !== "string") return chunk;
  const styleMatch = STYLE_ELEMENT_ONLY_RE.exec(chunk);
  if (styleMatch) {
    return `<style>${sanitizePptxCss(styleMatch[1] ?? "")}</style>`;
  }
  return sanitizePptxHtml(chunk);
}
