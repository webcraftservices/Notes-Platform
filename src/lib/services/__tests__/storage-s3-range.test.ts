import { describe, expect, it, vi } from "vitest";
import { S3StorageService } from "@/lib/services/storage-s3";

function serviceWith(send: (cmd: { input?: Record<string, unknown> }) => unknown) {
  const service = Object.create(S3StorageService.prototype) as unknown as {
    client: { send: ReturnType<typeof vi.fn> };
    bucket: string;
    getObjectRange(key: string, range?: { start: number; end: number }): Promise<Buffer>;
  };
  service.client = { send: vi.fn(send) };
  service.bucket = "bucket";
  return service;
}

function bodyOf(bytes: number[]) {
  return { [Symbol.asyncIterator]: async function* () { yield new Uint8Array(bytes); } };
}

describe("S3StorageService.getObjectRange — Phase 9.5", () => {
  it("passes a real S3 Range header for a byte range instead of fetching the whole object", async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const service = serviceWith((cmd) => {
      capturedInput = cmd.input;
      return { Body: bodyOf([9, 9]) }; // only the 2 requested bytes, never the "rest" of a bigger object
    });

    const buffer = await service.getObjectRange("materials/k", { start: 100, end: 101 });

    expect(capturedInput?.Range).toBe("bytes=100-101");
    expect([...buffer]).toEqual([9, 9]);
  });

  it("omits Range entirely for a full-object request", async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const service = serviceWith((cmd) => {
      capturedInput = cmd.input;
      return { Body: bodyOf([1, 2, 3]) };
    });

    await service.getObjectRange("materials/k");

    expect(capturedInput?.Range).toBeUndefined();
  });

  it("throws instead of returning an empty buffer when S3 sends no body", async () => {
    const service = serviceWith(() => ({ Body: undefined }));
    await expect(service.getObjectRange("materials/k", { start: 0, end: 1 })).rejects.toThrow(/no body/);
  });

  it("gives the call an explicit abort signal (Phase 9.4 timeout discipline)", async () => {
    const service = serviceWith(() => ({ Body: bodyOf([1]) }));
    await service.getObjectRange("materials/k", { start: 0, end: 0 });
    const opts = service.client.send.mock.calls[0]![1] as { abortSignal: AbortSignal };
    expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
  });
});
