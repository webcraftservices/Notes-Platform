"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadCloud, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/material-style";
import { useMaterialUpload, type UploadScope } from "@/lib/hooks/use-material-upload";

interface UploadItem {
  id: string;
  file: File;
  progress: number; // 0-100
  status: "uploading" | "finalizing" | "done" | "error";
  error?: string;
}

/**
 * Real upload pipeline, no simulated progress bar — see
 * lib/hooks/use-material-upload.ts for the actual request/XHR/complete
 * logic shared with the audio recorder.
 */
export function MaterialUploader({ scope, onUploaded }: { scope: UploadScope; onUploaded?: () => void }) {
  const router = useRouter();
  const { upload } = useMaterialUpload();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setItems((prev) => [...prev, { id, file, progress: 0, status: "uploading" }]);

      try {
        await upload(file, file.name, file.type || "application/octet-stream", scope, (event) => {
          updateItem(id, { progress: event.progress, status: event.phase });
        });

        updateItem(id, { status: "done" });
        onUploaded?.();
        router.refresh();

        setTimeout(() => setItems((prev) => prev.filter((it) => it.id !== id)), 2500);
      } catch (err) {
        updateItem(id, { status: "error", error: err instanceof Error ? err.message : "Upload failed." });
      }
    },
    [scope, onUploaded, router, updateItem, upload]
  );

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    Array.from(fileList).forEach((file) => {
      if (file.size === 0) {
        toast.error(`${file.name} is empty and can't be uploaded.`);
        return;
      }
      uploadFile(file);
    });
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragActive
            ? "border-accent bg-accent-soft"
            : "border-line hover:border-ink-faint dark:border-line-dark"
        )}
      >
        <UploadCloud className={cn("mb-3 h-6 w-6", dragActive ? "text-accent-strong" : "text-ink-faint")} strokeWidth={1.5} />
        <p className="text-sm font-medium text-ink dark:text-white">
          Drop files here, or click to browse
        </p>
        <p className="mt-1 text-xs text-ink-faint dark:text-white/30">
          PDF, Word, PowerPoint, text, images, audio, and video
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="card flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium text-ink dark:text-white">{item.file.name}</p>
                  <span className="shrink-0 text-[11px] text-ink-faint dark:text-white/30">
                    {formatBytes(item.file.size)}
                  </span>
                </div>
                {item.status === "error" ? (
                  <p className="mt-1 text-[11px] text-signal-danger">{item.error}</p>
                ) : (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line dark:bg-line-dark">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        item.status === "done" ? "bg-signal-success" : "bg-accent"
                      )}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="shrink-0">
                {item.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />}
                {item.status === "finalizing" && <Loader2 className="h-4 w-4 animate-spin text-ink-faint" />}
                {item.status === "done" && <CheckCircle2 className="h-4 w-4 text-signal-success" />}
                {item.status === "error" && <AlertCircle className="h-4 w-4 text-signal-danger" />}
              </div>
              {item.status === "error" && (
                <button
                  onClick={() => setItems((prev) => prev.filter((it) => it.id !== item.id))}
                  className="shrink-0 text-ink-faint hover:text-ink dark:hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
