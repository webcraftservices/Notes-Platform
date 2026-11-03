import { describe, expect, it } from "vitest";
const nextConfig = require("../../../next.config.js");

async function getHeaders(): Promise<Record<string, string>> {
  const result = await nextConfig.headers();
  const entry = result.find((r: { source: string }) => r.source === "/:path*");
  return Object.fromEntries(entry.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
}

describe("next.config.js security headers (Phase 9.3)", () => {
  it("sets X-Content-Type-Options: nosniff", async () => {
    const headers = await getHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options: SAMEORIGIN to prevent clickjacking", async () => {
    const headers = await getHeaders();
    expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  it("sets a Referrer-Policy that doesn't leak full URLs cross-origin", async () => {
    const headers = await getHeaders();
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("sets Strict-Transport-Security with a long max-age", async () => {
    const headers = await getHeaders();
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d{6,}/);
  });

  it("Permissions-Policy blocks camera entirely and restricts microphone to same-origin (needed for lecture recording)", async () => {
    const headers = await getHeaders();
    const pp = headers["Permissions-Policy"];
    expect(pp).toContain("camera=()");
    expect(pp).toContain("microphone=(self)");
  });

  describe("Content-Security-Policy", () => {
    it("restricts default-src to self", async () => {
      const headers = await getHeaders();
      expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    });

    it("blocks legacy plugin content entirely (object-src 'none')", async () => {
      const headers = await getHeaders();
      expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    });

    it("restricts frame-ancestors to self, preventing this app being framed by another site", async () => {
      const headers = await getHeaders();
      expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    });

    it("restricts form-action to self, preventing form-based data exfiltration to another origin", async () => {
      const headers = await getHeaders();
      expect(headers["Content-Security-Policy"]).toContain("form-action 'self'");
    });

    it("restricts base-uri to self, preventing a <base> tag injection from redirecting relative URLs off-site", async () => {
      const headers = await getHeaders();
      expect(headers["Content-Security-Policy"]).toContain("base-uri 'self'");
    });

    it("never allows a third-party script/style/img host (except explicitly allowed storage)", async () => {
      const headers = await getHeaders();
      const csp = headers["Content-Security-Policy"];
      // R2 storage and Web3Forms are required for connect-src; Aceternity for onboarding assets
      const allowedHosts = [
        "https://f03d7c364f5dd204ce76f719835c5c28.r2.cloudflarestorage.com",
        "https://assets.aceternity.com",
        "https://api.web3forms.com",
      ];
      let cspFiltered = csp || "";
      for (const host of allowedHosts) {
        cspFiltered = cspFiltered.split(host).join("");
      }
      expect(cspFiltered).not.toMatch(/https?:\/\//);
    });
  });
});
