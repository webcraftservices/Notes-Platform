import { describe, expect, it } from "vitest";
import {
  requestUploadSchema,
  createLinkMaterialSchema,
  updateMaterialSchema,
} from "@/lib/validation/materials";
import { noteBlockSchema, saveBlocksSchema, updateNoteSchema } from "@/lib/validation/notes";
import { resolveMaterialType, guessExtension } from "@/lib/mime";

describe("requestUploadSchema", () => {
  it("accepts a minimal valid upload request", () => {
    const result = requestUploadSchema.safeParse({
      filename: "lecture.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative size", () => {
    expect(
      requestUploadSchema.safeParse({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 0 })
        .success
    ).toBe(false);
    expect(
      requestUploadSchema.safeParse({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes: -5 })
        .success
    ).toBe(false);
  });

  it("rejects a missing filename", () => {
    expect(
      requestUploadSchema.safeParse({ mimeType: "application/pdf", sizeBytes: 10 }).success
    ).toBe(false);
  });

  it("accepts an optional scope id", () => {
    const result = requestUploadSchema.safeParse({
      filename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      topicId: "clv1a2b3c0000abcdefghijk",
    });
    expect(result.success).toBe(true);
  });
});

describe("createLinkMaterialSchema", () => {
  it("accepts a valid link", () => {
    expect(
      createLinkMaterialSchema.safeParse({ title: "Syllabus", url: "https://example.com" }).success
    ).toBe(true);
  });

  it("rejects an invalid URL", () => {
    expect(createLinkMaterialSchema.safeParse({ title: "Syllabus", url: "not-a-url" }).success).toBe(
      false
    );
  });

  it("rejects an empty title", () => {
    expect(
      createLinkMaterialSchema.safeParse({ title: "", url: "https://example.com" }).success
    ).toBe(false);
  });
});

describe("updateMaterialSchema", () => {
  it("allows an archive-only patch", () => {
    expect(updateMaterialSchema.safeParse({ archived: true }).success).toBe(true);
  });

  it("allows detaching via null scope fields", () => {
    expect(
      updateMaterialSchema.safeParse({ subjectId: null, chapterId: null, topicId: null }).success
    ).toBe(true);
  });

  it("rejects more than 20 tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    expect(updateMaterialSchema.safeParse({ tags }).success).toBe(false);
  });
});

describe("mime resolution", () => {
  it("maps known mime types to a MaterialType", () => {
    expect(resolveMaterialType("application/pdf")).toBe("PDF");
    expect(resolveMaterialType("image/png")).toBe("IMAGE");
    expect(resolveMaterialType("audio/mpeg")).toBe("AUDIO");
  });

  it("returns null for unknown mime types", () => {
    expect(resolveMaterialType("application/x-nonsense")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(resolveMaterialType("APPLICATION/PDF")).toBe("PDF");
  });

  it("guesses a sane extension for known types", () => {
    expect(guessExtension("application/pdf")).toBe("pdf");
    expect(guessExtension("image/png")).toBe("png");
  });

  it("falls back to bin for unknown types", () => {
    expect(guessExtension("application/x-nonsense")).toBe("bin");
  });
});

describe("noteBlockSchema / saveBlocksSchema", () => {
  const validBlock = {
    id: "tmp-abc123",
    kind: "OVERVIEW",
    heading: "Intro",
    content: { type: "doc", content: [] },
    order: 0,
  };

  it("accepts a valid block", () => {
    expect(noteBlockSchema.safeParse(validBlock).success).toBe(true);
  });

  it("rejects an invalid kind", () => {
    expect(noteBlockSchema.safeParse({ ...validBlock, kind: "NOT_A_KIND" }).success).toBe(false);
  });

  it("rejects a negative order", () => {
    expect(noteBlockSchema.safeParse({ ...validBlock, order: -1 }).success).toBe(false);
  });

  it("accepts a full blocks array", () => {
    expect(saveBlocksSchema.safeParse({ blocks: [validBlock] }).success).toBe(true);
  });

  it("rejects more than 200 blocks", () => {
    const blocks = Array.from({ length: 201 }, (_, i) => ({ ...validBlock, id: `b${i}`, order: i }));
    expect(saveBlocksSchema.safeParse({ blocks }).success).toBe(false);
  });
});

describe("updateNoteSchema", () => {
  it("accepts a title update", () => {
    expect(updateNoteSchema.safeParse({ title: "Zeroth Law" }).success).toBe(true);
  });

  it("rejects an empty title", () => {
    expect(updateNoteSchema.safeParse({ title: "" }).success).toBe(false);
  });
});
