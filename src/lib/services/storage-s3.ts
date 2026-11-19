import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageService } from "./storage";

/**
 * Phase 9.4 — explicit per-call budgets. The AWS SDK v3 sets no request
 * timeout of its own (only its built-in retry policy), so a stalled S3
 * endpoint would otherwise hold the caller open indefinitely.
 */
const S3_METADATA_TIMEOUT_MS = 15_000; // head/delete — tiny requests
const S3_TRANSFER_TIMEOUT_MS = 10 * 60 * 1000; // whole-object get/put

/**
 * Composes multiple AbortSignals safely into a single signal.
 * - Uses native AbortSignal.any() when available (Node 20+).
 * - Implements a leak-free fallback with one-shot listeners for Node 18 environments.
 * - Preserves the original abort reason.
 * - Handles already-aborted signals synchronously before listener registration.
 */
export function combineAbortSignals(signals: (AbortSignal | undefined | null)[]): AbortSignal {
  const activeSignals = signals.filter((s): s is AbortSignal => Boolean(s));
  if (activeSignals.length === 0) {
    return new AbortController().signal;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0]!;
  }

  for (const sig of activeSignals) {
    if (sig.aborted) {
      if (typeof AbortSignal.abort === "function") {
        return AbortSignal.abort(sig.reason);
      }
      const c = new AbortController();
      c.abort(sig.reason);
      return c.signal;
    }
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();
  const cleanupFns: (() => void)[] = [];

  const onAbort = (sig: AbortSignal) => {
    controller.abort(sig.reason);
    for (const cleanup of cleanupFns) cleanup();
    cleanupFns.length = 0;
  };

  for (const sig of activeSignals) {
    const handler = () => onAbort(sig);
    sig.addEventListener("abort", handler, { once: true });
    cleanupFns.push(() => sig.removeEventListener("abort", handler));
  }

  return controller.signal;
}

/** True for the "object does not exist" outcome of a HEAD/GET, across AWS S3 and S3-compatible providers. */
export function isS3NotFoundError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

/**
 * Production storage backend. Works against AWS S3 or any S3-compatible
 * endpoint (Cloudflare R2, Backblaze B2, MinIO, ...) via STORAGE_ENDPOINT.
 * Issues real, time-limited pre-signed URLs — uploads and downloads go
 * directly between the browser and object storage, never through this
 * app's server, which is what makes this the right backend for anything
 * beyond local development.
 */
export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      // Path-style addressing is required by most non-AWS S3-compatible
      // providers (R2, MinIO); AWS itself accepts it too.
      forcePathStyle: !!config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createUploadUrl(input: {
    key: string;
    contentType: string;
    maxSizeBytes: number;
  }): Promise<{ uploadUrl: string; key: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      // S3 doesn't support enforcing a max size purely via a presigned PUT
      // URL's headers in a portable way across providers, so the app layer
      // still validates sizeBytes against the plan limit before ever
      // requesting this URL (see /api/materials/upload-url) and again once
      // the object exists (see the "complete" step, which — since Phase
      // 9.4 — HEADs the object and checks its actual stored size).
      ContentLength: undefined,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: 60 * 10 });
    return { uploadUrl, key: input.key };
  }

  async createReadUrl(key: string, expiresInSeconds = 60 * 15): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(S3_METADATA_TIMEOUT_MS),
    });
  }

  /**
   * Not part of the StorageService interface — used by the upload
   * "complete" step to confirm the browser's direct-to-S3 upload actually
   * landed and to learn its REAL size (never the client's declared one).
   * Returns null when the object does not exist; any other failure
   * (outage, timeout, permissions) is thrown so the caller can tell
   * "missing" apart from "couldn't check".
   */
  async headObject(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(S3_METADATA_TIMEOUT_MS),
      });
      return { sizeBytes: res.ContentLength ?? 0 };
    } catch (err) {
      if (isS3NotFoundError(err)) return null;
      throw err;
    }
  }

  /**
   * Not part of the StorageService interface — used server-side (e.g. by
   * the transcription orchestrator) when a real cloud API needs the actual
   * bytes rather than a URL the browser can fetch. Downloads the object
   * fully into memory; fine for audio files, not something to do for
   * arbitrarily large objects. For serving partial content to a browser
   * (seeking playback, PDF byte-range viewers), use getObjectRange instead
   * — it never buffers more than what was actually requested.
   */
  async getObjectBuffer(key: string, signal?: AbortSignal): Promise<Buffer> {
    const timeoutSignal = AbortSignal.timeout(S3_TRANSFER_TIMEOUT_MS);
    const combinedSignal = signal ? combineAbortSignals([signal, timeoutSignal]) : timeoutSignal;

    combinedSignal.throwIfAborted();

    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: combinedSignal,
    });
    const body = res.Body;
    if (!body) throw new Error(`Object ${key} has no body`);
    const chunks: Uint8Array[] = [];
    try {
      // AWS SDK v3's Body is a web/node ReadableStream depending on runtime;
      // both expose an async iterator.
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        combinedSignal.throwIfAborted();
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } finally {
      if (combinedSignal.aborted && typeof (body as any).destroy === "function") {
        try {
          (body as any).destroy();
        } catch {
          // ignore stream close errors on aborted exit
        }
      }
    }
  }

  /**
   * Phase 9.5 — fetches exactly the requested byte range (or the whole
   * object, if `range` is omitted) using S3's own `Range` request header,
   * instead of always downloading the entire object and slicing it in
   * memory. Used by `/api/storage/read` so a seek in a long lecture
   * recording, or a PDF viewer's page-range fetch, transfers only the
   * bytes actually requested — not the whole file every time.
   *
   * `range` must already be a validated, in-bounds `{start, end}` pair
   * (inclusive, 0-indexed) — get one from `parseRangeHeader` against a
   * real object size (`headObject`) before calling this; a range is
   * never guessed or normalized here.
   */
  async getObjectRange(key: string, range?: { start: number; end: number }): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
      { abortSignal: AbortSignal.timeout(S3_TRANSFER_TIMEOUT_MS) }
    );
    const body = res.Body;
    if (!body) throw new Error(`Object ${key} has no body`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Not part of the StorageService interface — used server-side (by the
   * Phase 7 Google import orchestrator, lib/google-import.ts) when bytes
   * already fetched from an external API need to be written directly,
   * rather than handed to the browser as a presigned PUT URL. Mirrors
   * getObjectBuffer's duck-typed pattern above.
   */
  async putObjectBuffer(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
      { abortSignal: AbortSignal.timeout(S3_TRANSFER_TIMEOUT_MS) }
    );
  }
}
