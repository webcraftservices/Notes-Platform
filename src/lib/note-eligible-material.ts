import type { Material } from "@prisma/client";

export interface NoteEligibleMaterial {
  id: string;
  title: string;
  type: Material["type"];
  isReady: boolean;
  isProcessing: boolean;
}

export interface BuildNoteEligibleMaterialsInput {
  materials: Pick<Material, "id" | "title" | "type">[];
  transcriptByMaterial: Map<string, string>;
  latestJobByMaterial: Map<string, { status: string }>;
  readyDocIdSet: Set<string>;
  processingDocIdSet: Set<string>;
}

/**
 * Pure helper to build the unified note-eligible materials list.
 * Audio/video readiness is derived from a READY transcript.
 * Document readiness is derived from non-empty extracted text (readiness takes precedence over active jobs).
 * Unsupported material types are excluded.
 *
 * This function is intentionally pure and free of React, browser, or UI dependencies,
 * making it safe for direct invocation in Server Components without pulling Client Component
 * bundles across the RSC boundary.
 */
export function buildNoteEligibleMaterials({
  materials,
  transcriptByMaterial,
  latestJobByMaterial,
  readyDocIdSet,
  processingDocIdSet,
}: BuildNoteEligibleMaterialsInput): NoteEligibleMaterial[] {
  const result: NoteEligibleMaterial[] = [];

  for (const m of materials) {
    if (m.type === "AUDIO" || m.type === "VIDEO") {
      const isReady = transcriptByMaterial.get(m.id) === "READY";
      const jobStatus = latestJobByMaterial.get(m.id)?.status;
      const isProcessing = !isReady && (jobStatus === "QUEUED" || jobStatus === "RUNNING");
      if (isReady || isProcessing) {
        result.push({
          id: m.id,
          title: m.title,
          type: m.type,
          isReady,
          isProcessing,
        });
      }
    } else if (
      m.type === "PDF" ||
      m.type === "DOCX" ||
      m.type === "PPTX" ||
      m.type === "GOOGLE_DOC"
    ) {
      const isReady = readyDocIdSet.has(m.id);
      // Readiness takes precedence if an active job happens to be stale
      const isProcessing = !isReady && processingDocIdSet.has(m.id);
      if (isReady || isProcessing) {
        result.push({
          id: m.id,
          title: m.title,
          type: m.type,
          isReady,
          isProcessing,
        });
      }
    }
  }

  return result;
}

