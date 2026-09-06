import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildGoogleAuthUrl, getGoogleOAuthConfig, GoogleNotConfiguredError } from "@/lib/services/google-oauth";

const ENV_KEYS = ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("getGoogleOAuthConfig", () => {
  it("throws GoogleNotConfiguredError when no client credentials are set", () => {
    expect(() => getGoogleOAuthConfig()).toThrow(GoogleNotConfiguredError);
  });

  it("prefers GOOGLE_DRIVE_CLIENT_ID/SECRET when both variable sets are present", () => {
    process.env.GOOGLE_DRIVE_CLIENT_ID = "drive-id";
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = "drive-secret";
    process.env.GOOGLE_CLIENT_ID = "login-id";
    process.env.GOOGLE_CLIENT_SECRET = "login-secret";
    expect(getGoogleOAuthConfig()).toEqual({ clientId: "drive-id", clientSecret: "drive-secret" });
  });

  it("falls back to the sign-in OAuth client when Drive-specific vars aren't set", () => {
    process.env.GOOGLE_CLIENT_ID = "login-id";
    process.env.GOOGLE_CLIENT_SECRET = "login-secret";
    expect(getGoogleOAuthConfig()).toEqual({ clientId: "login-id", clientSecret: "login-secret" });
  });
});

describe("buildGoogleAuthUrl", () => {
  it("builds a well-formed Google consent URL with the requested scopes and state", () => {
    process.env.GOOGLE_CLIENT_ID = "login-id";
    process.env.GOOGLE_CLIENT_SECRET = "login-secret";

    const url = buildGoogleAuthUrl({ redirectUri: "https://app.example.com/api/integrations/google/callback", state: "signed-state" });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("login-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/integrations/google/callback");
    expect(parsed.searchParams.get("state")).toBe("signed-state");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("scope")).toContain("drive.readonly");
    expect(parsed.searchParams.get("scope")).toContain("documents.readonly");
  });

  it("throws when Google isn't configured", () => {
    expect(() => buildGoogleAuthUrl({ redirectUri: "https://x.test/cb", state: "s" })).toThrow(GoogleNotConfiguredError);
  });
});
