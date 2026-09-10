"use client";

import { useEffect, useRef } from "react";

export function VideoViewer({ src, title, startAtSeconds }: { src: string; title: string; startAtSeconds?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const appliedInitialSeekRef = useRef(false);

  useEffect(() => {
    appliedInitialSeekRef.current = false;
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || startAtSeconds == null) return;

    const onLoaded = () => {
      if (appliedInitialSeekRef.current) return;
      appliedInitialSeekRef.current = true;
      const target = Math.max(0, startAtSeconds);
      const clamped = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(target, video.duration) : target;
      video.currentTime = clamped;
    };

    video.addEventListener("loadedmetadata", onLoaded);
    // In case metadata already loaded before this effect attached the listener.
    if (video.readyState >= 1) onLoaded();

    return () => video.removeEventListener("loadedmetadata", onLoaded);
  }, [startAtSeconds]);

  return (
    <div className="card overflow-hidden bg-graphite-950">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} src={src} controls preload="metadata" className="max-h-[75vh] w-full" aria-label={title} />
    </div>
  );
}
