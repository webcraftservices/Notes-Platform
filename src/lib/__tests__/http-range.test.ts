import { describe, expect, it } from "vitest";
import { parseRangeHeader, resolveRangeHeader } from "@/lib/http-range";

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

describe("resolveRangeHeader — Phase 9.5 correction", () => {
  it("reports 'none' for no header, and parseRangeHeader still returns null for it", () => {
    expect(resolveRangeHeader(null, 1000)).toEqual({ kind: "none" });
    expect(resolveRangeHeader(undefined, 1000)).toEqual({ kind: "none" });
  });

  it("reports 'satisfiable' with the resolved bounds for a normal range", () => {
    expect(resolveRangeHeader("bytes=0-499", 1000)).toEqual({ kind: "satisfiable", start: 0, end: 499 });
  });

  it("reports 'unsatisfiable' — not 'none' — when the range starts at or beyond the resource size", () => {
    expect(resolveRangeHeader("bytes=1000-1500", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(resolveRangeHeader("bytes=2000-", 1000)).toEqual({ kind: "unsatisfiable" });
    // The exact case this correction was written for: a huge open-ended
    // start used to make `start > end` trivially true and get misread as
    // a malformed header rather than an out-of-bounds one.
    expect(resolveRangeHeader("bytes=999999999-", 1000)).toEqual({ kind: "unsatisfiable" });
  });

  it("still reports 'none' (not 'unsatisfiable') for genuinely malformed range syntax", () => {
    expect(resolveRangeHeader("bytes=500-100", 1000)).toEqual({ kind: "none" }); // start after end, both in-bounds
    expect(resolveRangeHeader("not-a-range", 1000)).toEqual({ kind: "none" });
    expect(resolveRangeHeader("bytes=", 1000)).toEqual({ kind: "none" });
  });

  it("still clamps an oversized suffix range to the whole file — that's satisfiable, not unsatisfiable", () => {
    expect(resolveRangeHeader("bytes=-5000", 1000)).toEqual({ kind: "satisfiable", start: 0, end: 999 });
  });

  it("agrees with parseRangeHeader on every case: satisfiable maps to {start,end}, everything else maps to null", () => {
    const cases = ["bytes=0-499", "bytes=500-", "bytes=-100", "bytes=1000-1500", "bytes=999999999-", "not-a-range", ""];
    for (const header of cases) {
      const resolved = resolveRangeHeader(header, 1000);
      const parsed = parseRangeHeader(header, 1000);
      if (resolved.kind === "satisfiable") {
        expect(parsed).toEqual({ start: resolved.start, end: resolved.end });
      } else {
        expect(parsed).toBeNull();
      }
    }
  });
});
