"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Presentation } from "lucide-react";
import type { Material } from "@prisma/client";
import { toSafeHttpUrl } from "@/lib/safe-url";

interface SlidePageEntry {
  pageNumber: number;
  text: string;
  slideText?: string;
  speakerNotes?: string;
}

function parseSlidePages(raw: unknown): SlidePageEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const pages: SlidePageEntry[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { pageNumber?: unknown }).pageNumber === "number" &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      const obj = item as Record<string, unknown>;
      pages.push({
        pageNumber: obj.pageNumber as number,
        text: obj.text as string,
        slideText: typeof obj.slideText === "string" ? obj.slideText : undefined,
        speakerNotes: typeof obj.speakerNotes === "string" ? obj.speakerNotes : undefined,
      });
    }
  }
  return pages.length > 0 ? pages : null;
}

/**
 * Renders storage-less Google-native materials (`GOOGLE_DOC` and native
 * Google Slides presentations imported via the Google Slides v1 REST API).
 */
export function GoogleDocViewer({
  material,
  initialSlide,
}: {
  material: Material;
  initialSlide?: number;
}) {
  const ref = material.externalRef as {
    webViewLink?: string;
    mimeType?: string;
    nativeKind?: string;
    remoteDeleted?: boolean;
  } | null;

  const isSlides =
    material.mimeType === "application/vnd.google-apps.presentation" ||
    ref?.mimeType === "application/vnd.google-apps.presentation" ||
    ref?.nativeKind === "google_slides";

  const slidePages = isSlides ? parseSlidePages(material.extractedPages) : null;
  const initialIndex =
    slidePages && initialSlide && initialSlide >= 1 && initialSlide <= slidePages.length
      ? initialSlide - 1
      : 0;
  const [currentSlideIdx, setCurrentSlideIdx] = useState(initialIndex);

  const label = isSlides ? "Google Slides" : "Google Doc";
  const safeWebViewLink = toSafeHttpUrl(ref?.webViewLink);

  if (material.status === "PROCESSING" || material.status === "UPLOADING") {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-ink-muted dark:text-white/50">Importing this {label}…</p>
      </div>
    );
  }

  if (material.status === "FAILED") {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-ink dark:text-white">Couldn&apos;t import this {label}.</p>
        <p className="mt-1 text-sm text-ink-muted dark:text-white/50">Try re-importing it from Google Drive.</p>
      </div>
    );
  }

  if (isSlides && slidePages && slidePages.length > 0) {
    const safeIdx = Math.min(Math.max(0, currentSlideIdx), slidePages.length - 1);
    const activeSlide = slidePages[safeIdx]!;
    const mainSlideText = activeSlide.slideText ?? activeSlide.text;

    return (
      <div className="card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 dark:border-line-dark">
          <div className="flex items-center gap-2">
            <Presentation className="h-4 w-4 text-ink-muted dark:text-white/60" />
            <span className="font-mono text-xs font-medium text-ink-muted dark:text-white/60">
              Slide {activeSlide.pageNumber} of {slidePages.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safeIdx <= 0}
              onClick={() => setCurrentSlideIdx((i) => Math.max(0, i - 1))}
              className="inline-flex items-center gap-1 rounded-sm border border-line px-2.5 py-1 text-xs font-medium text-ink disabled:opacity-40 dark:border-line-dark dark:text-white"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <button
              type="button"
              disabled={safeIdx >= slidePages.length - 1}
              onClick={() => setCurrentSlideIdx((i) => Math.min(slidePages.length - 1, i + 1))}
              className="inline-flex items-center gap-1 rounded-sm border border-line px-2.5 py-1 text-xs font-medium text-ink disabled:opacity-40 dark:border-line-dark dark:text-white"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            {safeWebViewLink && (
              <a
                href={safeWebViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                Open in Google Slides
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>

        <div className="min-h-[180px] rounded-md border border-line bg-paper-raised p-5 dark:border-line-dark dark:bg-graphite-800/60">
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink dark:text-white/90">
            {mainSlideText || "This slide has no text elements."}
          </div>
        </div>

        {activeSlide.speakerNotes && (
          <div className="mt-4 rounded-md border border-line/70 bg-paper p-4 dark:border-line-dark/70 dark:bg-graphite-900/50">
            <p className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-wide text-ink-faint dark:text-white/40">
              Speaker Notes
            </p>
            <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-muted dark:text-white/70">
              {activeSlide.speakerNotes}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card max-h-[75vh] overflow-auto p-6">
      {safeWebViewLink && (
        <a
          href={safeWebViewLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
        >
          Open in {label}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink dark:text-white/90">
        {material.extractedText || "This document has no text content."}
      </div>
    </div>
  );
}
