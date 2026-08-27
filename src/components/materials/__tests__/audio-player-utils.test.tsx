import { describe, expect, it } from "vitest";
import { computeSafeProgress } from "@/components/materials/audio-player";

describe("computeSafeProgress", () => {
  it("returns 0 for invalid inputs", () => {
    expect(computeSafeProgress(NaN, 10)).toBe(0);
    expect(computeSafeProgress(5, NaN)).toBe(0);
    expect(computeSafeProgress(5, 0)).toBe(0);
    expect(computeSafeProgress(5, -1)).toBe(0);
  });

  it("calculates midpoint correctly", () => {
    expect(computeSafeProgress(5, 10)).toBeCloseTo(0.5);
  });

  it("clamps to 1 when currentTime > duration", () => {
    expect(computeSafeProgress(15, 10)).toBe(1);
  });

  it("clamps to 0 when currentTime < 0", () => {
    expect(computeSafeProgress(-1, 10)).toBe(0);
  });
});
