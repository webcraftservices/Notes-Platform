import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitizes HTML before it is rendered via `dangerouslySetInnerHTML`
 * (Phase 9.1, spec §5A/§27/§87). Today this guards exactly one boundary:
 * `DOCX → Mammoth → generated HTML → this function → React`
 * (see components/materials/document-viewer.tsx). Mammoth's HTML output
 * is derived from user-supplied `.docx` files, so it must never be trusted
 * as-is — a crafted document could otherwise get arbitrary HTML/attributes
 * (e.g. an `<img onerror>`/`<a href="javascript:...">`) into the DOM.
 *
 * Restricted to `USE_PROFILES: { html: true }` rather than the default
 * (HTML + SVG + MathML) profile: Mammoth never emits SVG or MathML, and
 * both are well-known DOMPurify bypass surfaces, so they're excluded
 * entirely instead of allow-listed tag-by-tag. Ordinary document
 * formatting Mammoth does produce — headings, paragraphs, lists, tables,
 * emphasis, and plain `http(s)`/`mailto:` links — is preserved unchanged;
 * only actively dangerous markup (script tags, event-handler attributes,
 * `javascript:`/`data:` URLs in href/src, embedded SVG, etc.) is stripped.
 */
export function sanitizeDocumentHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
