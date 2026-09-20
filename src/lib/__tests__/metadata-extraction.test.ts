import { describe, expect, it } from "vitest";
import { extractMetadata } from "@/lib/metadata-extraction";

// A valid, minimal 1x1 PNG.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

/**
 * Phase 9.3: `image-size` and `music-metadata` were upgraded (1.1.1→2.0.4,
 * 10.6.4→11.15.0) to fix real, upstream-confirmed infinite-loop DoS
 * vulnerabilities (GHSA-w3rx-r6r6-pgpr / GHSA-5p2g-fcmc-qvqq for
 * image-size's ICNS/JXL/HEIF parsers — HEIC is one of this app's accepted
 * upload MIME types; GHSA-v6c2-xwv6-8xf7 for music-metadata's ASF
 * parser). Both run synchronously in the upload request path (see
 * lib/metadata-extraction.ts's own doc comment), so a hang here would
 * block the Node event loop for every user, not just the uploader.
 *
 * A malicious payload that triggers an infinite loop can't be exercised
 * as an automated regression test without an actual weaponized fixture
 * (which isn't something to construct or commit here) — an infinite loop
 * doesn't throw, so there's no exception to assert on; it would simply
 * hang the test runner. What these tests do verify is that the upgrade
 * didn't change the narrow API surface this file actually depends on:
 * normal files still extract correctly, and the existing malformed-input
 * fallback (this function already treats extraction failure as non-fatal
 * — see its doc comment) still works.
 */
describe("extractMetadata", () => {
  it("extracts width/height for a valid PNG", async () => {
    const result = await extractMetadata("IMAGE", PNG_1X1);
    expect(result).toEqual({ width: 1, height: 1 });
  });

  it("returns an extractionError (not a thrown exception) for a malformed image buffer", async () => {
    const result = await extractMetadata("IMAGE", Buffer.from("not an image"));
    expect(result.width).toBeUndefined();
    expect(typeof result.extractionError).toBe("string");
  });

  it("returns an extractionError (not a thrown exception) for a malformed audio buffer", async () => {
    const result = await extractMetadata("AUDIO", Buffer.from("not audio data"));
    expect(result.durationSeconds).toBeUndefined();
    expect(typeof result.extractionError).toBe("string");
  });

  it("returns an empty result for material types with no extraction logic (e.g. TEXT), never throwing", async () => {
    await expect(extractMetadata("TEXT", Buffer.from("hello"))).resolves.toEqual({});
  });
});
