import { describe, expect, it, vi } from "vitest";
import { isS3NotFoundError, S3StorageService } from "@/lib/services/storage-s3";

describe("isS3NotFoundError", () => {
  it("recognizes 'missing object' across AWS and S3-compatible providers, and nothing else", () => {
    expect(isS3NotFoundError({ name: "NotFound" })).toBe(true);
    expect(isS3NotFoundError({ name: "NoSuchKey" })).toBe(true);
    expect(isS3NotFoundError({ name: "UnknownError", $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isS3NotFoundError({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } })).toBe(false);
    expect(isS3NotFoundError(new Error("timeout"))).toBe(false);
    expect(isS3NotFoundError(null)).toBe(false);
  });
});

describe("S3StorageService.headObject", () => {
  function serviceWith(send: (cmd: unknown, opts?: { abortSignal?: AbortSignal }) => unknown) {
    // Constructing a real S3StorageService needs credentials; the prototype
    // plus the two private fields headObject touches is all that's under test.
    const service = Object.create(S3StorageService.prototype) as unknown as {
      client: { send: ReturnType<typeof vi.fn> };
      bucket: string;
      headObject(key: string): Promise<{ sizeBytes: number } | null>;
    };
    service.client = { send: vi.fn(send) };
    service.bucket = "bucket";
    return service;
  }

  it("returns the real stored size, with an explicit abort signal", async () => {
    const service = serviceWith(async () => ({ ContentLength: 1234 }));
    expect(await service.headObject("k")).toEqual({ sizeBytes: 1234 });
    const opts = service.client.send.mock.calls[0]![1] as { abortSignal: AbortSignal };
    expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("returns null for a missing object but THROWS on any other failure, so 'missing' and 'couldn't check' stay distinct", async () => {
    expect(await serviceWith(async () => Promise.reject({ name: "NotFound" })).headObject("k")).toBeNull();
    await expect(serviceWith(async () => Promise.reject(new Error("socket hang up"))).headObject("k")).rejects.toThrow(/socket/);
  });
});
