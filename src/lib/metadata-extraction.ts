import { imageSize } from "image-size";
import { PDFDocument } from "pdf-lib";
import { parseBuffer } from "music-metadata";
import type { MaterialType } from "@prisma/client";

export interface ExtractedMetadata {
  pageCount?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  extractionError?: string;
}

/**
 * Cheap, deterministic, non-AI extraction — no model calls, no OCR, no
 * transcription. This is what makes it fair to run synchronously right
 * after upload instead of queuing a background job: it's bounded and fast
 * (page count, image dimensions, audio duration), not "understanding" the
 * file. Real content understanding (OCR, transcription, summarization) is
 * Phase 4/5 and explicitly out of scope here.
 *
 * Failures here are non-fatal to the upload — a Material still becomes
 * READY without metadata if extraction fails; see the "complete" route.
 */
export async function extractMetadata(
  type: MaterialType,
  buffer: Buffer
): Promise<ExtractedMetadata> {
  try {
    if (type === "IMAGE") {
      const dimensions = imageSize(buffer);
      return { width: dimensions.width, height: dimensions.height };
    }

    if (type === "PDF") {
      const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return { pageCount: doc.getPageCount() };
    }

    if (type === "AUDIO" || type === "VIDEO") {
      const parsed = await parseBuffer(buffer);
      return { durationSeconds: parsed.format.duration ? Math.round(parsed.format.duration) : undefined };
    }

    return {};
  } catch (err) {
    return { extractionError: err instanceof Error ? err.message : "Unknown extraction error" };
  }
}
