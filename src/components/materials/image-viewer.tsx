"use client";

import { useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

export function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-end border-b border-line px-3 py-2 dark:border-line-dark">
        <button
          onClick={() => setZoomed((z) => !z)}
          className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-ink-muted hover:bg-paper dark:text-white/50 dark:hover:bg-graphite-800"
        >
          {zoomed ? <ZoomOut className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
          {zoomed ? "Fit to screen" : "Actual size"}
        </button>
      </div>
      <div className="flex max-h-[75vh] items-center justify-center overflow-auto bg-paper p-4 dark:bg-graphite-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className={zoomed ? "max-w-none" : "max-h-[68vh] max-w-full object-contain"}
        />
      </div>
    </div>
  );
}
