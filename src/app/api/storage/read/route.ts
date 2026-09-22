import { NextResponse } from "next/server";
import { getAccessibleMaterialByStorageKey, getSessionUser, NotAuthorizedError } from "@/lib/access";
import { getStorageService } from "@/lib/services/storage";
import { LocalStorageService } from "@/lib/services/storage-local";
import { S3StorageService } from "@/lib/services/storage-s3";
import { parseRangeHeader, resolveRangeHeader } from "@/lib/http-range";
import { jsonError, logServerError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN, INTERNAL_ERROR } from "@/lib/api-response";
import { isS3NotFoundError } from "@/lib/services/storage-s3";

/**
 * Proxies both the local storage backend AND non-local backends (e.g. S3)
 * — see PROJECT_STATE.md "Recent work completed" for when that was
 * extended beyond just local. Every request re-checks that the signed-in
 * user can actually access the Material that owns this key (owner, or
 * same workspace/group) — there is no separate token scheme layered on
 * top because the session cookie is already the correct authorization
 * check the rest of the app uses (see lib/access.ts).
 *
 * Supports HTTP Range requests so <audio>/<video> elements can seek and
 * PDF viewers can fetch byte ranges, instead of always downloading the
 * whole file. Range parsing lives in lib/http-range.ts (unit tested) and
 * handles all three RFC 7233 forms, including the suffix form
 * (`bytes=-N`) that browsers use to probe for duration/seek metadata in
 * WebM files whose own header doesn't already state a finite duration —
 * see that file's doc comment for why getting this right specifically
 * matters for playing back old audio recordings.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return UNAUTHORIZED();

  const storage = getStorageService();

  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const download = searchParams.get("download") === "1";
  if (!key) return jsonError("Missing key.", 400);

  let material;
  try {
    material = await getAccessibleMaterialByStorageKey(key, user.id);
  } catch (err) {
    if (err instanceof NotAuthorizedError) return FORBIDDEN();
    throw err;
  }
  if (!material) return NOT_FOUND();

  const rangeHeader = req.headers.get("range");
  const contentType = material.mimeType ?? "application/octet-stream";
  const disposition = `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(
    material.originalFilename ?? material.title
  )}"`;

  // If we're backed by the local storage service, use the efficient local file APIs
  if (storage instanceof LocalStorageService) {
    let stats;
    try {
      stats = await storage.readFileStats(key);
    } catch {
      return jsonError("File not found in storage.", 404);
    }

    const fileSize = stats.size;
    const range = parseRangeHeader(rangeHeader, fileSize);

    if (range) {
      const { start, end } = range;
      const chunk = await storage.readFile(key, { start, end });

      return new NextResponse(new Uint8Array(chunk), {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunk.byteLength),
          "Content-Type": contentType,
          "Content-Disposition": disposition,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }

    const buffer = await storage.readFile(key);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Length": String(fileSize),
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  }

  // Otherwise, proxy the object from an S3-compatible backend. Same
  // same-origin/CORS rationale as the local branch above.
  if (storage instanceof S3StorageService) {
    // Phase 9.5: previously this always called getObjectBuffer() — which
    // downloads the ENTIRE object into memory — and then sliced the
    // requested range out of that buffer in JS, even for a 2-byte probe
    // range against a multi-hundred-MB lecture recording (every <audio>/
    // <video> seek, and the suffix-range duration probe documented in
    // lib/http-range.ts, triggered exactly this). A HEAD request (already
    // used by the upload-complete route) gets the real size cheaply, and
    // S3's own `Range` header (GetObjectCommand) fetches only the bytes
    // actually requested — the object is never buffered in full unless
    // the client genuinely asked for the whole file.
    //
    // Phase 9.5 correction (post-review): the two `catch` blocks below
    // used to collapse every failure — a genuinely missing object AND an
    // unrelated S3/network/provider failure — into the same 404, and both
    // logged the raw caught error with a bare console.error. Missing vs.
    // provider-failure now get their real status codes (404 vs 500,
    // matching the rest of the app's INTERNAL_ERROR convention), and any
    // failure that isn't a confirmed "object not found" goes through
    // logServerError — same structured, Datadog-forwarded, secrets-safe
    // logging every other route's unexpected-failure path already uses
    // (see lib/google-route-errors.ts for the identical pattern).
    let head;
    try {
      head = await storage.headObject(key);
    } catch (err) {
      logServerError({ route: "storage/read", op: "head-object", userId: user.id }, err);
      return INTERNAL_ERROR();
    }
    if (!head) return jsonError("File not found in storage.", 404);

    const fileSize = head.sizeBytes;

    // Phase 9.5 correction: parseRangeHeader() alone can't tell "no Range
    // header" apart from "a Range header that names bytes past the end of
    // the object" — both came back `null`, so a request like
    // `bytes=999999999-` was silently treated as "serve the whole file"
    // (200 OK), which not only violates RFC 7233 §4.4 (that case is
    // `416 Range Not Satisfiable`) but meant the exact case this Phase's
    // own fix was written to avoid — downloading a full object just to
    // answer a range probe — still happened for any out-of-bounds range.
    // resolveRangeHeader distinguishes the three cases explicitly; see its
    // doc comment in lib/http-range.ts for why "unsatisfiable" is scoped
    // narrowly to a well-formed, out-of-bounds range and nothing else.
    const resolved = resolveRangeHeader(rangeHeader, fileSize);

    if (resolved.kind === "unsatisfiable") {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const range = resolved.kind === "satisfiable" ? { start: resolved.start, end: resolved.end } : null;

    try {
      if (range) {
        const { start, end } = range;
        const slice = await storage.getObjectRange(key, { start, end });
        return new NextResponse(new Uint8Array(slice), {
          status: 206,
          headers: {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(slice.byteLength),
            "Content-Type": contentType,
            "Content-Disposition": disposition,
            "Cache-Control": "private, max-age=0, must-revalidate",
          },
        });
      }

      const fullBuffer = await storage.getObjectRange(key);
      return new NextResponse(new Uint8Array(fullBuffer), {
        status: 200,
        headers: {
          "Content-Length": String(fileSize),
          "Content-Type": contentType,
          "Content-Disposition": disposition,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    } catch (err) {
      // The object was just confirmed to exist via HEAD above, so a
      // NotFound here means it was deleted in the brief window between
      // that check and this GET — still a genuine "missing object" case,
      // not a provider failure. Anything else (5xx, timeout, network,
      // unexpected SDK error) is a real infrastructure failure and must
      // not be reported to the client as if the file simply doesn't exist.
      if (isS3NotFoundError(err)) return jsonError("File not found in storage.", 404);
      logServerError({ route: "storage/read", op: "get-object", userId: user.id }, err);
      return INTERNAL_ERROR();
    }
  }

  return jsonError("Storage backend is not recognized.", 500);
}
