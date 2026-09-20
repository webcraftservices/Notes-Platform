import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/access", () => access);

const oauthState = vi.hoisted(() => ({ verifyOAuthState: vi.fn() }));
vi.mock("@/lib/services/google-oauth-state", () => oauthState);

const connection = vi.hoisted(() => ({ saveGoogleConnection: vi.fn() }));
vi.mock("@/lib/google-connection", () => connection);

const oauth = vi.hoisted(() => {
  class GoogleNotConfiguredError extends Error {
    constructor(missingEnvVars: string[]) {
      super(`Google Drive/Docs integration is not configured. Set: ${missingEnvVars.join(", ")}.`);
      this.name = "GoogleNotConfiguredError";
    }
  }
  return {
    exchangeCodeForTokens: vi.fn(),
    fetchGoogleUserEmail: vi.fn(),
    GoogleNotConfiguredError,
  };
});
vi.mock("@/lib/services/google-oauth", () => oauth);

import { GET } from "@/app/api/integrations/google/callback/route";

function makeRequest(query: string): Request {
  return new Request(`https://example.test/api/integrations/google/callback${query}`);
}

describe("GET /api/integrations/google/callback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "user-1" });
    oauthState.verifyOAuthState.mockReturnValue(true);
    process.env.NEXTAUTH_URL = "https://example.test";
  });

  it("redirects to settings with google=connected on success", async () => {
    oauth.exchangeCodeForTokens.mockResolvedValue({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    oauth.fetchGoogleUserEmail.mockResolvedValue("user@example.com");

    const res = await GET(makeRequest("?code=abc&state=xyz"));

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("google")).toBe("connected");
  });

  it("shows GoogleNotConfiguredError's own message — it's static, safe, config-only text", async () => {
    oauth.exchangeCodeForTokens.mockRejectedValue(new oauth.GoogleNotConfiguredError(["GOOGLE_CLIENT_ID"]));

    const res = await GET(makeRequest("?code=abc&state=xyz"));

    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("message")).toContain("GOOGLE_CLIENT_ID");
  });

  /**
   * Phase 9.3 audit finding: a raw provider/exception message (which can
   * include Google's own token-exchange error response body — see
   * exchangeCodeForTokens) must never be forwarded into this
   * browser-visible redirect URL.
   */
  it("never forwards a raw provider error message into the redirect URL, and logs it server-side instead", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    oauth.exchangeCodeForTokens.mockRejectedValue(
      new Error('Google token exchange failed (400): {"error":"invalid_grant","error_description":"secret internal detail"}')
    );

    const res = await GET(makeRequest("?code=abc&state=xyz"));

    const location = new URL(res.headers.get("location")!);
    const message = location.searchParams.get("message")!;
    expect(message).toBe("Google Drive connection could not be completed.");
    expect(message).not.toContain("invalid_grant");
    expect(message).not.toContain("secret internal detail");
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("shows a generic message when Google reports the user declined consent", async () => {
    const res = await GET(makeRequest("?error=access_denied"));

    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("message")).toBe("Google Drive connection was cancelled.");
  });

  it("rejects when the OAuth state doesn't verify (CSRF/replay protection)", async () => {
    oauthState.verifyOAuthState.mockReturnValue(false);

    const res = await GET(makeRequest("?code=abc&state=tampered"));

    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("google")).toBe("error");
    expect(connection.saveGoogleConnection).not.toHaveBeenCalled();
  });

  it("requires a session before doing anything else", async () => {
    access.getSessionUser.mockResolvedValue(null);

    const res = await GET(makeRequest("?code=abc&state=xyz"));

    expect(oauthState.verifyOAuthState).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("google")).toBe("error");
  });
});
