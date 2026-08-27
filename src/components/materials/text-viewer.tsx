"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export function TextViewer({ src }: { src: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (error) {
    return <p className="text-sm text-signal-danger">Couldn&apos;t load this file&apos;s content.</p>;
  }

  if (content === null) {
    return (
      <div className="card flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
      </div>
    );
  }

  return (
    <div className="card max-h-[75vh] overflow-auto p-6">
      <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-ink dark:text-white/90">
        {content}
      </pre>
    </div>
  );
}
