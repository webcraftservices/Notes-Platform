import { z } from "zod";
import { rejectPrototypePollution } from "@/lib/validation/safe-json";

export const NOTE_BLOCK_KINDS = [
  "OVERVIEW",
  "DEFINITION",
  "CORE_CONCEPT",
  "EXPLANATION",
  "IMPORTANT_POINTS",
  "EXAMPLE",
  "FORMULA",
  "DERIVATION",
  "APPLICATION",
  "COMMON_MISTAKE",
  "EXAM_IMPORTANT",
  "QUESTION",
  "REFERENCE",
  "SUMMARY",
  "AGENDA",
  "DECISION",
  "ACTION_ITEM",
  "CUSTOM",
] as const;

const baseMetadataSchema = z
  .object({
    materialId: z.string().trim().min(1).max(100).optional(),
    materialTitle: z.string().trim().max(500).optional(),
    materialType: z.string().trim().max(50).optional(),
    sourceUnitType: z.enum(["page", "slide"]).optional(),
    pageNumber: z.number().int().positive().optional(),
    sourcePages: z.array(z.number().int().positive()).max(200).optional(),
  })
  .passthrough();

export const noteBlockMetadataSchema = rejectPrototypePollution(z.record(z.any())).pipe(baseMetadataSchema);

export const noteBlockSchema = z.object({
  // A client-generated id (nanoid) — present for both existing and
  // brand-new blocks so the bulk-save endpoint can diff against what's
  // in the database without a separate create/update/delete API per block.
  id: z.string().min(1),
  kind: z.enum(NOTE_BLOCK_KINDS),
  heading: z.string().trim().max(200).nullable().optional(),
  // Tiptap/ProseMirror JSON document — validated only as "is an object" at
  // this layer; Tiptap itself is the source of truth for document shape.
  // Phase 9.3: additionally rejects __proto__/constructor/prototype keys
  // anywhere in the structure — see lib/validation/safe-json.ts for why.
  content: rejectPrototypePollution(z.record(z.any())),
  order: z.number().int().min(0),
  metadata: noteBlockMetadataSchema.nullable().optional(),
});

export const saveBlocksSchema = z.object({
  blocks: z.array(noteBlockSchema).max(200),
});

export const updateNoteSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export type NoteBlockInput = z.infer<typeof noteBlockSchema>;
export type SaveBlocksInput = z.infer<typeof saveBlocksSchema>;
