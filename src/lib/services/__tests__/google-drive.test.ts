import { describe, expect, it, vi, afterEach } from "vitest";
import { GoogleDriveService } from "@/lib/services/google-drive";
import { GoogleFileTooLargeError } from "@/lib/services/google-errors";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchOnce(response: { ok: boolean; status?: number; json?: unknown; text?: string; arrayBuffer?: ArrayBuffer }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.json,
    text: async () => response.text ?? "",
    arrayBuffer: async () => response.arrayBuffer ?? new ArrayBuffer(0),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockStreamingFetch(options: {
  chunks: Uint8Array[];
  contentLength?: number;
  onCancel?: () => void;
  errorAtChunk?: number;
  cancelError?: Error;
}) {
  let cancelled = false;
  let chunkIndex = 0;
  let lockReleased = false;

  const stream = new ReadableStream({
    pull(controller) {
      if (options.errorAtChunk !== undefined && chunkIndex === options.errorAtChunk) {
        controller.error(new Error("Stream network error"));
        return;
      }
      if (chunkIndex < options.chunks.length) {
        controller.enqueue(options.chunks[chunkIndex++]);
      } else {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
      options.onCancel?.();
      if (options.cancelError) {
        throw options.cancelError;
      }
    },
  });

  const origGetReader = stream.getReader.bind(stream);
  stream.getReader = function () {
    const reader = origGetReader();
    const origReleaseLock = reader.releaseLock.bind(reader);
    reader.releaseLock = function () {
      lockReleased = true;
      origReleaseLock();
    };
    return reader;
  };

  const headers = new Headers();
  if (options.contentLength !== undefined) {
    headers.set("content-length", String(options.contentLength));
  }

  const response = new Response(stream, { status: 200, headers });
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    stream,
    wasCancelled: () => cancelled,
    wasLockReleased: () => lockReleased,
  };
}

describe("GoogleDriveService.listFiles", () => {
  it("excludes folders and trashed files from the query, and returns files", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: { files: [{ id: "1", name: "a.pdf", mimeType: "application/pdf", modifiedTime: "2026-01-01T00:00:00Z" }] } });

    const service = new GoogleDriveService();
    const result = await service.listFiles({ accessToken: "token-abc" });

    expect(result.files).toHaveLength(1);
    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("mimeType");
    const decoded = decodeURIComponent(calledUrl).replace(/\+/g, " ");
    expect(decoded).toContain("trashed = false");
    expect(decoded).toContain("mimeType != 'application/vnd.google-apps.folder'");
  });

  it("includes a name-contains clause when a search query is given, escaping quotes", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: { files: [] } });
    const service = new GoogleDriveService();
    await service.listFiles({ accessToken: "token-abc", query: "O'Brien's notes" });

    const decoded = decodeURIComponent(fetchMock.mock.calls[0]![0] as string).replace(/\+/g, " ");
    expect(decoded).toContain("name contains");
    expect(decoded).toContain("\\'");
  });

  it("sends the access token as a bearer header", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: { files: [] } });
    const service = new GoogleDriveService();
    await service.listFiles({ accessToken: "secret-token" });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it("surfaces a clear message when the token is expired/revoked (401)", async () => {
    mockFetchOnce({ ok: false, status: 401, text: "invalid_grant" });
    const service = new GoogleDriveService();
    await expect(service.listFiles({ accessToken: "expired" })).rejects.toThrow(/reconnect/i);
  });

  it("surfaces a clear message for rate limiting (403)", async () => {
    mockFetchOnce({ ok: false, status: 403, text: "rateLimitExceeded" });
    const service = new GoogleDriveService();
    await expect(service.listFiles({ accessToken: "t" })).rejects.toThrow(/try again later/i);
  });
});

describe("GoogleDriveService.getFileMetadata", () => {
  it("surfaces a clear message for a missing file (404)", async () => {
    mockFetchOnce({ ok: false, status: 404, text: "notFound" });
    const service = new GoogleDriveService();
    await expect(service.getFileMetadata({ accessToken: "t", fileId: "missing" })).rejects.toThrow(/no longer accessible/i);
  });
});

describe("GoogleDriveService.downloadFile / exportFile", () => {
  it("returns the response body as a Buffer", async () => {
    const bytes = new TextEncoder().encode("hello world").buffer;
    mockFetchOnce({ ok: true, arrayBuffer: bytes });
    const service = new GoogleDriveService();
    const buffer = await service.downloadFile({ accessToken: "t", fileId: "f1" });
    expect(buffer.toString("utf8")).toBe("hello world");
  });

  it("requests the given export MIME type", async () => {
    const fetchMock = mockFetchOnce({ ok: true, arrayBuffer: new ArrayBuffer(0) });
    const service = new GoogleDriveService();
    await service.exportFile({ accessToken: "t", fileId: "doc1", mimeType: "text/plain" });
    const calledUrl = decodeURIComponent(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl).toContain("export");
    expect(calledUrl).toContain("mimeType=text/plain");
  });
});

