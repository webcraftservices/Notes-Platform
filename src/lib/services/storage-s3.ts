import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageService } from "./storage";

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
      // the object exists (see the "complete" step, which checks the
      // actual stored object size).
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
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Not part of the StorageService interface — used server-side (e.g. by
   * the transcription orchestrator) when a real cloud API needs the actual
   * bytes rather than a URL the browser can fetch. Downloads the object
   * fully into memory; fine for audio files, not something to do for
   * arbitrarily large objects.
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = res.Body;
    if (!body) throw new Error(`Object ${key} has no body`);
    const chunks: Uint8Array[] = [];
    // AWS SDK v3's Body is a web/node ReadableStream depending on runtime;
    // both expose an async iterator.
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
}
