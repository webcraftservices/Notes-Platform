import { describe, expect, it } from "vitest";
import { importGoogleFileSchema, listGoogleFilesQuerySchema } from "@/lib/validation/google";

describe("importGoogleFileSchema", () => {
  const base = {
    fileId: "1a2b3c",
    name: "Lecture Notes",
    mimeType: "application/pdf",
  };

  it("accepts a minimal valid payload", () => {
    expect(importGoogleFileSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an optional scope + force flag", () => {
    const result = importGoogleFileSchema.safeParse({
      ...base,
      topicId: "clh1234567890123456789012",
      force: true,
      webViewLink: "https://drive.google.com/file/d/1a2b3c/view",
      modifiedTime: "2026-09-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing fileId", () => {
    const { fileId: _fileId, ...rest } = base;
    expect(importGoogleFileSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(importGoogleFileSchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("rejects a malformed webViewLink", () => {
    expect(importGoogleFileSchema.safeParse({ ...base, webViewLink: "not-a-url" }).success).toBe(false);
  });

  it("rejects a non-cuid subjectId", () => {
    expect(importGoogleFileSchema.safeParse({ ...base, subjectId: "not-a-cuid" }).success).toBe(false);
  });
});

describe("listGoogleFilesQuerySchema", () => {
  it("accepts an empty query", () => {
    expect(listGoogleFilesQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts a search string and page token", () => {
    expect(listGoogleFilesQuerySchema.safeParse({ q: "thermodynamics", pageToken: "abc" }).success).toBe(true);
  });

  it("rejects an overly long search string", () => {
    expect(listGoogleFilesQuerySchema.safeParse({ q: "a".repeat(500) }).success).toBe(false);
  });
});
