import { describe, expect, it, vi, afterEach } from "vitest";
import { extractGoogleDocText, GOOGLE_DOCS_EXPORT_MAX_BYTES } from "@/lib/services/google-docs";
import { MAX_EXTRACTED_TEXT_CHARS } from "@/lib/services/document-processing-local";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractGoogleDocText", () => {
  it("exports the document as text/plain and returns it decoded", async () => {
    const bytes = new TextEncoder().encode("Zeroth Law: two systems in thermal equilibrium...");
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
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

  it("rejects when exported text exceeds the maximum character ceiling without truncation", async () => {
    const hugeText = "A".repeat(MAX_EXTRACTED_TEXT_CHARS + 10);
    const bytes = new TextEncoder().encode(hugeText);
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractGoogleDocText({ accessToken: "token", documentId: "doc-huge" })).rejects.toThrow(
      /This document exceeds the maximum supported text length for extraction \(\d[\d,]* characters; limit is 500,000 characters\)\. The original file remains available for viewing and download\./
    );
  });

  it("exports GOOGLE_DOCS_EXPORT_MAX_BYTES as 10 MB", () => {
    expect(GOOGLE_DOCS_EXPORT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
