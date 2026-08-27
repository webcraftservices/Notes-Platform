export const NOTE_BLOCK_KIND_LABELS: Record<string, string> = {
  OVERVIEW: "Overview",
  DEFINITION: "Definition",
  CORE_CONCEPT: "Core Concept",
  EXPLANATION: "Explanation",
  IMPORTANT_POINTS: "Important Points",
  EXAMPLE: "Example",
  FORMULA: "Formula",
  DERIVATION: "Derivation",
  APPLICATION: "Application",
  COMMON_MISTAKE: "Common Mistake",
  EXAM_IMPORTANT: "Exam Important",
  QUESTION: "Question",
  REFERENCE: "Reference",
  SUMMARY: "Summary",
  AGENDA: "Agenda",
  DECISION: "Decision",
  ACTION_ITEM: "Action Item",
  CUSTOM: "Custom",
};

export const NOTE_BLOCK_KIND_ORDER = Object.keys(NOTE_BLOCK_KIND_LABELS);

export const EMPTY_TIPTAP_DOC = { type: "doc", content: [{ type: "paragraph" }] };
