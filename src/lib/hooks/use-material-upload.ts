"use client";

import { useCallback } from "react";

export interface UploadScope {
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
}

export interface UploadProgressEvent {
  progress: number; // 0-100
  phase: "uploading" | "finalizing";
}

/**
 * The actual upload pipeline (request a signed target → XHR PUT the real
 * bytes with real progress events → call the completion endpoint), shared
 * by the drag-drop MaterialUploader and the RecorderPanel so both a picked
 * file and a freshly-recorded Blob go through identical, single-sourced
 * logic — no duplicated upload code to drift out of sync.
 */
export function useMaterialUpload() {
  const upload = useCallback(
    async (
      file: File | Blob,
      filename: string,
      mimeType: string,
      scope: UploadScope,
      onProgress?: (event: UploadProgressEvent) => void
    ): Promise<{ materialId: string }> => {
      const requestRes = await fetch("/api/materials/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, mimeType, sizeBytes: file.size, ...scope }),
      });

      if (!requestRes.ok) {
        const body = await requestRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "Couldn't start the upload.");
      }

      const { materialId, uploadUrl, headers } = await requestRes.json();

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        Object.entries(headers ?? {}).forEach(([k, v]) => xhr.setRequestHeader(k, v as string));
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress?.({ progress: Math.round((e.loaded / e.total) * 100), phase: "uploading" });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(tryParseError(xhr.responseText) ?? "Upload failed."));
        };
        xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
        xhr.send(file);
      });

      onProgress?.({ progress: 100, phase: "finalizing" });

      const completeRes = await fetch(`/api/materials/${materialId}/complete`, { method: "POST" });
      if (!completeRes.ok) {
        throw new Error("Upload finished but processing failed.");
      }

      return { materialId };
    },
    []
  );

  return { upload };
}

function tryParseError(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}