describe("GoogleDriveService.exportFile streaming limit & cancellation (Phase 11.3.3C)", () => {
  it("streams and returns full buffer when payload is strictly below limit", async () => {
    const chunk1 = new TextEncoder().encode("Hello ");
    const chunk2 = new TextEncoder().encode("World");
    mockStreamingFetch({
      chunks: [chunk1, chunk2],
      contentLength: chunk1.byteLength + chunk2.byteLength,
    });

    const service = new GoogleDriveService();
    const result = await service.exportFile({
      accessToken: "t",
      fileId: "doc-1",
      mimeType: "text/plain",
      maxBytes: 100,
    });

    expect(result.toString("utf8")).toBe("Hello World");
    expect(result.byteLength).toBe(11);
  });

  it("streams and returns full buffer when payload is exactly at limit", async () => {
    const chunk = new Uint8Array(50);
    chunk.fill(65); // "A"
    mockStreamingFetch({
      chunks: [chunk],
      contentLength: 50,
    });

    const service = new GoogleDriveService();
    const result = await service.exportFile({
      accessToken: "t",
      fileId: "doc-1",
      mimeType: "text/plain",
      maxBytes: 50,
    });

    expect(result.byteLength).toBe(50);
  });

  it("aborts and throws GoogleFileTooLargeError when payload exceeds limit via declared Content-Length", async () => {
    const chunk = new Uint8Array(100);
    const { wasCancelled } = mockStreamingFetch({
      chunks: [chunk],
      contentLength: 150,
    });

    const service = new GoogleDriveService();
    await expect(
      service.exportFile({
        accessToken: "t",
        fileId: "doc-1",
        mimeType: "text/plain",
        maxBytes: 100,
      })
    ).rejects.toThrow(GoogleFileTooLargeError);

    expect(wasCancelled()).toBe(true);
  });

  it("aborts and throws GoogleFileTooLargeError when Content-Length is missing but stream exceeds limit", async () => {
    const chunk1 = new Uint8Array(60);
    const chunk2 = new Uint8Array(60);
    const chunk3 = new Uint8Array(60); // Remaining chunk that should never be read
    const { wasCancelled } = mockStreamingFetch({
      chunks: [chunk1, chunk2, chunk3],
      // No contentLength provided (e.g. chunked transfer)
    });

    const service = new GoogleDriveService();
    await expect(
      service.exportFile({
        accessToken: "t",
        fileId: "doc-1",
        mimeType: "text/plain",
        maxBytes: 100,
      })
    ).rejects.toThrow(GoogleFileTooLargeError);

    expect(wasCancelled()).toBe(true);
  });

  it("aborts and throws GoogleFileTooLargeError when declared Content-Length is incorrect (lower than real payload)", async () => {
    const chunk1 = new Uint8Array(40);
    const chunk2 = new Uint8Array(70);
    const chunk3 = new Uint8Array(70); // Extra data still in flight
    const { wasCancelled } = mockStreamingFetch({
      chunks: [chunk1, chunk2, chunk3],
      contentLength: 40, // Dishonest / underreported header
    });

    const service = new GoogleDriveService();
    await expect(
      service.exportFile({
        accessToken: "t",
        fileId: "doc-1",
        mimeType: "text/plain",
        maxBytes: 100,
      })
    ).rejects.toThrow(GoogleFileTooLargeError);

    expect(wasCancelled()).toBe(true);
  });

  it("propagates stream network failure during reading", async () => {
    const chunk1 = new Uint8Array(30);
    const chunk2 = new Uint8Array(30);
    mockStreamingFetch({
      chunks: [chunk1, chunk2],
      errorAtChunk: 1,
    });

    const service = new GoogleDriveService();
    await expect(
      service.exportFile({
        accessToken: "t",
        fileId: "doc-1",
        mimeType: "text/plain",
        maxBytes: 100,
      })
    ).rejects.toThrow(/Stream network error/i);
  });

  it("actively cancels the reader stream when the byte limit is crossed", async () => {
    let cancelCalled = false;
    const chunk1 = new Uint8Array(80);
    const chunk2 = new Uint8Array(50);
    const chunk3 = new Uint8Array(50); // Unread remainder
    const { wasCancelled } = mockStreamingFetch({
      chunks: [chunk1, chunk2, chunk3],
      onCancel: () => {
        cancelCalled = true;
      },
    });

    const service = new GoogleDriveService();
    await expect(
      service.exportFile({
        accessToken: "t",
        fileId: "doc-1",
        mimeType: "text/plain",
        maxBytes: 100,
      })
    ).rejects.toThrow(GoogleFileTooLargeError);

    expect(cancelCalled).toBe(true);
    expect(wasCancelled()).toBe(true);
  });
});

