import { describe, expect, it } from "vitest";
import { MATERIAL_LIST_SELECT } from "@/lib/material-list-select";

describe("MATERIAL_LIST_SELECT — Phase 9.5", () => {
  it("never selects the two large, unbounded Material columns (extractedText, extractedPages)", () => {
    // Regression guard: these are the columns that made every material list
    // query fetch/serialize a document's entire extracted text for free.
    expect(MATERIAL_LIST_SELECT).not.toHaveProperty("extractedText");
    expect(MATERIAL_LIST_SELECT).not.toHaveProperty("extractedPages");
  });

  it("still selects every field MaterialCard/MaterialActionsMenu actually render", () => {
    const required = [
      "id", "type", "title", "sizeBytes", "durationSeconds", "status", "archivedAt",
      "ownerId", "workspaceId", "subjectId", "chapterId", "topicId", "groupId", "createdAt",
    ] as const;
    for (const field of required) {
      expect(MATERIAL_LIST_SELECT).toHaveProperty(field, true);
    }
  });
});
