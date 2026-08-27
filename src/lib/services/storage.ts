import path from "path";

/**
 * StorageService abstraction over a private object store. Never returns
 * permanent public URLs — every read is either a short-lived presigned URL
 * (S3 backend) or a session-gated app route (local backend) (spec §48, §87).
 */
export interface StorageService {
  /** Returns a URL the client can PUT the file bytes to directly. */
  createUploadUrl(input: {
    key: string;
    contentType: string;
    maxSizeBytes: number;
  }): Promise<{ uploadUrl: string; key: string }>;

  /** Short-lived URL for reading a private object. */
  createReadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  deleteObject(key: string): Promise<void>;
}

let cachedService: StorageService | null = null;
let cachedProvider: string | null = null;

/**
 * Registry entry point. STORAGE_PROVIDER selects the backend explicitly;
 * absent that, presence of S3-style env vars implies "s3", otherwise this
 * defaults to "local" so `npm run dev` works with zero storage config —
 * uploads land under STORAGE_LOCAL_DIR on disk. Production deployments
 * should set STORAGE_PROVIDER=s3 (or rely on the same inference) plus the
 * S3 env vars from .env.example.
 */
export function getStorageService(): StorageService {
  const provider =
    process.env.STORAGE_PROVIDER ??
    (process.env.STORAGE_ENDPOINT || process.env.STORAGE_BUCKET ? "s3" : "local");

  if (cachedService && cachedProvider === provider) return cachedService;

  if (provider === "s3") {
    const bucket = process.env.STORAGE_BUCKET;
    const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
    const region = process.env.STORAGE_REGION || "auto";
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "STORAGE_PROVIDER=s3 but STORAGE_BUCKET / STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY are not all set. " +
          "See .env.example and docs/ARCHITECTURE.md."
      );
    }
    // Lazy import so the AWS SDK is never pulled into the local dev path.
    const { S3StorageService } = require("./storage-s3") as typeof import("./storage-s3");
    cachedService = new S3StorageService({
      endpoint: process.env.STORAGE_ENDPOINT,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
    });
    cachedProvider = provider;
    return cachedService;
  }

  const { LocalStorageService } = require("./storage-local") as typeof import("./storage-local");
  const rootDir = process.env.STORAGE_LOCAL_DIR
    ? path.resolve(process.env.STORAGE_LOCAL_DIR)
    : path.resolve(process.cwd(), ".storage");
  cachedService = new LocalStorageService(rootDir);
  cachedProvider = "local";
  return cachedService;
}
