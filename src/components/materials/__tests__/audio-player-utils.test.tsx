import { describe, expect, it } from "vitest";
import { computeSafeProgress, getPlaybackLabel, getMuteLabel } from "@/components/materials/audio-player";

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

// Phase 9.7 — P1 audit finding: play/pause and mute buttons must expose an
// accessible name that updates with playback/mute state.
describe("getPlaybackLabel", () => {
  it('exposes "Play" when not playing', () => {
    expect(getPlaybackLabel(false)).toBe("Play");
  });

  it('exposes "Pause" when playing', () => {
    expect(getPlaybackLabel(true)).toBe("Pause");
  });
});

describe("getMuteLabel", () => {
  it('exposes "Mute" when unmuted with audible volume', () => {
    expect(getMuteLabel(false, 1)).toBe("Mute");
  });

  it('exposes "Unmute" when muted', () => {
    expect(getMuteLabel(true, 1)).toBe("Unmute");
  });

  it('exposes "Unmute" when volume is 0 even if not explicitly muted, matching the icon shown', () => {
    expect(getMuteLabel(false, 0)).toBe("Unmute");
  });
});
