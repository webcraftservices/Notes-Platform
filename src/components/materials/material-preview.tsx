"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import type { Material } from "@prisma/client";
import { PdfViewer } from "@/components/materials/pdf-viewer";
import { ImageViewer } from "@/components/materials/image-viewer";
import { AudioPlayer } from "@/components/materials/audio-player";
import { VideoViewer } from "@/components/materials/video-viewer";
import { TextViewer } from "@/components/materials/text-viewer";
import { UnsupportedPreview } from "@/components/materials/unsupported-preview";
import { LinkViewer } from "@/components/materials/link-viewer";
import { GoogleDocViewer } from "@/components/materials/google-doc-viewer";
import { PresentationViewer } from "@/components/materials/presentation-viewer";
import { DocumentViewer } from "@/components/materials/document-viewer";
import { getMaterialLabel } from "@/lib/material-style";

export function MaterialPreview({ material }: { material: Material }) {
  const [currentMaterial, setCurrentMaterial] = useState(material);
  const [readUrl, setReadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(material.type !== "LINK" && material.type !== "GOOGLE_DOC");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (material.type === "LINK" || material.type === "GOOGLE_DOC") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      try {
        const res = await fetch(`/api/materials/${material.id}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (disposed) return;

        setCurrentMaterial(data.material);
        setReadUrl(data.readUrl ?? null);
        setError(false);
        setLoading(data.material.status === "READY" && !data.readUrl);

        if (data.material.status === "PROCESSING") {
          timer = setTimeout(refresh, 3000);
        }
      } catch {
        if (!disposed) {
          setError(true);
          setLoading(false);
        }
      }
    }

    setCurrentMaterial(material);
    setError(false);
    setLoading(material.status === "READY");
    void refresh();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [material]);

  if (material.type === "LINK") {
    return <LinkViewer url={material.sourceUrl ?? "#"} />;
  }

  // No storageKey to fetch a readUrl for — content lives in extractedText,
  // and PROCESSING/FAILED states are handled inside the viewer itself.
  if (material.type === "GOOGLE_DOC") {
    return <GoogleDocViewer material={material} />;
  }

  if (currentMaterial.status === "UPLOADING") {
    return (
      <div className="card flex flex-col items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
        <p className="mt-3 text-sm text-ink-muted dark:text-white/50">Upload in progress…</p>
      </div>
    );
  }

  if (currentMaterial.status === "PROCESSING") {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
        <p className="mt-3 text-sm text-ink-muted dark:text-white/50">Importing this file…</p>
        <p className="mt-1 text-xs text-ink-faint dark:text-white/30">Large videos can take a few minutes.</p>
      </div>
    );
  }

  if (currentMaterial.status === "FAILED") {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-5 w-5 text-signal-danger" />
        <p className="mt-3 text-sm text-ink dark:text-white">Something went wrong processing this file</p>
        <p className="mt-1 text-sm text-ink-muted dark:text-white/50">
          It may be corrupted, or the format wasn&apos;t readable. Try re-uploading it.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
      </div>
    );
  }

  if (error || !readUrl) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-5 w-5 text-signal-danger" />
        <p className="mt-3 text-sm text-ink-muted dark:text-white/50">Couldn&apos;t load this file.</p>
      </div>
    );
  }

  switch (material.type) {
    case "PDF":
      return <PdfViewer src={readUrl} title={material.title} />;
    case "IMAGE":
      return <ImageViewer src={readUrl} alt={material.title} />;
    case "AUDIO":
      return (
        <AudioPlayer src={readUrl} title={material.title} fallbackDurationSeconds={material.durationSeconds} />
      );
    case "VIDEO":
      return <VideoViewer src={readUrl} title={material.title} />;
    case "PPTX":
      return <PresentationViewer materialId={material.id} src={readUrl} title={material.title} />;
    case "DOCX":
      return <DocumentViewer materialId={material.id} src={readUrl} title={material.title} />;
    case "TEXT":
      return <TextViewer src={readUrl} />;
    default:
      return <UnsupportedPreview materialId={material.id} label={getMaterialLabel(material.type)} />;
  }
}
