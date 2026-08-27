import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, getMaterialIcon, getMaterialLabel } from "@/lib/material-style";

describe("formatBytes", () => {
  it("formats bytes, KB, MB, GB appropriately", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });

  it("returns a placeholder for null/zero", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("formats seconds as m:ss under an hour", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(9)).toBe("0:09");
  });

  it("formats hours as h:mm:ss", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("returns a placeholder for null/zero", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("—");
  });

  it("returns a placeholder for non-finite values", () => {
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });
});

describe("getMaterialIcon / getMaterialLabel", () => {
  it("returns a real icon and label for every known type", () => {
    const types = ["PDF", "DOCX", "PPTX", "TEXT", "IMAGE", "AUDIO", "VIDEO", "LINK"] as const;
    for (const type of types) {
      expect(getMaterialIcon(type)).toBeDefined();
      expect(getMaterialLabel(type)).toBeTruthy();
    }
  });

  it("labels AUDIO and VIDEO distinctly", () => {
    expect(getMaterialLabel("AUDIO")).toBe("Audio");
    expect(getMaterialLabel("VIDEO")).toBe("Video");
  });
});
