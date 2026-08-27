import { NextResponse } from "next/server";
import { getAccessibleMaterialByStorageKey, getSessionUser, NotAuthorizedError } from "@/lib/access";
import { getStorageService } from "@/lib/services/storage";
import { LocalStorageService } from "@/lib/services/storage-local";
import { jsonError, UNAUTHORIZED, NOT_FOUND, FORBIDDEN } from "@/lib/api-response";

/**
 * Only meaningful for the local storage backend. Every request re-checks
 * that the signed-in user can actually access the Material that owns this
 * key (owner, or same workspace/group) — there is no separate token
 * scheme layered on top because the session cookie is already the correct
 * authorization check the rest of the app uses (see lib/access.ts).
 *
 * Supports HTTP Range requests so <audio>/<video> elements can seek and
 * PDF viewers can fetch byte ranges, instead of always downloading the
 * whole file.
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

    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      const start = match?.[1] ? parseInt(match[1], 10) : 0;
      const end = match?.[2] ? parseInt(match[2], 10) : fileSize - 1;
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

  // Otherwise, attempt to proxy the object from the configured backend (S3, etc.).
  // This keeps playback same-origin and avoids CORS issues from object storage.
  try {
    // Try to fetch the full object buffer from the storage service. This uses
    // a non-standard method on some backends (S3 has getObjectBuffer) but the
    // app already uses that pattern elsewhere when it needs bytes server-side.
    const fullBuffer = await (storage as any).getObjectBuffer(key);
    const fileSize = fullBuffer.byteLength;

    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      const start = match?.[1] ? parseInt(match[1], 10) : 0;
      const end = match?.[2] ? parseInt(match[2], 10) : fileSize - 1;
      const slice = fullBuffer.slice(start, end + 1);
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
    console.error("Failed to proxy storage object:", err);
    return jsonError("File not found in storage.", 404);
  }
}
