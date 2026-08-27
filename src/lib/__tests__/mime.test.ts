import { describe, expect, it } from "vitest";
import { resolveMaterialType, guessExtension } from "@/lib/mime";

describe("mime utilities", () => {
  it("recognizes audio/webm;codecs=opus as AUDIO", () => {
    expect(resolveMaterialType("audio/webm;codecs=opus")).toBe("AUDIO");
  });

  it("recognizes audio/webm; codecs=opus (with space) as AUDIO", () => {
    expect(resolveMaterialType("audio/webm; codecs=opus")).toBe("AUDIO");
  });

  it("guessExtension returns webm for audio/webm;codecs=opus", () => {
    expect(guessExtension("audio/webm;codecs=opus")).toBe("webm");
  });

  it("works for plain audio/webm", () => {
    expect(resolveMaterialType("audio/webm")).toBe("AUDIO");
    expect(guessExtension("audio/webm")).toBe("webm");
  });
});
