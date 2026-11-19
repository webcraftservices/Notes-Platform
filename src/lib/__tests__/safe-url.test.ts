import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, toSafeAppOrHttpUrl, toSafeHttpUrl } from "@/lib/safe-url";
import { createLinkMaterialSchema } from "@/lib/validation/materials";
import { importGoogleFileSchema } from "@/lib/validation/google";

describe("safe-url protocol validation", () => {
  it("accepts http and https URLs and rejects javascript:/data:/vbscript:/control chars", () => {
    expect(toSafeHttpUrl("https://example.com/path?a=1")).toBe("https://example.com/path?a=1");
    expect(toSafeHttpUrl("http://localhost:3000/test")).toBe("http://localhost:3000/test");
    expect(toSafeHttpUrl("  https://docs.google.com/document/d/1  ")).toBe(
      "https://docs.google.com/document/d/1"
    );

    expect(toSafeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(toSafeHttpUrl("JAVASCRIPT:alert(1)")).toBeNull();
    expect(toSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(toSafeHttpUrl("vbscript:msgbox(1)")).toBeNull();
    expect(toSafeHttpUrl("https://example.com\njavascript:alert(1)")).toBeNull();
    expect(isSafeHttpUrl("javascript:alert(document.cookie)")).toBe(false);

    expect(toSafeAppOrHttpUrl("/api/storage/read?key=abc")).toBe("/api/storage/read?key=abc");
    expect(toSafeAppOrHttpUrl("//evil.example.com/phish")).toBeNull();
    expect(toSafeAppOrHttpUrl("javascript:alert(1)")).toBeNull();
  });

  it("blocks dangerous schemes in createLinkMaterialSchema and importGoogleFileSchema", () => {
    expect(
      createLinkMaterialSchema.safeParse({
        title: "Bad link",
        url: "javascript:alert(1)",
      }).success
    ).toBe(false);

    expect(
      createLinkMaterialSchema.safeParse({
        title: "Good link",
        url: "https://en.wikipedia.org/wiki/Thermodynamics",
      }).success
    ).toBe(true);

    expect(
      importGoogleFileSchema.safeParse({
        fileId: "file-1",
        name: "Doc",
        mimeType: "application/vnd.google-apps.document",
        webViewLink: "javascript:alert(1)",
      }).success
    ).toBe(false);
  });
});
