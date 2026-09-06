import { describe, expect, it } from "vitest";
import { classifyGoogleFile } from "@/lib/google-file-classifier";

describe("classifyGoogleFile", () => {
  it("classifies a native Google Doc as google_doc", () => {
    expect(classifyGoogleFile("application/vnd.google-apps.document")).toEqual({ kind: "google_doc" });
  });

  it("classifies a PDF as the concrete PDF material type", () => {
    expect(classifyGoogleFile("application/pdf")).toEqual({ kind: "concrete", materialType: "PDF" });
  });

  it("classifies a plain-text file as the concrete TEXT material type", () => {
    expect(classifyGoogleFile("text/plain")).toEqual({ kind: "concrete", materialType: "TEXT" });
  });

  it("classifies an image as the concrete IMAGE material type", () => {
    expect(classifyGoogleFile("image/png")).toEqual({ kind: "concrete", materialType: "IMAGE" });
  });

  it("classifies audio as the concrete AUDIO material type (transcribable like an upload)", () => {
    expect(classifyGoogleFile("audio/mpeg")).toEqual({ kind: "concrete", materialType: "AUDIO" });
  });

  it("marks native Google Sheets as unsupported with a clear reason", () => {
    const result = classifyGoogleFile("application/vnd.google-apps.spreadsheet");
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") expect(result.reason).toMatch(/sheets/i);
  });

  it("marks native Google Slides as unsupported with a clear reason", () => {
    const result = classifyGoogleFile("application/vnd.google-apps.presentation");
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") expect(result.reason).toMatch(/slides/i);
  });

  it("marks folders as unsupported", () => {
    const result = classifyGoogleFile("application/vnd.google-apps.folder");
    expect(result.kind).toBe("unsupported");
  });

  it("falls back to the generic GOOGLE_DRIVE_FILE type for an unrecognized binary MIME type", () => {
    expect(classifyGoogleFile("application/x-some-unknown-format")).toEqual({
      kind: "concrete",
      materialType: "GOOGLE_DRIVE_FILE",
    });
  });
});
