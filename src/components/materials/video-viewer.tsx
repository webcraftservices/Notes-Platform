export function VideoViewer({ src, title }: { src: string; title: string }) {
  return (
    <div className="card overflow-hidden bg-graphite-950">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={src} controls preload="metadata" className="max-h-[75vh] w-full" aria-label={title} />
    </div>
  );
}
