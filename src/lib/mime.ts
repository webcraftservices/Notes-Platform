import type { MaterialType } from "@prisma/client";

/**
 * Single source of truth for "what file types does the platform accept,
 * and what MaterialType do they map to". Both the upload-URL request
 * handler and the actual upload-write handler check against this — never
 * trust the client's declared Content-Type alone (spec §87).
 */
export const ACCEPTED_MIME_TYPES: Record<string, MaterialType> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/msword": "DOCX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.ms-powerpoint": "PPTX",
  "text/plain": "TEXT",
  "text/markdown": "TEXT",
  "image/png": "IMAGE",
  "image/jpeg": "IMAGE",
  "image/webp": "IMAGE",
  "image/gif": "IMAGE",
  "image/heic": "IMAGE",
  "audio/mpeg": "AUDIO",
  "audio/mp4": "AUDIO",
  "audio/wav": "AUDIO",
  "audio/x-wav": "AUDIO",
  "audio/aac": "AUDIO",
  "audio/ogg": "AUDIO",
  "audio/webm": "AUDIO",
  "audio/m4a": "AUDIO",
  "audio/x-m4a": "AUDIO",
  "video/mp4": "VIDEO",
  "video/webm": "VIDEO",
  "video/quicktime": "VIDEO",
};

export function resolveMaterialType(mimeType: string | undefined): MaterialType | null {
  // Normalize: strip any parameters (e.g. "audio/webm;codecs=opus") and lowercase
  const base = ((mimeType ?? "").split(";")[0] ?? "").trim().toLowerCase();
  return ACCEPTED_MIME_TYPES[base] ?? null;
}

export function isAudioType(type: MaterialType) {
  return type === "AUDIO";
}
export function isVideoType(type: MaterialType) {
  return type === "VIDEO";
}
export function isImageType(type: MaterialType) {
  return type === "IMAGE";
}
export function isPdfType(type: MaterialType) {
  return type === "PDF";
}
export function isTextType(type: MaterialType) {
  return type === "TEXT";
}

/** Extensions used only for the display filename fallback — never trusted for type detection. */
export function guessExtension(mimeType: string): string {
  // Strip parameters and normalize to base type (e.g. "audio/webm;codecs=opus" -> "audio/webm")
  const base = ((mimeType ?? "").split(";")[0] ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.ms-powerpoint": "ppt",
    "text/plain": "txt",
    "text/markdown": "md",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return map[base] ?? "bin";
}
