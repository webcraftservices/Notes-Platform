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
 */
export function parseRangeHeader(
  rangeHeader: string | null | undefined,
  fileSize: number
): { start: number; end: number } | null {
  if (!rangeHeader || fileSize <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  // match[1]/match[2] are always real strings at runtime when the regex
  // matches at all — both groups are `(\d*)`, which matches even an empty
  // string, so they can never actually be `undefined` here. The `?? ""`
  // is purely to satisfy this repo's `noUncheckedIndexedAccess: true`
  // tsconfig setting, which types any array/tuple index access (including
  // RegExpExecArray, since it extends Array<string>) as possibly
  // `undefined` regardless of what the regex actually guarantees.
  const startStr = match[1] ?? "";
  const endStr = match[2] ?? "";
  if (startStr === "" && endStr === "") return null; // "bytes=-" — not valid

  let start: number;
  let end: number;

  if (startStr === "") {
    // Suffix range: "bytes=-N" — the last N bytes of the resource.
    const suffixLength = parseInt(endStr, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? fileSize - 1 : parseInt(endStr, 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end) return null;
  if (start >= fileSize) return null; // unsatisfiable

  end = Math.min(end, fileSize - 1);
  return { start, end };
}
