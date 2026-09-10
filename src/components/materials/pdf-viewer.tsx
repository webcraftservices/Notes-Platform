/**
 * Uses the browser's built-in PDF renderer (every evergreen browser has
 * one) rather than shipping a client-side PDF.js bundle — real page
 * navigation, search, and zoom all come from that native viewer for free.
 * The trade-off is no custom in-app chrome (spec §79's "page viewer" is
 * satisfied by the browser's own controls, not a bespoke one) and no
 * rendering at all on browsers without native PDF support — acceptable
 * for Phase 3, revisit with pdf.js if a fully custom viewer becomes a
 * real requirement later.
 *
 * `page` (Phase 5 — AI chat source citations with a page number) uses the
 * browser PDF viewer's own native `#page=N` URL fragment support — the
 * same viewer chrome mentioned above already understands this with zero
 * extra code, so there's nothing to build here beyond appending it to
 * `src`. A fragment never leaves the browser (it's not sent to the
 * server), so this is safe to append to a signed/presigned `src` URL
 * regardless of its existing query string.
 */
export function PdfViewer({ src, title, page }: { src: string; title: string; page?: number }) {
  const href = page != null && page > 0 ? `${src}#page=${Math.floor(page)}` : src;
  return (
    <div className="card overflow-hidden">
      <iframe src={href} title={title} className="h-[80vh] w-full" />
    </div>
  );
}
