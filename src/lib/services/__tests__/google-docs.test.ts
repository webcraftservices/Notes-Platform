import { describe, expect, it, vi, afterEach } from "vitest";
import { extractGoogleDocText } from "@/lib/services/google-docs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractGoogleDocText", () => {
  it("exports the document as text/plain and returns it decoded", async () => {
    const bytes = new TextEncoder().encode("Zeroth Law: two systems in thermal equilibrium...").buffer;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes,
    });
    vi.stubGlobal("fetch", fetchMock);

    const text = await extractGoogleDocText({ accessToken: "token", documentId: "doc123" });

    expect(text).toContain("Zeroth Law");
    const calledUrl = decodeURIComponent(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl).toContain("doc123/export");
    expect(calledUrl).toContain("mimeType=text/plain");
  });

  it("propagates a clear error when the export fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "notFound" })
    );
    await expect(extractGoogleDocText({ accessToken: "t", documentId: "gone" })).rejects.toThrow(/no longer accessible/i);
  });
});
