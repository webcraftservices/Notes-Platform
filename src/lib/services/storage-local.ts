import { promises as fs } from "fs";
import path from "path";
import type { StorageService } from "./storage";

/**
 * Real, working storage backend for local development and small
 * self-hosted deployments — not a stub. Files are written to and read
 * from disk under STORAGE_LOCAL_DIR.
 *
 * Unlike the S3 backend, this can't hand the browser a true pre-signed
 * URL to PUT/GET directly against object storage, so both "URLs" it
 * returns actually point back at this app's own /api/storage route,
 * which re-checks session + material ownership on every request (see
 * app/api/storage/upload/route.ts and .../read/route.ts). That's a
 * deliberate, documented trade-off for this backend, not a security
 * shortcut — the S3 backend below issues real presigned URLs that bypass
 * the app server entirely, which is what production should use.
 *
 * Known limitation: the local upload handler buffers the request body in
 * memory (see the route handler) rather than streaming to disk, which is
 * fine for a dev/demo deployment but not for large files in production —
 * that's exactly the case the S3 backend exists for.
 */
export class LocalStorageService implements StorageService {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private resolvePath(key: string): string {
    const safeKey = sanitizeKey(key);
    return path.join(this.rootDir, safeKey);
  }

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    maxSizeBytes: number;
  }): Promise<{ uploadUrl: string; key: string }> {
    const safeKey = sanitizeKey(input.key);
    return {
      uploadUrl: `/api/storage/upload?key=${encodeURIComponent(safeKey)}`,
      key: safeKey,
    };
  }

  async createReadUrl(key: string): Promise<string> {
    return `/api/storage/read?key=${encodeURIComponent(sanitizeKey(key))}`;
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolvePath(key));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  /** Not part of the StorageService interface — used directly by the local route handlers. */
  async writeFile(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async readFileStats(key: string) {
    return fs.stat(this.resolvePath(key));
  }

  async readFile(key: string, range?: { start: number; end: number }): Promise<Buffer> {
    const filePath = this.resolvePath(key);
    if (range) {
      const handle = await fs.open(filePath, "r");
      try {
        const length = range.end - range.start + 1;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, range.start);
        return buffer;
      } finally {
        await handle.close();
      }
    }
    return fs.readFile(filePath);
  }
}

/** Prevents path traversal — keys may only contain segments of safe characters. */
function sanitizeKey(key: string): string {
  const segments = key.split("/").filter(Boolean);
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new Error(`Invalid storage key segment: ${segment}`);
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(segment)) {
      throw new Error(`Invalid storage key segment: ${segment}`);
    }
  }
  return segments.join("/");
}

export { sanitizeKey };
