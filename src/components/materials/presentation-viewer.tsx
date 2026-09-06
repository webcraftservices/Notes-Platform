"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function PresentationViewer({
  materialId,
  src,
  title,
}: {
  materialId: string;
  src: string;
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [slideCount, setSlideCount] = useState(0);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    async function renderPresentation() {
      setLoading(true);
      setError(null);
      setSlideCount(0);
      setCurrentSlide(0);

      try {
        const response = await fetch(src, { cache: "no-store" });
        if (!response.ok) throw new Error("The presentation file could not be loaded.");
        const buffer = await response.arrayBuffer();
        const [{ default: jquery }, d3, { default: dimple }, { default: JSZip }] = await Promise.all([
          import("jquery"),
          import("d3"),
          import("dimple"),
          import("jszip"),
        ]);
        const $ = jquery;
        Object.assign(globalThis, { $, jQuery: jquery, d3, dimple, JSZip });
        const { default: renderPptx } = await import("pptx2html");
        if (disposed || !containerRef.current) return;

        containerRef.current.replaceChildren();
        await renderPptx(buffer, containerRef.current);
        if (disposed || !containerRef.current) return;

        const slides = containerRef.current.querySelectorAll("section");
        if (slides.length === 0) throw new Error("No slides were found in this presentation.");
        setSlideCount(slides.length);
        setLoading(false);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : "The presentation could not be rendered.");
          setLoading(false);
        }
      }
    }

    void renderPresentation();
    return () => {
      disposed = true;
    };
  }, [src]);

  useEffect(() => {
    const slides = containerRef.current?.querySelectorAll("section");
    if (!slides) return;
    slides.forEach((slide, index) => {
      slide.toggleAttribute("hidden", index !== currentSlide);
    });
  }, [currentSlide, slideCount]);

  async function handleDownload() {
    const response = await fetch(`/api/materials/${materialId}`);
    if (!response.ok) {
      toast.error("Couldn't load this file.");
      return;
    }
    const data = await response.json();
    if (!data.readUrl) {
      toast.error("This file isn't ready yet.");
      return;
    }
    window.open(`${data.readUrl}${data.readUrl.includes("?") ? "&" : "?"}download=1`, "_blank");
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3 dark:border-line-dark">
        <p className="truncate pr-4 text-sm font-medium text-ink dark:text-white">{title}</p>
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
          <p className="mt-3 text-sm text-ink-muted dark:text-white/50">Loading presentation…</p>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <AlertCircle className="h-5 w-5 text-signal-danger" />
          <p className="mt-3 text-sm text-ink dark:text-white">Couldn&apos;t render this presentation.</p>
          <p className="mt-1 text-sm text-ink-muted dark:text-white/50">{error}</p>
        </div>
      )}

      <div ref={containerRef} className={loading || error ? "hidden" : "overflow-auto p-3"} />

      {!loading && !error && slideCount > 0 && (
        <div className="flex items-center justify-center gap-3 border-t border-line px-4 py-3 dark:border-line-dark">
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => setCurrentSlide((slide) => Math.max(0, slide - 1))}
            disabled={currentSlide === 0}
            aria-label="Previous slide"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="min-w-24 text-center text-sm text-ink-muted dark:text-white/60">
            Slide {currentSlide + 1} of {slideCount}
          </span>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => setCurrentSlide((slide) => Math.min(slideCount - 1, slide + 1))}
            disabled={currentSlide === slideCount - 1}
            aria-label="Next slide"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
