import { describe, expect, it } from "vitest";
import { getOrCreateRequestId } from "@/lib/observability/request-id";

function reqWith(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

describe("getOrCreateRequestId", () => {
  it("generates a fresh id when no incoming header is present", () => {
    const id = getOrCreateRequestId(reqWith({}));

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("generates a different id on each call when nothing is provided", () => {
    const a = getOrCreateRequestId(reqWith({}));
    const b = getOrCreateRequestId(reqWith({}));

    expect(a).not.toBe(b);
  });

  it("reuses an incoming x-request-id header instead of generating a new one", () => {
    const id = getOrCreateRequestId(reqWith({ "x-request-id": "incoming-id-123" }));

    expect(id).toBe("incoming-id-123");
  });

  it("falls back to x-vercel-id when x-request-id is absent", () => {
    const id = getOrCreateRequestId(reqWith({ "x-vercel-id": "vercel-id-456" }));

    expect(id).toBe("vercel-id-456");
  });

  it("prefers x-request-id over x-vercel-id when both are present", () => {
    const id = getOrCreateRequestId(reqWith({ "x-request-id": "primary", "x-vercel-id": "secondary" }));

    expect(id).toBe("primary");
  });

  it("never derives the id from sensitive headers like authorization or cookie", () => {
    const id = getOrCreateRequestId(
      reqWith({ authorization: "Bearer secret-token", cookie: "session=abc123" })
    );

    expect(id).not.toContain("secret-token");
    expect(id).not.toContain("abc123");
  });
});
