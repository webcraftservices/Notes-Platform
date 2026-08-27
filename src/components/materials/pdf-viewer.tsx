/**
 * Uses the browser's built-in PDF renderer (every evergreen browser has
 * one) rather than shipping a client-side PDF.js bundle — real page
 * navigation, search, and zoom all come from that native viewer for free.
 * The trade-off is no custom in-app chrome (spec §79's "page viewer" is
 * satisfied by the browser's own controls, not a bespoke one) and no
 * rendering at all on browsers without native PDF support — acceptable
 * for Phase 3, revisit with pdf.js if a fully custom viewer becomes a
 * real requirement later.
 */
export function PdfViewer({ src, title }: { src: string; title: string }) {
  return (
    <div className="card overflow-hidden">
      <iframe src={src} title={title} className="h-[80vh] w-full" />
    </div>
  );
}
