import { describe, expect, it } from "vitest";
import { classifyGoogleFile } from "../google-file-classifier";

describe("classifyGoogleFile", () => {
  it("routes native Google Docs to the Docs export path", () => {
    expect(classifyGoogleFile("application/vnd.google-apps.document")).toEqual({
      kind: "google_doc",
    });
  });

  it("routes native Google Slides to the native Google Slides v1 parser path (Phase 14)", () => {
    expect(classifyGoogleFile("application/vnd.google-apps.presentation")).toEqual({
      kind: "google_slides",
    });
  });

  it.each([
    ["application/pdf", "PDF"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "DOCX"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "PPTX"],
    ["text/plain", "TEXT"],
    ["text/markdown", "TEXT"],
    ["image/png", "IMAGE"],
    ["audio/mpeg", "AUDIO"],
    ["video/mp4", "VIDEO"],
  ] as const)("maps accepted MIME %s to concrete MaterialType %s", (mimeType, expected) => {
    expect(classifyGoogleFile(mimeType)).toEqual({
      kind: "concrete",
      materialType: expected,
    });
  });

  it.each([
    ["application/vnd.google-apps.spreadsheet", "Google Sheets"],
    ["application/vnd.google-apps.form", "Google Forms"],
    ["application/vnd.google-apps.drawing", "Google Drawings"],
    ["application/vnd.google-apps.folder", "Folders"],
    ["application/vnd.google-apps.shortcut", "Shortcuts"],
  ])("rejects unsupported Google-native MIME %s with a specific reason mentioning %s", (mimeType, label) => {
    const result = classifyGoogleFile(mimeType);
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain(label);
    }
  });

  it("falls back to GOOGLE_DRIVE_FILE for arbitrary binary MIME types so real bytes still import", () => {
    expect(classifyGoogleFile("application/zip")).toEqual({
      kind: "concrete",
      materialType: "GOOGLE_DRIVE_FILE",
    });
    expect(classifyGoogleFile("application/octet-stream")).toEqual({
      kind: "concrete",
      materialType: "GOOGLE_DRIVE_FILE",
    });
  });
});
