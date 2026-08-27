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
import { getMaterialLabel } from "@/lib/material-style";

export function MaterialPreview({ material }: { material: Material }) {
  const [readUrl, setReadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(material.type !== "LINK");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (material.type === "LINK") return;
    if (material.status !== "READY") {
      setLoading(false);
      return;
    }
    fetch(`/api/materials/${material.id}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => setReadUrl(data.readUrl))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [material.id, material.type, material.status]);

  if (material.type === "LINK") {
    return <LinkViewer url={material.sourceUrl ?? "#"} />;
  }

  if (material.status === "UPLOADING") {
    return (
      <div className="card flex flex-col items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
        <p className="mt-3 text-sm text-ink-muted dark:text-white/50">Upload in progress…</p>
      </div>
    );
  }

  if (material.status === "FAILED") {
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
      return <AudioPlayer src={readUrl} title={material.title} />;
    case "VIDEO":
      return <VideoViewer src={readUrl} title={material.title} />;
    case "TEXT":
      return <TextViewer src={readUrl} />;
    default:
      return <UnsupportedPreview materialId={material.id} label={getMaterialLabel(material.type)} />;
  }
}
