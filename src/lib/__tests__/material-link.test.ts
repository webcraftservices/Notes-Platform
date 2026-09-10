import { describe, expect, it } from "vitest";
import { materialSourceHref, materialSourceAriaLabel } from "@/lib/material-link";

describe("materialSourceHref", () => {
  it("links a material-only source (no page, no timestamp) to the bare material page", () => {
    expect(materialSourceHref({ materialId: "mat_1", label: "Syllabus.docx" })).toBe("/materials/mat_1");
  });

  it("links a PDF/page source to the material page with a page query param", () => {
    expect(materialSourceHref({ materialId: "mat_pdf", label: "Thermodynamics.pdf — Page 8", page: 8 })).toBe(
      "/materials/mat_pdf?page=8"
    );
  });

  it("links an audio/video/timestamp source to the material page with a t query param", () => {
    expect(materialSourceHref({ materialId: "mat_audio", label: "Lecture 12 — 12:45", timestampSeconds: 765 })).toBe(
      "/materials/mat_audio?t=765"
    );
  });

  it("floors a fractional timestamp rather than producing a non-integer query param", () => {
    expect(materialSourceHref({ materialId: "mat_audio", label: "x", timestampSeconds: 12.9 })).toBe(
      "/materials/mat_audio?t=12"
    );
  });

  it("floors a fractional page number", () => {
    expect(materialSourceHref({ materialId: "mat_pdf", label: "x", page: 8.9 })).toBe("/materials/mat_pdf?page=8");
  });

  it("prefers page over timestampSeconds if a source somehow has both", () => {
    expect(materialSourceHref({ materialId: "mat_1", label: "x", page: 3, timestampSeconds: 90 })).toBe(
      "/materials/mat_1?page=3"
    );
  });

  it("ignores a page of 0 or negative and falls back to the bare material page", () => {
    expect(materialSourceHref({ materialId: "mat_1", label: "x", page: 0 })).toBe("/materials/mat_1");
    expect(materialSourceHref({ materialId: "mat_1", label: "x", page: -1 })).toBe("/materials/mat_1");
  });

  it("treats a timestamp of exactly 0 as valid (the very start of the recording)", () => {
    expect(materialSourceHref({ materialId: "mat_1", label: "x", timestampSeconds: 0 })).toBe("/materials/mat_1?t=0");
  });

  it("ignores a negative timestamp and falls back to the bare material page", () => {
    expect(materialSourceHref({ materialId: "mat_1", label: "x", timestampSeconds: -5 })).toBe("/materials/mat_1");
  });

  it("URL-encodes an unusual materialId rather than injecting it raw into the path", () => {
    expect(materialSourceHref({ materialId: "weird id/with?chars", label: "x" })).toBe(
      "/materials/weird%20id%2Fwith%3Fchars"
    );
  });
});

describe("materialSourceAriaLabel", () => {
  it("prefixes the citation label with an explicit 'Open source' verb for screen readers", () => {
    expect(materialSourceAriaLabel({ label: "Thermodynamics.pdf — Page 8" })).toBe(
      "Open source: Thermodynamics.pdf — Page 8"
    );
  });
});
