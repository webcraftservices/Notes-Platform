/**
 * Parses a single-range `Range` request header per RFC 7233 §2.1.
 *
 * The previous implementation in `/api/storage/read` only handled two of
 * the three valid forms (`bytes=X-Y` and `bytes=X-`) via
 * `/bytes=(\d+)-(\d*)/`, which requires a leading digit before the dash.
 * It silently failed to match the third valid form — the *suffix* range
 * `bytes=-N` ("give me the last N bytes"), which has NO leading start
 * offset — and on a failed match fell back to treating the request as the
 * *entire file*, while still responding 206 with a `Content-Range` header
 * describing the whole file. That response doesn't match what was
 * actually requested, which is invalid per spec and was confirmed (via
 * code inspection, since this sandbox has no real browser to reproduce
 * against) to be exactly the kind of malformed response that makes
 * Chromium's media pipeline abort a load outright rather than degrade
 * gracefully.
 *
 * This matters specifically for old audio recordings: browsers issue a
 * suffix-range request to locate trailing container metadata (Cues, a
 * resolved Duration) when a WebM file's own header doesn't already state
 * a finite duration — which is true for every recording made before the
 * `webm-duration-fix` finalization step existed, and never true for
 * recordings made after, since those already ship a finite Duration and
 * never need to be probed this way. That's why this bug was invisible for
 * new recordings and only breaks old ones.
 *
 * Returns `null` if the header is absent, malformed, or unsatisfiable
 * (e.g. a start at/after the end of the file) — callers should treat a
 * `null` result the same as "no Range header was sent" (serve the whole
 * file with 200), which is a safe, spec-tolerant fallback rather than
 * sending a mislabeled 206.
 *
 * This is a thin, behavior-preserving wrapper around `resolveRangeHeader`
 * below — every case that used to return `null` here still does. Kept
 * only because `LocalStorageService`'s branch of the storage-read route
 * (and this function's existing tests) already depend on exactly this
 * two-valued (`{start,end}` | `null`) shape.
 */
export function parseRangeHeader(
  rangeHeader: string | null | undefined,
  fileSize: number
): { start: number; end: number } | null {
  const resolved = resolveRangeHeader(rangeHeader, fileSize);
  return resolved.kind === "satisfiable" ? { start: resolved.start, end: resolved.end } : null;
}

/**
 * Phase 9.5 correction — `parseRangeHeader` above collapses two genuinely
 * different situations into the same `null`: no/malformed Range header
 * (§ "serve the whole file, 200" is the correct, spec-tolerant response),
 * and a syntactically valid Range whose start is at/beyond the resource's
 * actual size (RFC 7233 §4.4: this is `416 Range Not Satisfiable`, NOT a
 * request for the whole file). The storage-read route's S3 branch used to
 * treat both identically and silently served — and, worse, fully
 * downloaded — the entire object for a request like `bytes=999999999-`.
 *
 * `resolveRangeHeader` keeps `parseRangeHeader`'s parsing logic
 * unchanged (so its existing behavior/tests are untouched) but reports
 * which of the three cases actually happened, so a caller that needs to
 * respond `416` (only the S3 branch does, currently) can tell "absent/
 * malformed → 200 whole file" apart from "out of range → 416" — a
 * distinction genuinely only meaningful for that RFC 7233 failure mode,
 * not for a header that was never a range request to begin with.
 *
 * `kind: "unsatisfiable"` is reported ONLY for a syntactically valid
 * range whose resolved start is at/beyond `fileSize` — not for a
 * malformed header (still `"none"`, matching `parseRangeHeader`'s
 * existing, tested "malformed → treat as absent" behavior) and not for
 * `start > end` (also `"none"` — that's invalid range syntax, which RFC
 * 7233 treats differently from an out-of-bounds-but-well-formed range; a
 * client sending a syntactically-broken header gets the safe full-file
 * fallback, same as always, not a 416 aimed at a bug it didn't make). A
 * suffix range longer than the file (e.g. `bytes=-5000` on a 1000-byte
 * file) is clamped to the whole file, exactly as before — that's a valid,
 * satisfiable request for "everything", not an out-of-bounds one.
 */
export type RangeResolution =
  | { kind: "none" }
  | { kind: "satisfiable"; start: number; end: number }
  | { kind: "unsatisfiable" };

export function resolveRangeHeader(rangeHeader: string | null | undefined, fileSize: number): RangeResolution {
  if (!rangeHeader || fileSize <= 0) return { kind: "none" };

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return { kind: "none" };

  // See parseRangeHeader's comment above for why `?? ""` here is purely
  // to satisfy noUncheckedIndexedAccess, not a real runtime possibility.
  const startStr = match[1] ?? "";
  const endStr = match[2] ?? "";
  if (startStr === "" && endStr === "") return { kind: "none" }; // "bytes=-" — not valid

  let start: number;
  let end: number;

  if (startStr === "") {
    // Suffix range: "bytes=-N" — the last N bytes of the resource.
    const suffixLength = parseInt(endStr, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { kind: "none" };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? fileSize - 1 : parseInt(endStr, 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) return { kind: "none" };

  // Checked BEFORE `start > end`: an open-ended range (`bytes=N-`) or a
  // suffix range whose `start` lands past the end of the resource always
  // resolves `end` to (at most) `fileSize - 1`, so an out-of-bounds
  // `start` — e.g. `bytes=999999999-` against a 1000-byte object — makes
  // `start > end` trivially true too. Checking bounds first is what
  // correctly reports that case as `"unsatisfiable"` (RFC 7233 §4.4)
  // rather than misclassifying it as a malformed/absent header.
  if (start >= fileSize) return { kind: "unsatisfiable" };

  // Reached only once `start` is confirmed in-bounds — an explicit range
  // like `bytes=500-100` (start after end, both otherwise in-bounds) is
  // invalid range *syntax*, not an out-of-bounds request, so it stays
  // `"none"` (safe full-file fallback) rather than `416`.
  if (start > end) return { kind: "none" };

  end = Math.min(end, fileSize - 1);
  return { kind: "satisfiable", start, end };
}
