import { describe, expect, it } from "vitest";
import { parseRangeHeader } from "@/lib/http-range";

describe("parseRangeHeader", () => {
  it("returns null when there is no Range header", () => {
    expect(parseRangeHeader(null, 1000)).toBeNull();
    expect(parseRangeHeader(undefined, 1000)).toBeNull();
    expect(parseRangeHeader("", 1000)).toBeNull();
  });

  it("parses a standard start-end range", () => {
    expect(parseRangeHeader("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 });
    expect(parseRangeHeader("bytes=500-999", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("parses a start-only range (to end of file)", () => {
    expect(parseRangeHeader("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("parses a suffix range (last N bytes) — the form that broke old recordings", () => {
    expect(parseRangeHeader("bytes=-500", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRangeHeader("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("clamps a suffix range larger than the file to the whole file", () => {
    expect(parseRangeHeader("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("clamps an end past the file size down to the last byte", () => {
    expect(parseRangeHeader("bytes=0-999999", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("returns null for a malformed header", () => {
    expect(parseRangeHeader("bytes=", 1000)).toBeNull();
    expect(parseRangeHeader("bytes=-", 1000)).toBeNull();
    expect(parseRangeHeader("not-a-range", 1000)).toBeNull();
    expect(parseRangeHeader("items=0-499", 1000)).toBeNull();
  });

  it("returns null for an unsatisfiable range (start beyond the file)", () => {
    expect(parseRangeHeader("bytes=1000-1500", 1000)).toBeNull();
    expect(parseRangeHeader("bytes=2000-", 1000)).toBeNull();
  });

  it("returns null when start is after end", () => {
    expect(parseRangeHeader("bytes=500-100", 1000)).toBeNull();
  });

  it("returns null for a non-positive file size", () => {
    expect(parseRangeHeader("bytes=0-10", 0)).toBeNull();
  });
});