describe("GoogleDriveService.exportFile Phase 11.3.3C.2: Reader cleanup & null-body fallback", () => {
  it("fails safely when res.body is unavailable for a bounded export without invoking arrayBuffer()", async () => {
    const arrayBufferSpy = vi.fn().mockResolvedValue(new ArrayBuffer(100));
    const mockResponse = {
      ok: true,
      status: 200,
      body: null,
      headers: new Headers(),
      arrayBuffer: arrayBufferSpy,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const service = new GoogleDriveService();
    await expect(
      service.exportFile({
        accessToken: "t",
        fileId: "doc-1",
        mimeType: "text/plain",
        maxBytes: 1000,
      })
    ).rejects.toThrow(/Response body is unavailable and cannot be safely size-limited/i);

    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("preserves arrayBuffer() fallback for unbounded export callers (maxBytes undefined)", async () => {
    const bytes = new TextEncoder().encode("unbounded content").buffer;
    const arrayBufferSpy = vi.fn().mockResolvedValue(bytes);
    const mockResponse = {
      ok: true,
      status: 200,
      body: null,
      headers: new Headers(),
      arrayBuffer: arrayBufferSpy,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const service = new GoogleDriveService();
    const result = await service.exportFile({
      accessToken: "t",
      fileId: "doc-1",
      mimeType: "text/plain",
    });

    expect(result.toString("utf8")).toBe("unbounded content");
    expect(arrayBufferSpy).toHaveBeenCalled();
  });

  it("releases the stream reader lock after successful reading", async () => {
    const chunk1 = new Uint8Array([1, 2, 3]);
    const chunk2 = new Uint8Array([4, 5]);
    const { stream, wasLockReleased } = mockStreamingFetch({
      chunks: [chunk1, chunk2],
    });

    const service = new GoogleDriveService();
    const result = await service.exportFile({
      accessToken: "t",
      fileId: "doc-1",
      mimeType: "text/plain",
      maxBytes: 100,
    });

    expect([...result]).toEqual([1, 2, 3, 4, 5]);
    expect(wasLockReleased()).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it("releases the stream reader lock after transport/read error", async () => {
    const chunk1 = new Uint8Array(20);
    const chunk2 = new Uint8Array(20);
    const { stream, wasLockReleased } = mockStreamingFetch({
      chunks: [chunk1, chunk2],
      errorAtChunk: 1,
    });

    const service = new GoogleDriveService();
    await expect(
      service.exportFile({
        accessToken: "t",
        fileId: "doc-1",
        mimeType: "text/plain",
        maxBytes: 100,
      })
    ).rejects.toThrow(/Stream network error/i);

    expect(wasLockReleased()).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it("releases the stream reader lock after size-limit cancellation", async () => {
    const chunk1 = new Uint8Array(80);
    const chunk2 = new Uint8Array(50);
    const chunk3 = new Uint8Array(50);
    const { stream, wasLockReleased, wasCancelled } = mockStreamingFetch({
      chunks: [chunk1, chunk2, chunk3],
    });

    const service = new GoogleDriveService();
    await expect(
      service.exportFile({
        accessToken: "t",
        fileId: "doc-1",
        mimeType: "text/plain",
        maxBytes: 100,
      })
    ).rejects.toThrow(GoogleFileTooLargeError);

    expect(wasCancelled()).toBe(true);
    expect(wasLockReleased()).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it("ensures cancellation errors do not mask or replace GoogleFileTooLargeError", async () => {
    const chunk1 = new Uint8Array(80);
    const chunk2 = new Uint8Array(50);
    const chunk3 = new Uint8Array(50);
    const { stream, wasLockReleased, wasCancelled } = mockStreamingFetch({
      chunks: [chunk1, chunk2, chunk3],
      cancelError: new Error("Underlying stream cancel failed"),
    });

    const service = new GoogleDriveService();
    await expect(
      service.exportFile({
        accessToken: "t",
        fileId: "doc-1",
        mimeType: "text/plain",
        maxBytes: 100,
      })
    ).rejects.toThrow(GoogleFileTooLargeError);

    expect(wasCancelled()).toBe(true);
    expect(wasLockReleased()).toBe(true);
    expect(stream.locked).toBe(false);
  });
});
