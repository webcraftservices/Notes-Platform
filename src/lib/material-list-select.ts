import type { Prisma } from "@prisma/client";

/**
 * Phase 9.5 — the fields every material *list* view (materials cards on
 * the Materials/Subject/Chapter/Topic/Group pages, the dashboard's recent
 * materials, and the GET /api/materials list endpoint) actually renders:
 * an icon, title, type, size, duration, status, and the archived badge —
 * see MaterialCard and MaterialActionsMenu.
 *
 * `Material.extractedText` (`@db.Text`) and `Material.extractedPages`
 * (`Json`) are the two largest, unbounded columns on this model — a
 * single PDF/DOCX/PPTX can populate them with the document's entire
 * extracted text. No list view reads either field (only the single-item
 * material detail route/page and the Google Doc viewer do, which is why
 * this is a *list*-only select and single-item reads are untouched). A
 * plain `findMany()` without a `select` still returns every column, so
 * every list of up to hundreds of materials was fetching, deserializing,
 * and — for the API route — reserializing to JSON the full text of every
 * document in the list, none of which the response ever used.
 *
 * Kept as an explicit `select` (not `omit`) so a column added to the
 * schema later is excluded from list views by default unless someone
 * deliberately adds it here — the safer default for a column that could
 * turn out to be large.
 */
export const MATERIAL_LIST_SELECT = {
  id: true,
  ownerId: true,
  workspaceId: true,
  subjectId: true,
  chapterId: true,
  topicId: true,
  groupId: true,
  type: true,
  title: true,
  originalFilename: true,
  storageKey: true,
  externalRef: true,
  sourceUrl: true,
  mimeType: true,
  sizeBytes: true,
  durationSeconds: true,
  status: true,
  visibility: true,
  tags: true,
  metadata: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.MaterialSelect;

/** The shape returned by any query using MATERIAL_LIST_SELECT above. */
export type MaterialListItem = Prisma.MaterialGetPayload<{ select: typeof MATERIAL_LIST_SELECT }>;
