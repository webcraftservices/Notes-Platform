import {
  FileText,
  FileImage,
  FileAudio,
  FileVideo,
  FileType,
  Presentation,
  Link2,
  File,
  type LucideIcon,
} from "lucide-react";
import type { MaterialType } from "@prisma/client";

export const MATERIAL_TYPE_ICONS: Record<MaterialType, LucideIcon> = {
  PDF: FileText,
  DOCX: FileType,
  PPTX: Presentation,
  TEXT: FileText,
  IMAGE: FileImage,
  AUDIO: FileAudio,
  VIDEO: FileVideo,
  LINK: Link2,
  GOOGLE_DOC: FileText,
  GOOGLE_DRIVE_FILE: File,
  NOTE_EXPORT: FileText,
  OTHER: File,
};

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  PDF: "PDF",
  DOCX: "Word Document",
  PPTX: "Presentation",
  TEXT: "Text File",
  IMAGE: "Image",
  AUDIO: "Audio",
  VIDEO: "Video",
  LINK: "Link",
  GOOGLE_DOC: "Google Doc",
  GOOGLE_DRIVE_FILE: "Google Drive File",
  NOTE_EXPORT: "Note Export",
  OTHER: "File",
};

// Bracket access into a fully-populated Record still resolves to
// `V | undefined` under noUncheckedIndexedAccess (TS can't prove the key
// exhaustively covers the type at a dynamic access site) — same class of
// bug as lib/subject-style.ts. These helpers are the guaranteed-non-null
// way to read either map; prefer them over indexing the maps directly.
export function getMaterialIcon(type: MaterialType): LucideIcon {
  return MATERIAL_TYPE_ICONS[type] ?? File;
}

export function getMaterialLabel(type: MaterialType): string {
  return MATERIAL_TYPE_LABELS[type] ?? "File";
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value < 10 && unitIndex > 0 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  // Treat missing, non-finite, or non-positive numbers as "unknown".
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
