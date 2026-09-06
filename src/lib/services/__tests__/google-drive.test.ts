import { describe, expect, it, vi, afterEach } from "vitest";
import { GoogleDriveService } from "@/lib/services/google-drive";

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
