import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTrustedBillingOrigins,
  InvalidBillingRedirectError,
  resolveSafeBillingRedirectUrl,
} from "@/lib/billing/redirect-origin";

const access = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/access", () => access);

const rl = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => rl);

const stripeMocks = vi.hoisted(() => ({
  PAID_PLAN_TIERS: ["STUDENT", "PRO", "TEAM", "INSTITUTION"],
  BillingCustomerNotFoundError: class BillingCustomerNotFoundError extends Error {
    code = "BILLING_CUSTOMER_NOT_FOUND";
    status = 404;
  },
  StripeApiError: class StripeApiError extends Error {
    code = "STRIPE_API_ERROR";
    status = 502;
  },
  StripeNotConfiguredError: class StripeNotConfiguredError extends Error {
    code = "STRIPE_NOT_CONFIGURED";
    status = 503;
  },
  createStripeCheckoutSession: vi.fn(),
  createStripeBillingPortalSession: vi.fn(),
}));
vi.mock("@/lib/billing/stripe", () => stripeMocks);

import { POST as postCheckout } from "@/app/api/billing/checkout/route";
import { POST as postPortal } from "@/app/api/billing/portal/route";

describe("LIM-20(4) Billing Redirect Same-Origin Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.getSessionUser.mockResolvedValue({ id: "u1", email: "u1@example.com" });
    rl.rateLimit.mockResolvedValue({ success: true, remaining: 9 });
    stripeMocks.createStripeCheckoutSession.mockResolvedValue({
      sessionId: "cs_1",
      url: "https://checkout.stripe.com/pay/cs_1",
    });
    stripeMocks.createStripeBillingPortalSession.mockResolvedValue({
      url: "https://billing.stripe.com/session/1",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows same-origin URLs, relative paths, and ALLOWED_REDIRECT_ORIGINS", () => {
    expect(
      resolveSafeBillingRedirectUrl(
        "https://app.zenote.test/settings?done=1",
        "https://app.zenote.test/api/billing/checkout",
        "/settings"
      )
    ).toBe("https://app.zenote.test/settings?done=1");

    expect(
      resolveSafeBillingRedirectUrl(
        "/billing/return",
        "https://app.zenote.test/api/billing/checkout",
        "/settings"
      )
    ).toBe("https://app.zenote.test/billing/return");

    expect(
      resolveSafeBillingRedirectUrl(
        "https://staging.zenote.app/settings",
        "https://app.zenote.test/api/billing/portal",
        "/settings",
        { ALLOWED_REDIRECT_ORIGINS: "https://staging.zenote.app" }
      )
    ).toBe("https://staging.zenote.app/settings");
  });

  it("rejects off-origin, protocol-relative, and non-HTTP URLs", () => {
    for (const bad of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "javascript:alert(1)",
    ]) {
      expect(() =>
        resolveSafeBillingRedirectUrl(
          bad,
          "https://app.zenote.test/api/billing/checkout",
          "/settings"
        )
      ).toThrow(InvalidBillingRedirectError);
    }
  });

  it("returns 400 INVALID_REDIRECT_ORIGIN on checkout and portal routes for external URLs", async () => {
    const checkoutRes = await postCheckout(
      new Request("https://app.zenote.test/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({
          plan: "PRO",
          successUrl: "https://attacker.evil/callback",
        }),
      })
    );
    expect(checkoutRes.status).toBe(400);
    expect((await checkoutRes.json()).code).toBe("INVALID_REDIRECT_ORIGIN");
    expect(stripeMocks.createStripeCheckoutSession).not.toHaveBeenCalled();

    const portalRes = await postPortal(
      new Request("https://app.zenote.test/api/billing/portal", {
        method: "POST",
        body: JSON.stringify({
          returnUrl: "https://attacker.evil/return",
        }),
      })
    );
    expect(portalRes.status).toBe(400);
    expect((await portalRes.json()).code).toBe("INVALID_REDIRECT_ORIGIN");
    expect(stripeMocks.createStripeBillingPortalSession).not.toHaveBeenCalled();
  });

  it("prefers canonical NEXTAUTH_URL over internal 0.0.0.0/localhost request origins behind reverse proxies and excludes internal origins in prod (AUD-05)", () => {
    const prodEnv = {
      NODE_ENV: "production",
      NEXTAUTH_URL: "https://zenote.app",
    };

    // Default / relative URL behind container bind 0.0.0.0:3000 resolves to canonical public origin
    expect(
      resolveSafeBillingRedirectUrl(
        undefined,
        "http://0.0.0.0:3000/api/billing/checkout",
        "/settings?billing=success",
        prodEnv
      )
    ).toBe("https://zenote.app/settings?billing=success");

    expect(
      resolveSafeBillingRedirectUrl(
        "/settings",
        "http://127.0.0.1:3000/api/billing/portal",
        "/settings",
        prodEnv
      )
    ).toBe("https://zenote.app/settings");

    // Internal request origin must NOT remain trusted in production when https:// canonical origin is configured
    const origins = getTrustedBillingOrigins("http://0.0.0.0:3000/api/billing/checkout", prodEnv);
    expect(origins.has("https://zenote.app")).toBe(true);
    expect(origins.has("http://0.0.0.0:3000")).toBe(false);

    expect(() =>
      resolveSafeBillingRedirectUrl(
        "http://0.0.0.0:3000/settings",
        "http://0.0.0.0:3000/api/billing/checkout",
        "/settings",
        prodEnv
      )
    ).toThrow(InvalidBillingRedirectError);

    expect(() =>
      resolveSafeBillingRedirectUrl(
        "https://user:pass@zenote.app/settings",
        "http://0.0.0.0:3000/api/billing/checkout",
        "/settings",
        prodEnv
      )
    ).toThrow(InvalidBillingRedirectError);
  });

  it("ignores malformed configured origins and preserves local HTTP dev workflows (AUD-05)", () => {
    const origins = getTrustedBillingOrigins("http://127.0.0.1:3000/api/billing/checkout", {
      NODE_ENV: "development",
      NEXTAUTH_URL: "http://127.0.0.1:3000",
      SITE_URL: "javascript:alert(1)",
      ALLOWED_REDIRECT_ORIGINS: "ftp://bad.example,https://admin:pw@evil.example,https://preview.zenote.app",
    });

    expect(origins.has("http://127.0.0.1:3000")).toBe(true);
    expect(origins.has("https://preview.zenote.app")).toBe(true);
    expect(origins.size).toBe(2);
  });
});
